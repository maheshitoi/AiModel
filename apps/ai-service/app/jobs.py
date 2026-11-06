"""Dataset files, training jobs and evaluations: the long-running work behind the dashboard.

Training and evaluation run as separate processes (training.pipeline, evaluation.evaluate in ai-model/),
never inside the server, so a crash or a restart of this service doesn't stop them. All state lives in
files in the run directory (job.json, status.json, metrics.jsonl, evaluation.json), so a restarted
service picks up where it left off. One training job and one evaluation run at a time: they share the
CPU with inference.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil

from dataset.report import inspect_file, preview_file
from dataset.formats import SUPPORTED_FORMATS

from . import AI_MODEL_DIR
from .engine import DEFAULT_FACTS, Engine

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
PROCESSED_DIR = AI_MODEL_DIR / "dataset" / "processed"
MAX_EVENTS = 5000
ACTIVE_STATES = {"starting", "preparing", "running", "stopping"}


class JobConflict(RuntimeError):
    """Another training job or evaluation is already running."""


class JobNotFound(LookupError):
    pass


class EvaluationUnavailable(ValueError):
    """The run has no dataset that matches its tokenizer, so validation loss can't be measured."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):  # missing, or being replaced right now
        return None


def _running(pid: int | None, module: str) -> bool:
    """True if pid is alive and is our module (guards against the OS reusing a dead job's pid)."""
    if not pid:
        return False
    try:
        return any(module in arg for arg in psutil.Process(pid).cmdline())
    except (psutil.Error, OSError):
        return False


def _spawn(module: str, args: list[str], log_path: Path) -> int:
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    with log_path.open("ab") as log:
        proc = subprocess.Popen(
            [sys.executable, "-m", module, *args],
            cwd=AI_MODEL_DIR,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=flags,
            start_new_session=sys.platform != "win32",
        )
    return proc.pid


