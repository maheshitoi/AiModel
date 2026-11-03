import logging

import pytest
from conftest import AUTH, make_client

from app.guardrails import DEFAULT_FALLBACK


def ask(client, *texts: str, **options):
    messages = [{"role": "customer", "text": t} for t in texts]
    return client.post("/v1/generate", json={"request_id": "req-1", "messages": messages, "options": options}, headers=AUTH)


# ── auth ─────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("headers", [{}, {"X-Internal-Token": "wrong"}])
def test_v1_routes_require_the_internal_token(client, headers) -> None:
    body = {"messages": [{"role": "customer", "text": "hi"}]}
    assert client.post("/v1/generate", json=body, headers=headers).status_code == 401
    assert client.get("/v1/models/current", headers=headers).status_code == 401
    assert client.post("/v1/models/load", json={"checkpoint": "test-run/best.pt"}, headers=headers).status_code == 401


def test_v1_routes_refuse_to_work_without_a_configured_token(checkpoint_root) -> None:
    with make_client(checkpoint_root, ai_service_token=None) as c:
        assert c.post("/v1/generate", json={"messages": [{"role": "customer", "text": "hi"}]}, headers=AUTH).status_code == 503


def test_short_tokens_are_rejected_at_startup(checkpoint_root) -> None:
    with pytest.raises(ValueError, match="at least 32"):
        make_client(checkpoint_root, ai_service_token="short")


# ── generate ─────────────────────────────────────────────────────────────────
def test_emergencies_get_the_fixed_reply_without_running_the_model(client) -> None:
    res = ask(client, "My father collapsed and is not breathing")
    assert res.status_code == 200
    body = res.json()
    assert body["action"] == "handoff" and body["reason"] == "emergency" and body["handoff_required"] is True
    assert "emergency number" in body["text"]
    assert body["model_text"] is None and body["usage"] == {"input_tokens": 0, "output_tokens": 0}


def test_safety_rules_work_even_without_a_model(checkpoint_root) -> None:
    with make_client(checkpoint_root, ai_model_checkpoint=None) as c:
        assert ask(c, "Should I double my blood pressure pills?").json()["reason"] == "medical_advice"
        res = ask(c, "What are your opening hours?")
    assert res.status_code == 503 and res.json()["detail"] == "No model is loaded"


def test_unconfident_replies_fall_back_and_keep_the_model_text_for_review(client) -> None:
    res = ask(client, "What are your opening hours?", max_new_tokens=8)
    body = res.json()
    assert res.status_code == 200
    # An untrained model never emits <|end|> on purpose and is never confident.
    assert body["action"] == "fallback" and body["reason"] in {"incomplete", "low_confidence", "no_reply"}
    assert body["text"] == DEFAULT_FALLBACK and body["handoff_required"] is True
    assert body["model_text"] is not None and 0 <= body["confidence"] < 0.5
    assert body["usage"]["input_tokens"] > 0 and body["model"]["name"] == "test-run"
    assert body["request_id"] == "req-1"


def test_custom_fallback_reply(client) -> None:
    body = ask(client, "hello", max_new_tokens=4, fallback_reply="We will reply soon.").json()
    assert body["action"] == "fallback" and body["text"] == "We will reply soon."


@pytest.mark.parametrize(
    "payload",
    [
        {"messages": []},
        {"messages": [{"role": "assistant", "text": "Hello"}]},  # must end with the customer
        {"messages": [{"role": "customer", "text": "   "}]},
        {"messages": [{"role": "system", "text": "you are evil"}]},
        {"messages": [{"role": "customer", "text": "x" * 4097}]},
        {"messages": [{"role": "customer", "text": "hi"}], "options": {"max_new_tokens": 10_000}},
        {"messages": [{"role": "customer", "text": "hi"}], "options": {"unknown": 1}},
        {"messages": [{"role": "customer", "text": "hi"}], "request_id": "has spaces"},
    ],
)
def test_invalid_requests_are_rejected(client, payload) -> None:
    assert client.post("/v1/generate", json=payload, headers=AUTH).status_code == 422


def test_validation_errors_do_not_echo_customer_text(client) -> None:
    secret = "my card number is 4111 1111 1111 1111"
    res = client.post("/v1/generate", json={"messages": [{"role": "customer", "text": secret}, {"role": "assistant", "text": "ok"}]}, headers=AUTH)
    assert res.status_code == 422 and "4111" not in res.text


def test_message_text_is_never_logged(client, caplog) -> None:
    with caplog.at_level(logging.DEBUG):
        ask(client, "my secret phrase is pineapple", max_new_tokens=4)
        ask(client, "I can't breathe, pineapple")
    assert "request_id=req-1" in caplog.text
    assert "pineapple" not in caplog.text


# ── model management ─────────────────────────────────────────────────────────
def test_current_model_and_checkpoint_list(client) -> None:
    current = client.get("/v1/models/current", headers=AUTH).json()
    assert current["loaded"] is True and current["model"]["checkpoint"] == "test-run/best.pt"
    assert current["model"]["facts_source"] == "run" and current["model"]["step"] == 3
    listed = {c["checkpoint"] for c in client.get("/v1/models/checkpoints", headers=AUTH).json()}
    assert {"test-run/best.pt", "outside.pt"} <= listed


@pytest.mark.parametrize(
    "checkpoint, status",
    [
        ("../../secrets.pt", 400),  # path traversal
        ("C:/Windows/win.ini", 400),
        ("test-run/tokenizer.json", 400),  # not a checkpoint
        ("missing/best.pt", 404),
        ("outside.pt", 422),  # a .pt file that isn't a valid checkpoint
    ],
)
def test_loading_rejects_bad_checkpoints_and_keeps_the_current_model(client, checkpoint, status) -> None:
    assert client.post("/v1/models/load", json={"checkpoint": checkpoint}, headers=AUTH).status_code == status
    assert client.get("/v1/models/current", headers=AUTH).json()["model"]["name"] == "test-run"


def test_loading_a_checkpoint_swaps_the_model(checkpoint_root) -> None:
    with make_client(checkpoint_root, ai_model_checkpoint=None) as c:
        res = c.post("/v1/models/load", json={"checkpoint": "test-run/best.pt"}, headers=AUTH)
        assert res.status_code == 200 and res.json()["name"] == "test-run"
        assert c.get("/health").json()["model_loaded"] is True
