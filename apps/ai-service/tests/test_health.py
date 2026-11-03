from fastapi.testclient import TestClient

from main import app


def test_health_reports_torch_runtime():
    res = TestClient(app).get("/health")

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["device"] in {"cpu", "cuda"}
    assert body["cpu_threads"] >= 1
    assert body["model_loaded"] is False
