"""Text normalisation, PII masking, de-duplication and deterministic train/validation splitting."""

from __future__ import annotations

import hashlib
import re
import unicodedata

from .schema import CUSTOMER, Conversation, Turn

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏  ﻿]")
_SPACES = re.compile(r"[ \t ]+")
_NEWLINES = re.compile(r"\s*\n\s*")
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")
# Phone-like: optional +, then 8+ digits possibly separated by spaces, dots, dashes or parentheses.
_PHONE = re.compile(r"(?<![\w+])\+?\d(?:[\s().-]*\d){7,}(?!\w)")


def clean_text(text: str, max_chars: int) -> str:
    """NFKC-normalise, drop control/zero-width characters, collapse whitespace, truncate at a word boundary."""
    text = unicodedata.normalize("NFKC", text)
    text = _CONTROL.sub("", text.replace("\r\n", "\n").replace("\r", "\n"))
    text = _NEWLINES.sub("\n", _SPACES.sub(" ", text)).strip()
    if len(text) > max_chars:
        cut = text.rfind(" ", 0, max_chars)
        text = text[: cut if cut > max_chars // 2 else max_chars].rstrip()
    return text


def mask_pii(text: str) -> str:
    """Replaces email addresses and phone numbers with placeholders."""
    return _PHONE.sub("<phone>", _EMAIL.sub("<email>", text))


def clean_conversation(conv: Conversation, max_chars: int, mask_customer_pii: bool) -> Conversation:
    turns = []
    for t in conv.turns:
        text = clean_text(t.text, max_chars)
        # Only customer turns: assistant turns legitimately contain the business's own phone/email.
        if mask_customer_pii and t.role == CUSTOMER:
            text = mask_pii(text)
        turns.append(Turn(t.role, text))
    return Conversation(turns=turns, intent=conv.intent, source=conv.source, meta=conv.meta)


def fingerprint(conv: Conversation) -> str:
    """Stable content hash, insensitive to case and whitespace, used for dedup and splitting."""
    canonical = "\n".join(f"{t.role}:{' '.join(t.text.lower().split())}" for t in conv.turns)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def deduplicate(conversations: list[Conversation]) -> tuple[list[Conversation], int]:
    seen: set[str] = set()
    unique: list[Conversation] = []
    for conv in conversations:
        fp = fingerprint(conv)
        if fp not in seen:
            seen.add(fp)
            unique.append(conv)
    return unique, len(conversations) - len(unique)


def split(conversations: list[Conversation], validation_ratio: float) -> tuple[list[Conversation], list[Conversation]]:
    """Assigns each conversation by its content hash, so it stays in the same split as the dataset grows."""
    if not 0 < validation_ratio < 1:
        raise ValueError("validation_ratio must be between 0 and 1")
    threshold = int(validation_ratio * 0xFFFFFFFF)
    train, val = [], []
    for conv in conversations:
        (val if int(fingerprint(conv)[:8], 16) < threshold else train).append(conv)
    return train, val
