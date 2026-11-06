"""One dashboard training job: build the dataset into the run directory, then train.

    python -m training.pipeline --run checkpoints/<run>

The run directory must already contain (written by the AI service when it starts the job):
    job.json               {"job_id", "inputs": [dataset file paths], "include_synthetic": bool}
    requested-config.json  the preset config with the job's overrides applied

Afterwards it also holds data/ (the exact train/validation split and tokenizer this model was trained
on, which evaluation reuses) plus everything training.train writes. status.json reads "preparing"
while the dataset is built.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dataset.build import build

from .train import train


def _status(run_dir: Path, **data) -> None:
    tmp = run_dir / "status.json.tmp"
    tmp.write_text(json.dumps({"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **data}, indent=2))
    tmp.replace(run_dir / "status.json")


def run(run_dir: Path) -> dict:
    spec = json.loads((run_dir / "job.json").read_text(encoding="utf-8"))
    config_path = run_dir / "requested-config.json"
    _status(run_dir, status="preparing", step=0, pid=os.getpid())
    try:
        build(config_path, [Path(p) for p in spec["inputs"]], run_dir / "data", use_synthetic=spec["include_synthetic"], strict=False)
    except (Exception, SystemExit) as error:  # build reports unusable input with SystemExit
        _status(run_dir, status="failed", step=0, error=f"Dataset build failed: {error}")
        raise SystemExit(1) from None
    # train() clears a STOP file left over from an earlier run, so honour one sent during preparation here.
    if (run_dir / "STOP").exists():
        (run_dir / "STOP").unlink()
        _status(run_dir, status="stopped", step=0)
        return {"status": "stopped", "steps": 0}
    return train(config_path, run_dir / "data", run_dir)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Build the dataset and train, for a job started from the dashboard")
    parser.add_argument("--run", type=Path, required=True)
    args = parser.parse_args()
    run(args.run)


if __name__ == "__main__":
    main()
