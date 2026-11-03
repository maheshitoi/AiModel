"""Load JSON, JSONL and TXT conversation files with record-level validation.

JSON   [ {"messages": [{"role": "customer", "text": "..."}, ...], "intent": "..."} , ... ]
       or {"conversations": [ ... ]}
JSONL  one conversation object (as above) per line
TXT    conversations separated by blank lines; each turn starts with "Customer:" or "Assistant:".
       Lines without a prefix continue the previous turn.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .schema import ROLES, Conversation, Turn, validate_conversation

SUPPORTED_FORMATS = {".json": "json", ".jsonl": "jsonl", ".txt": "txt"}
_TXT_PREFIX = re.compile(r"^\s*(customer|assistant)\s*:\s?(.*)$", re.IGNORECASE)


@dataclass(frozen=True)
class Issue:
    record: int  # 1-based record number (line number for JSONL, block start line for TXT)
    message: str


@dataclass
class LoadResult:
    conversations: list[Conversation] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    record_count: int = 0

    @property
    def valid(self) -> bool:
        return not self.issues


def load_dataset(path: str | Path, source: str | None = None) -> LoadResult:
    path = Path(path)
    fmt = SUPPORTED_FORMATS.get(path.suffix.lower())
    if fmt is None:
        raise ValueError(f"Unsupported dataset format '{path.suffix}'. Use one of: {', '.join(SUPPORTED_FORMATS)}")
    text = path.read_text(encoding="utf-8-sig")
    source = source or path.name
    if fmt == "json":
        return _load_json(text, source)
    if fmt == "jsonl":
        return _load_jsonl(text, source)
    return _load_txt(text, source)


def _from_object(obj: Any, source: str) -> tuple[Conversation | None, list[str]]:
    if not isinstance(obj, dict) or not isinstance(obj.get("messages"), list):
        return None, ['expected an object with a "messages" array']
    turns: list[Turn] = []
    for i, m in enumerate(obj["messages"]):
        text = m.get("text", m.get("content")) if isinstance(m, dict) else None
        if not isinstance(m, dict) or not isinstance(m.get("role"), str) or not isinstance(text, str):
            return None, [f'message {i + 1}: expected {{"role": string, "text": string}}']
        turns.append(Turn(role=m["role"].strip().lower(), text=text))
    intent = obj.get("intent") if isinstance(obj.get("intent"), str) else None
    conv = Conversation(turns=turns, intent=intent, source=str(obj.get("source") or source))
    return conv, validate_conversation(conv)


def _collect(result: LoadResult, record: int, conv: Conversation | None, problems: list[str]) -> None:
    result.record_count += 1
    if problems:
        result.issues.extend(Issue(record, p) for p in problems)
    elif conv is not None:
        result.conversations.append(conv)


def _load_json(text: str, source: str) -> LoadResult:
    result = LoadResult()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        result.issues.append(Issue(e.lineno, f"invalid JSON: {e.msg}"))
        return result
    if isinstance(data, dict) and isinstance(data.get("conversations"), list):
        data = data["conversations"]
    if not isinstance(data, list):
        result.issues.append(Issue(1, 'expected an array of conversations or {"conversations": [...]}'))
        return result
    for i, obj in enumerate(data, start=1):
        _collect(result, i, *_from_object(obj, source))
    return result


def _load_jsonl(text: str, source: str) -> LoadResult:
    result = LoadResult()
    for line_no, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            result.record_count += 1
            result.issues.append(Issue(line_no, f"invalid JSON: {e.msg}"))
            continue
        _collect(result, line_no, *_from_object(obj, source))
    return result


def _load_txt(text: str, source: str) -> LoadResult:
    result = LoadResult()
    block: list[tuple[int, str]] = []

    def flush() -> None:
        if not block:
            return
        start = block[0][0]
        turns: list[Turn] = []
        problems: list[str] = []
        for line_no, line in block:
            match = _TXT_PREFIX.match(line)
            if match:
                turns.append(Turn(role=match.group(1).lower(), text=match.group(2)))
            elif turns:
                prev = turns[-1]
                turns[-1] = Turn(prev.role, f"{prev.text}\n{line.strip()}")
            else:
                problems.append(f'line {line_no}: expected the turn to start with "Customer:" or "Assistant:"')
        conv = Conversation(turns=turns, source=source)
        _collect(result, start, conv, problems or validate_conversation(conv))
        block.clear()

    for line_no, line in enumerate(text.splitlines(), start=1):
        if line.strip():
            block.append((line_no, line))
        else:
            flush()
    flush()
    return result


def write_jsonl(path: str | Path, conversations: list[Conversation]) -> None:
    with Path(path).open("w", encoding="utf-8", newline="\n") as f:
        for conv in conversations:
            f.write(json.dumps(conv.to_dict(), ensure_ascii=False) + "\n")


__all__ = ["Issue", "LoadResult", "ROLES", "SUPPORTED_FORMATS", "load_dataset", "write_jsonl"]
