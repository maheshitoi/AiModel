"""Dataset, training and evaluation API. Training and evaluation run for real, as tiny subprocess jobs."""

import json
import time
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import AI_MODEL_DIR
from app.config import Settings
from app.server import create_app

from conftest import AUTH, TOKEN

SAMPLE = "\n".join(
    json.dumps(c)
    for c in [
        {"messages": [{"role": "customer", "text": "Call me on +1 555 123 4567 please"}, {"role": "assistant", "text": "We will call you back."}]},
        {"messages": [{"role": "customer", "text": "Are you open Sunday?"}, {"role": "assistant", "text": "Sorry, we are closed on Sunday."}]},
        {"messages": [{"role": "customer", "text": "are you   open SUNDAY?"}, {"role": "assistant", "text": "Sorry, we are closed on Sunday."}]},
        {"messages": [{"role": "assistant", "text": "Hello"}]},
    ]
)


@pytest.fixture(scope="module")
def env(tmp_path_factory: pytest.TempPathFactory) -> dict:
    root = tmp_path_factory.mktemp("jobs")
    presets = root / "presets"
    presets.mkdir()
    config = json.loads((AI_MODEL_DIR / "config" / "tiny-cpu.json").read_text(encoding="utf-8"))
    config["dataset"]["synthetic_conversations"] = 400
    config["tokenizer"]["vocab_size"] = 400
    config["model"].update(context_length=32, n_embd=32, n_head=2, n_layer=1, dropout=0.0)
    config["training"].update(batch_size=4, max_steps=30, warmup_steps=3, log_interval=10, eval_interval=10, eval_batches=2,
                              checkpoint_interval=10, early_stop_patience=0, num_threads=1)
    (presets / "tiny-cpu.json").write_text(json.dumps(config), encoding="utf-8")
    (presets / "business.json").write_text("{}", encoding="utf-8")  # not a preset: must be skipped
    checkpoints = root / "checkpoints"
    checkpoints.mkdir()
    return {"checkpoints": checkpoints, "presets": presets, "datasets": root / "uploads"}


@pytest.fixture(scope="module")
def api(env: dict):
    settings = Settings(_env_file=None, ai_service_token=TOKEN, checkpoint_dir=env["checkpoints"], training_presets_dir=env["presets"],
                        dataset_dir=env["datasets"], dataset_max_bytes=4096)
    with TestClient(create_app(settings), headers=AUTH) as c:
        yield c


def wait_for(api: TestClient, url: str, done, timeout: float = 180) -> dict:
    end = time.monotonic() + timeout
    while True:
        body = api.get(url).json()
        if done(body):
            return body
        assert time.monotonic() < end, f"timed out; last state: {body.get('state')}"
        time.sleep(0.5)


# ── datasets ─────────────────────────────────────────────────────────────────
def test_upload_validates_and_reports(api: TestClient) -> None:
    dataset_id = str(uuid.uuid4())
    res = api.put(f"/v1/datasets/{dataset_id}?format=jsonl", content=SAMPLE.encode())
    assert res.status_code == 200
    r = res.json()
    assert (r["records"], r["valid_records"], r["issue_count"], r["duplicates"], r["unique"]) == (4, 3, 2, 1, 2)
    assert r["issues"][0]["record"] == 4
    assert r["train"] + r["validation"] == 2
    assert len(r["sha256"]) == 64 and r["size_bytes"] == len(SAMPLE.encode())

    preview = api.get(f"/v1/datasets/{dataset_id}/preview?limit=1").json()
    assert preview["total"] == 3
    assert preview["items"][0]["messages"][0]["text"] == "Call me on <phone> please"  # PII masked in previews too

    assert api.post(f"/v1/datasets/{dataset_id}/validate").json()["unique"] == 2
    assert api.delete(f"/v1/datasets/{dataset_id}").status_code == 204
    assert api.post(f"/v1/datasets/{dataset_id}/validate").status_code == 404


def test_upload_rejections(api: TestClient) -> None:
    dataset_id = str(uuid.uuid4())
    assert api.put("/v1/datasets/../../etc?format=txt", content=b"x").status_code in (400, 404)
    assert api.put("/v1/datasets/not-a-uuid?format=txt", content=b"Customer: hi\nAssistant: hello").status_code == 400
    assert api.put(f"/v1/datasets/{dataset_id}?format=csv", content=b"a,b").status_code == 422
    assert api.put(f"/v1/datasets/{dataset_id}?format=txt", content=b"\xff\xfe\x00bad").status_code == 400
    assert api.put(f"/v1/datasets/{dataset_id}?format=txt", content=b"x" * 5000).status_code == 413
    assert api.put(f"/v1/datasets/{dataset_id}?format=txt", content=b"  \n").status_code == 400


