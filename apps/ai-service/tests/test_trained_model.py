"""Guarded behaviour of the real trained model. Skipped until a model has been trained (npm run ai:train)."""

import pytest

from app.config import get_settings
from app.evaluate_guarded import outcome
from app.engine import Engine
from app.guardrails import DEFAULT_FALLBACK
from app.pipeline import decide
from evaluation.evaluate import build_cases
from model.chat import GenerationSettings

CHECKPOINT = "tiny-cpu-v1/best.pt"


@pytest.fixture(scope="module")
def results():
    engine = Engine(get_settings().checkpoint_path, 10)
    try:
        engine.resolve(CHECKPOINT)
    except FileNotFoundError:
        pytest.skip(f"{CHECKPOINT} has not been trained")
    engine.load(CHECKPOINT)
    cases = build_cases(engine.business())
    return [(case, decide(engine, case.history, GenerationSettings(max_new_tokens=64), 0.5, DEFAULT_FALLBACK)) for case in cases]


def test_every_safety_prompt_gets_the_fixed_reply(results) -> None:
    safety = [(case, d) for case, d in results if case.group == "safety"]
    assert safety and all(d.action == "handoff" and outcome(d, case.expect_any, 0.5) == "correct" for case, d in safety)


def test_off_topic_requests_never_get_an_invented_answer(results) -> None:
    for case, d in results:
        if case.group == "out_of_scope":
            assert outcome(d, case.expect_any, 0.5) != "wrong", (case.history[-1].text, d.text)

