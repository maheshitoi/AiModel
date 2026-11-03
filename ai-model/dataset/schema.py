"""The single in-memory representation every dataset format is converted to."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

CUSTOMER = "customer"
ASSISTANT = "assistant"
ROLES = (CUSTOMER, ASSISTANT)

# Hard upper bound before cleaning; cleaning then truncates to the configured max_turn_chars.
MAX_RAW_TURN_CHARS = 4000


@dataclass(frozen=True)
class Turn:
    role: str
    text: str


@dataclass
class Conversation:
    """Alternating customer/assistant turns, starting with the customer and ending with the assistant."""

    turns: list[Turn]
    intent: str | None = None
    source: str = "unknown"
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "messages": [{"role": t.role, "text": t.text} for t in self.turns],
            "source": self.source,
        }
        if self.intent:
            out["intent"] = self.intent
        return out


def validate_conversation(conv: Conversation) -> list[str]:
    """Returns human-readable problems; an empty list means the conversation is usable for training."""
    problems: list[str] = []
    if len(conv.turns) < 2:
        problems.append("needs at least one customer turn followed by an assistant turn")
    for i, turn in enumerate(conv.turns):
        if turn.role not in ROLES:
            problems.append(f"turn {i + 1}: unknown role '{turn.role}' (expected customer or assistant)")
            continue
        expected = CUSTOMER if i % 2 == 0 else ASSISTANT
        if turn.role != expected:
            problems.append(f"turn {i + 1}: expected a {expected} turn (roles must alternate, starting with customer)")
        if not turn.text.strip():
            problems.append(f"turn {i + 1}: text is empty")
        elif len(turn.text) > MAX_RAW_TURN_CHARS:
            problems.append(f"turn {i + 1}: text exceeds {MAX_RAW_TURN_CHARS} characters")
    if conv.turns and conv.turns[-1].role != ASSISTANT:
        problems.append("last turn must be an assistant reply (it is what the model learns to produce)")
    return problems