def test_requires_token(env: dict, api: TestClient) -> None:
    assert api.get("/v1/training/presets", headers={"X-Internal-Token": "wrong"}).status_code == 401


# ── training ─────────────────────────────────────────────────────────────────
def test_presets_skip_non_configs(api: TestClient) -> None:
    names = [p["name"] for p in api.get("/v1/training/presets").json()]
    assert names == ["tiny-cpu"]


def test_training_job_runs_to_completion_and_can_be_evaluated(api: TestClient, env: dict) -> None:
    dataset_id = str(uuid.uuid4())
    api.put(f"/v1/datasets/{dataset_id}?format=jsonl", content=SAMPLE.encode())
    job_id = str(uuid.uuid4())
    res = api.post("/v1/training/jobs", json={"job_id": job_id, "preset": "tiny-cpu", "include_synthetic": True, "dataset_ids": [dataset_id]})
    assert res.status_code == 201, res.text
    assert res.json()["state"] in ("starting", "preparing", "running")
    # Only one job at a time.
    other = api.post("/v1/training/jobs", json={"job_id": str(uuid.uuid4()), "preset": "tiny-cpu"})
    assert other.status_code == 409

    job = wait_for(api, f"/v1/training/jobs/{job_id}", lambda b: b["state"] not in ("starting", "preparing", "running"))
    assert job["state"] == "completed", job
    assert job["step"] == 30 and job["max_steps"] == 30
    assert job["best_checkpoint"] == f"{job['run_name']}/best.pt"
    assert job["parameters"] > 0 and job["vocab_size"] > 256 and job["context_length"] == 32
    assert job["dataset"]["train"] > 0
    types = {e["type"] for e in job["events"]}
    assert types == {"train", "eval"}
    later = api.get(f"/v1/training/jobs/{job_id}?since_step=20").json()["events"]
    assert later and all(e["step"] >= 20 for e in later)
    run_dir = env["checkpoints"] / job["run_name"]
    assert (run_dir / "data" / "val.bin").is_file()  # the exact data, kept for evaluation
    sources = json.loads((run_dir / "data" / "stats.json").read_text(encoding="utf-8"))["sources"]
    assert [s["source"] for s in sources][0] == "synthetic" and len(sources) == 2

    checkpoint = job["best_checkpoint"]
    assert api.get(f"/v1/evaluations?checkpoint={checkpoint}").json()["state"] == "none"
    assert api.post("/v1/evaluations", json={"checkpoint": checkpoint}).status_code == 202
    result = wait_for(api, f"/v1/evaluations?checkpoint={checkpoint}", lambda b: b["state"] != "running")
    assert result["state"] == "completed", result
    assert set(result["report"]["groups"]) == {"in_distribution", "paraphrased", "safety", "out_of_scope"}
    # last.pt has no report of its own yet.
    assert api.get(f"/v1/evaluations?checkpoint={job['run_name']}/last.pt").json()["state"] == "none"


def test_stop_saves_and_stops(api: TestClient) -> None:
    job_id = str(uuid.uuid4())
    assert api.post("/v1/training/jobs", json={"job_id": job_id, "preset": "tiny-cpu", "max_steps": 100_000}).status_code == 201
    wait_for(api, f"/v1/training/jobs/{job_id}", lambda b: b["state"] == "running" and b["step"] > 0)
    assert api.post(f"/v1/training/jobs/{job_id}/stop").json()["state"] == "stopping"
    job = wait_for(api, f"/v1/training/jobs/{job_id}", lambda b: b["state"] != "stopping", timeout=60)
    assert job["state"] == "stopped"
    assert 0 < job["step"] < 100_000


def test_training_errors(api: TestClient) -> None:
    body = {"job_id": str(uuid.uuid4()), "preset": "tiny-cpu"}
    assert api.post("/v1/training/jobs", json={**body, "preset": "nope"}).status_code == 400
    assert api.post("/v1/training/jobs", json={**body, "include_synthetic": False}).status_code == 400
    assert api.post("/v1/training/jobs", json={**body, "dataset_ids": [str(uuid.uuid4())]}).status_code == 404
    assert api.get(f"/v1/training/jobs/{uuid.uuid4()}").status_code == 404
    assert api.post("/v1/evaluations", json={"checkpoint": "../outside.pt"}).status_code == 400


def test_dead_process_is_reported_as_failed(api: TestClient, env: dict) -> None:
    run = env["checkpoints"] / "ghost-run"
    run.mkdir()
    job_id = str(uuid.uuid4())
    (run / "job.json").write_text(json.dumps({"job_id": job_id, "launcher_pid": 999_999}), encoding="utf-8")
    (run / "status.json").write_text(json.dumps({"status": "running", "step": 5, "pid": 999_999}), encoding="utf-8")
    job = api.get(f"/v1/training/jobs/{job_id}").json()
    assert job["state"] == "failed" and "exited unexpectedly" in job["error"]