class DatasetStore:
    """Uploaded dataset files, named <dataset id><ext>. Ids are UUIDs chosen by the backend."""

    def __init__(self, root: Path, dataset_cfg: dict[str, Any]):
        self.root = root
        self.cfg = dataset_cfg

    def path(self, dataset_id: str) -> Path | None:
        if not UUID.match(dataset_id):
            raise ValueError("dataset id must be a UUID")
        return next((p for ext in SUPPORTED_FORMATS if (p := self.root / f"{dataset_id}{ext}").is_file()), None)

    def save(self, dataset_id: str, fmt: str, data: bytes) -> dict[str, Any]:
        ext = f".{fmt}"
        if ext not in SUPPORTED_FORMATS:
            raise ValueError(f"format must be one of: {', '.join(e[1:] for e in SUPPORTED_FORMATS)}")
        try:
            data.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise ValueError("the file is not UTF-8 text") from None
        self.delete(dataset_id)
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.root / f"{dataset_id}{ext}.tmp"
        tmp.write_bytes(data)
        tmp.replace(self.root / f"{dataset_id}{ext}")
        return self.report(dataset_id)

    def _require(self, dataset_id: str) -> Path:
        path = self.path(dataset_id)
        if path is None:
            raise FileNotFoundError(dataset_id)
        return path

    def report(self, dataset_id: str) -> dict[str, Any]:
        path = self._require(dataset_id)
        data = path.read_bytes()
        return {
            **inspect_file(path, self.cfg["max_turn_chars"], self.cfg["mask_customer_pii"], self.cfg["validation_split"]),
            "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }

    def preview(self, dataset_id: str, offset: int, limit: int) -> dict[str, Any]:
        return preview_file(self._require(dataset_id), offset, limit, self.cfg["max_turn_chars"], self.cfg["mask_customer_pii"])

    def delete(self, dataset_id: str) -> bool:
        found = False
        for ext in SUPPORTED_FORMATS:
            path = self.root / f"{dataset_id}{ext}"
            if path.is_file():
                path.unlink()
                found = True
        return found


class TrainingManager:
    def __init__(self, checkpoint_root: Path, presets_dir: Path, datasets: DatasetStore):
        self.root = checkpoint_root
        self.presets_dir = presets_dir
        self.datasets = datasets
        self._lock = threading.Lock()

    # ── presets ──────────────────────────────────────────────────────────────
    def presets(self) -> list[dict[str, Any]]:
        out = []
        for path in sorted(self.presets_dir.glob("*.json")):
            cfg = _read_json(path)
            if not cfg or not {"name", "model", "training", "dataset"} <= cfg.keys():
                continue  # e.g. business.json
            out.append({k: cfg.get(k) for k in ("name", "description", "model", "training", "dataset", "tokenizer")})
        return out

    def _preset(self, name: str) -> dict[str, Any]:
        for path in self.presets_dir.glob("*.json"):
            cfg = _read_json(path)
            if cfg and cfg.get("name") == name and "training" in cfg:
                return cfg
        raise ValueError(f"unknown preset '{name}'")

    # ── jobs ─────────────────────────────────────────────────────────────────
    def _job_dirs(self) -> list[Path]:
        return [p.parent for p in self.root.glob("*/job.json")] if self.root.is_dir() else []

    def _find(self, job_id: str) -> Path:
        for run_dir in self._job_dirs():
            if (_read_json(run_dir / "job.json") or {}).get("job_id") == job_id:
                return run_dir
        raise JobNotFound(job_id)

    def active_job(self) -> str | None:
        for run_dir in self._job_dirs():
            if self._state(run_dir)[0] in ACTIVE_STATES:
                return (_read_json(run_dir / "job.json") or {}).get("job_id")
        return None

    def start(self, job_id: str, preset: str, max_steps: int | None, include_synthetic: bool, dataset_ids: list[str]) -> dict[str, Any]:
        if not UUID.match(job_id):
            raise ValueError("job id must be a UUID")
        config = self._preset(preset)
        inputs = []
        for dataset_id in dataset_ids:
            path = self.datasets.path(dataset_id)
            if path is None:
                raise FileNotFoundError(f"dataset {dataset_id} has no file")
            inputs.append(str(path.resolve()))
        if not inputs and not include_synthetic:
            raise ValueError("choose at least one dataset or include the synthetic data")
        if max_steps:
            config["training"]["max_steps"] = max_steps
            config["training"]["warmup_steps"] = min(config["training"]["warmup_steps"], max(1, max_steps // 10))

        with self._lock:
            if (active := self.active_job()) is not None:
                raise JobConflict(f"training job {active} is still running")
            try:
                self._find(job_id)
                raise JobConflict(f"job {job_id} already exists")
            except JobNotFound:
                pass
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            run_dir = self.root / f"{config['name']}-{stamp}"
            suffix = 1
            while run_dir.exists():
                suffix += 1
                run_dir = self.root / f"{config['name']}-{stamp}-{suffix}"
            run_dir.mkdir(parents=True)
            (run_dir / "requested-config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
            spec = {"job_id": job_id, "preset": preset, "inputs": inputs, "dataset_ids": dataset_ids,
                    "include_synthetic": include_synthetic, "created_at": _now()}
            (run_dir / "job.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")
            pid = _spawn("training.pipeline", ["--run", str(run_dir)], run_dir / "train.log")
            (run_dir / "job.json").write_text(json.dumps({**spec, "launcher_pid": pid}, indent=2), encoding="utf-8")
        return self.get(job_id)

    def stop(self, job_id: str) -> dict[str, Any]:
        run_dir = self._find(job_id)
        if self._state(run_dir)[0] in ACTIVE_STATES:
            (run_dir / "STOP").touch()
        return self.get(job_id)

    def _state(self, run_dir: Path) -> tuple[str, dict[str, Any]]:
        """(state, status.json). Turns a "running" file left behind by a dead process into "failed"."""
        status = _read_json(run_dir / "status.json") or {}
        raw = status.get("status", "starting")
        if raw in ("starting", "preparing", "running"):
            pid = status.get("pid") or (_read_json(run_dir / "job.json") or {}).get("launcher_pid")
            if not _running(pid, "training.pipeline"):
                return "failed", {**status, "error": status.get("error") or "The training process exited unexpectedly (see train.log)"}
            if (run_dir / "STOP").exists():
                return "stopping", status
        return raw, status

    def get(self, job_id: str, since_step: int = 0) -> dict[str, Any]:
        run_dir = self._find(job_id)
        state, status = self._state(run_dir)
        run_config = _read_json(run_dir / "config.json") or {}
        model = run_config.get("model_resolved") or {}
        dataset = (run_config.get("dataset_stats") or {}).get("records")
        events, started_at, parameters = [], None, status.get("parameters")
        metrics = run_dir / "metrics.jsonl"
        if metrics.is_file():
            for line in metrics.read_text(encoding="utf-8").splitlines():
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue  # a line being written right now
                if event.get("type") == "start":
                    started_at = started_at or event.get("time")
                    parameters = event.get("parameters", parameters)
                elif event.get("type") in ("train", "eval") and event.get("step", 0) >= since_step and len(events) < MAX_EVENTS:
                    events.append(event)
        spec = _read_json(run_dir / "job.json") or {}
        return {
            "job_id": job_id,
            "run_name": run_dir.name,
            "state": state,
            "step": status.get("steps", status.get("step", 0)),
            "max_steps": status.get("max_steps") or (_read_json(run_dir / "requested-config.json") or {}).get("training", {}).get("max_steps"),
            "best_val_loss": status.get("best_val_loss"),
            "best_step": status.get("best_step"),
            "error": status.get("error"),
            "parameters": parameters,
            "vocab_size": model.get("vocab_size"),
            "context_length": model.get("context_length"),
            "device": run_config.get("device") or status.get("device"),
            "dataset": dataset,
            "created_at": spec.get("created_at"),
            "started_at": started_at,
            "updated_at": status.get("updated_at"),
            "duration_s": status.get("duration_s"),
            "best_checkpoint": f"{run_dir.name}/best.pt" if (run_dir / "best.pt").is_file() else None,
            "events": events,
        }


class EvaluationManager:
    """Runs evaluation.evaluate for one checkpoint at a time; the report is evaluation.json beside it."""

    def __init__(self, engine: Engine):
        self.engine = engine
        self._lock = threading.Lock()

    def _data_dir(self, run_dir: Path) -> Path:
        if (run_dir / "data" / "val.bin").is_file():
            return run_dir / "data"  # runs started from the dashboard keep their exact data
        tok, shared = run_dir / "tokenizer.json", PROCESSED_DIR / "tokenizer.json"
        if tok.is_file() and shared.is_file() and tok.read_bytes() == shared.read_bytes():
            return PROCESSED_DIR  # a command-line run whose dataset hasn't been rebuilt since
        raise EvaluationUnavailable("This run's training data is no longer available, so it can't be evaluated")

    def _running_job(self) -> Path | None:
        for job in self.engine.checkpoint_root.glob("*/evaluation-job.json"):
            if _running((_read_json(job) or {}).get("pid"), "evaluation.evaluate"):
                return job.parent
        return None

    def start(self, checkpoint: str) -> dict[str, Any]:
        path = self.engine.resolve(checkpoint)
        run_dir = path.parent
        data_dir = self._data_dir(run_dir)
        business = run_dir / "business.json" if (run_dir / "business.json").is_file() else DEFAULT_FACTS
        with self._lock:
            if (busy := self._running_job()) is not None:
                raise JobConflict(f"an evaluation of {busy.name} is still running")
            pid = _spawn("evaluation.evaluate", ["--checkpoint", str(path), "--data", str(data_dir), "--business", str(business)],
                         run_dir / "evaluation.log")
            job = {"checkpoint": path.name, "pid": pid, "started_at": datetime.now(timezone.utc).timestamp()}
            (run_dir / "evaluation-job.json").write_text(json.dumps(job), encoding="utf-8")
        return self.get(checkpoint)

    def get(self, checkpoint: str) -> dict[str, Any]:
        path = self.engine.resolve(checkpoint)
        run_dir = path.parent
        job = _read_json(run_dir / "evaluation-job.json")
        mine = job is not None and job.get("checkpoint") == path.name
        report_path = run_dir / "evaluation.json"
        report = _read_json(report_path)
        fresh = (
            report is not None
            and Path(str(report.get("checkpoint", "")).replace("\\", "/")).name == path.name
            and (not mine or report_path.stat().st_mtime >= job["started_at"])
        )
        if mine and not fresh and _running(job.get("pid"), "evaluation.evaluate"):
            return {"checkpoint": checkpoint, "state": "running", "report": None, "error": None}
        if fresh:
            return {"checkpoint": checkpoint, "state": "completed", "report": report, "error": None}
        if mine:
            return {"checkpoint": checkpoint, "state": "failed", "report": None, "error": "The evaluation failed (see evaluation.log in the run directory)"}
        return {"checkpoint": checkpoint, "state": "none", "report": None, "error": None}
