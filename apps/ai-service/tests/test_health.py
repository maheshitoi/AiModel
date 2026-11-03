from conftest import make_client


def test_health_reports_runtime_and_loaded_model(client) -> None:
    res = client.get("/health")

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["device"] in {"cpu", "cuda"}
    assert body["cpu_threads"] >= 1
    assert body["model_loaded"] is True and body["model_name"] == "test-run"


def test_health_without_a_model(checkpoint_root) -> None:
    with make_client(checkpoint_root, ai_model_checkpoint=None) as c:
        body = c.get("/health").json()
    assert body["model_loaded"] is False and body["model_name"] is None


def test_a_broken_startup_checkpoint_does_not_stop_the_service(checkpoint_root) -> None:
    with make_client(checkpoint_root, ai_model_checkpoint="outside.pt") as c:
        assert c.get("/health").json()["model_loaded"] is False
