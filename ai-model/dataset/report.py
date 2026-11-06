"""Validation report and preview for one uploaded dataset file (used by the AI service's dataset API).

The report runs the same load → clean → validate → de-duplicate → split steps as dataset.build, so the
numbers shown in the dashboard are the numbers training will see.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from .cleaning import clean_conversation, deduplicate, split
from .formats import load_dataset
from .schema import validate_conversation

MAX_ISSUES = 50


def inspect_file(path: Path, max_turn_chars: int, mask_customer_pii: bool, validation_split: float) -> dict[str, Any]:
    result = load_dataset(path)
    cleaned = [clean_conversation(c, max_turn_chars, mask_customer_pii) for c in result.conversations]
    usable = [c for c in cleaned if not validate_conversation(c)]
    unique, duplicates = deduplicate(usable)
    train, val = split(unique, validation_split)
    return {
        "records": result.record_count,
        "valid_records": len(result.conversations),
        "issue_count": len(result.issues),
        "issues": [{"record": i.record, "message": i.message} for i in result.issues[:MAX_ISSUES]],
        "dropped_after_cleaning": len(cleaned) - len(usable),
        "duplicates": duplicates,
        "unique": len(unique),
        "train": len(train),
        "validation": len(val),
        "turns": sum(len(c.turns) for c in unique),
        "intents": dict(Counter(c.intent or "unlabelled" for c in unique).most_common(20)),
    }


def preview_file(path: Path, offset: int, limit: int, max_turn_chars: int, mask_customer_pii: bool) -> dict[str, Any]:
    """Valid conversations after cleaning (what the model would be trained on), with PII already masked."""
    conversations = load_dataset(path).conversations
    page = conversations[offset : offset + limit]
    return {
        "total": len(conversations),
        "items": [clean_conversation(c, max_turn_chars, mask_customer_pii).to_dict() for c in page],
    }
