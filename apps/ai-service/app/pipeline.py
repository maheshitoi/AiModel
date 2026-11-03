"""The full reply decision: safety rules → model → output checks → confidence gate.

The gate rejects a reply whose least confident token is below `min_confidence`.

Every path returns text that is safe to send. `action` tells the caller what kind of text it is:
  reply     the model's own reply passed every check
  fallback  the model ran but its reply was rejected; `text` is the generic fallback reply
  handoff   a safety or handoff rule matched; `text` is a fixed reply and the model never ran
Whether anything is actually sent automatically is the backend's decision (auto-reply is off by default).
"""

from __future__ import annotations

from dataclasses import dataclass

from dataset.schema import Turn
from model.chat import GenerationSettings

from .engine import Engine, ModelInfo
from .guardrails import check_message, check_reply, pending_customer_text, safety_reply


@dataclass(frozen=True)
class Decision:
    action: str  # reply | fallback | handoff
    text: str
    # model_reply | self_harm | emergency | medical_advice | human_request
    # | no_reply | incomplete | low_confidence | action_claim | medical_content | ungrounded
    reason: str
    handoff_required: bool
    detail: str | None = None
    confidence: float | None = None  # lowest token probability in the model's reply
    model_text: str | None = None  # the model's own reply, kept for review even when it isn't used
    input_tokens: int = 0
    output_tokens: int = 0
    model: ModelInfo | None = None


def decide(engine: Engine, history: list[Turn], settings: GenerationSettings, min_confidence: float, fallback_reply: str) -> Decision:
    match = check_message(pending_customer_text(history))
    if match:
        current = engine.current
        return Decision(
            "handoff",
            safety_reply(match.category, engine.business()),
            match.category,
            handoff_required=True,
            detail=match.rule,
            model=current.info if current else None,
        )

    reply, used = engine.generate(history, settings)
    confidence = round(reply.min_token_prob, 4)
    common = dict(confidence=confidence, model_text=reply.text, input_tokens=reply.input_tokens, output_tokens=reply.output_tokens, model=used.info)

    def fallback(reason: str, detail: str | None = None) -> Decision:
        # The customer only got a generic message, so a person should follow up.
        return Decision("fallback", fallback_reply, reason, handoff_required=True, detail=detail, **common)

    if not reply.text:
        return fallback("no_reply")
    if not reply.finished:
        return fallback("incomplete", f"no end token within {settings.max_new_tokens} tokens")
    issue = check_reply(reply.text, history, used.business)
    if issue:
        return fallback(issue.reason, issue.detail)
    # Last, so that evaluate_guarded can sweep thresholds over decisions made with the gate off.
    if confidence < min_confidence:
        return fallback("low_confidence", f"{confidence} < {min_confidence}")
    return Decision("reply", reply.text, "model_reply", handoff_required=False, **common)
