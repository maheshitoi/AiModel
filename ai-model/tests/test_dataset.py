import json
from pathlib import Path

import numpy as np
import pytest

from dataset.build import AI_MODEL_ROOT, build
from dataset.cleaning import clean_text, deduplicate, fingerprint, mask_pii, split
from dataset.formats import load_dataset
from dataset.schema import Conversation, Turn, validate_conversation
from dataset.synthetic import INTENT_WEIGHTS, Business, generate
from tokenizer import BPETokenizer


def conv(*texts: str) -> Conversation:
    return Conversation([Turn("customer" if i % 2 == 0 else "assistant", t) for i, t in enumerate(texts)])


# ── formats ──────────────────────────────────────────────────────────────────
def test_load_json_and_wrapped_json(tmp_path: Path) -> None:
    record = {"messages": [{"role": "customer", "text": "Hi"}, {"role": "assistant", "content": "Hello"}], "intent": "greeting"}
    (tmp_path / "a.json").write_text(json.dumps([record]), encoding="utf-8")
    (tmp_path / "b.json").write_text(json.dumps({"conversations": [record, record]}), encoding="utf-8")

    a = load_dataset(tmp_path / "a.json")
    assert a.valid and a.record_count == 1 and a.conversations[0].intent == "greeting"
    assert a.conversations[0].turns[1].text == "Hello"  # "content" accepted as alias
    assert load_dataset(tmp_path / "b.json").record_count == 2


def test_jsonl_reports_line_numbers(tmp_path: Path) -> None:
    good = json.dumps({"messages": [{"role": "customer", "text": "Hi"}, {"role": "assistant", "text": "Hello"}]})
    wrong_order = json.dumps({"messages": [{"role": "assistant", "text": "Hello"}, {"role": "customer", "text": "Hi"}]})
    (tmp_path / "d.jsonl").write_text("\n".join([good, "{not json", "", wrong_order]), encoding="utf-8")

    result = load_dataset(tmp_path / "d.jsonl")
    assert result.record_count == 3 and len(result.conversations) == 1
    assert {i.record for i in result.issues} == {2, 4}
    assert any("invalid JSON" in i.message for i in result.issues)


def test_txt_format_with_continuation_lines(tmp_path: Path) -> None:
    (tmp_path / "d.txt").write_text(
        "Customer: What are your hours?\nAssistant: We are open 9 to 5.\nOn Saturday too.\n\n"
        "customer: thanks\nASSISTANT: You're welcome!\n\n"
        "Hello without prefix\nAssistant: hi\n",
        encoding="utf-8",
    )
    result = load_dataset(tmp_path / "d.txt")
    assert len(result.conversations) == 2
    assert result.conversations[0].turns[1].text == "We are open 9 to 5.\nOn Saturday too."
    assert result.issues[0].record == 8 and "Customer:" in result.issues[0].message


def test_unsupported_extension(tmp_path: Path) -> None:
    (tmp_path / "d.csv").write_text("x", encoding="utf-8")
    with pytest.raises(ValueError):
        load_dataset(tmp_path / "d.csv")


@pytest.mark.parametrize(
    "turns, fragment",
    [
        ([Turn("customer", "Hi")], "at least one"),
        ([Turn("customer", "Hi"), Turn("customer", "Hello")], "alternate"),
        ([Turn("customer", "Hi"), Turn("assistant", "  ")], "empty"),
        ([Turn("customer", "Hi"), Turn("bot", "Hello")], "unknown role"),
        ([Turn("customer", "Hi"), Turn("assistant", "Hey"), Turn("customer", "?")], "last turn"),
    ],
)
def test_validation_rules(turns: list[Turn], fragment: str) -> None:
    assert any(fragment in p for p in validate_conversation(Conversation(turns)))


# ── cleaning ─────────────────────────────────────────────────────────────────
def test_clean_text_normalises_and_truncates() -> None:
    assert clean_text("  Ｈｅｌｌｏ​   world \r\n\r\n  again\x07 ", 100) == "Hello world\nagain"
    assert clean_text("one two three four five", 12) == "one two"


def test_mask_pii() -> None:
    masked = mask_pii("Call me on +1 (555) 123-4567 or mail jane.doe@example.com, order 42")
    assert masked == "Call me on <phone> or mail <email>, order 42"


def test_dedup_ignores_case_and_whitespace() -> None:
    unique, dups = deduplicate([conv("Hi there", "Hello"), conv("hi   THERE", "hello"), conv("Bye", "Bye")])
    assert len(unique) == 2 and dups == 1


def test_split_is_deterministic_and_stable() -> None:
    data = [conv(f"question {i}", f"answer {i}") for i in range(2000)]
    train, val = split(data, 0.1)
    assert 120 < len(val) < 280  # ~10%
    # Adding data never moves existing conversations between splits.
    train2, val2 = split(data + [conv(f"new {i}", "x") for i in range(500)], 0.1)
    assert {fingerprint(c) for c in val} <= {fingerprint(c) for c in val2}
    assert not {fingerprint(c) for c in train} & {fingerprint(c) for c in val2}


# ── synthetic ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def business() -> Business:
    return Business.load(AI_MODEL_ROOT / "config" / "business.json")


def test_synthetic_is_reproducible_and_valid(business: Business) -> None:
    a, b = generate(business, 300, seed=7), generate(business, 300, seed=7)
    assert [c.to_dict() for c in a] == [c.to_dict() for c in b]
    assert all(not validate_conversation(c) for c in a)
    assert {c.intent for c in generate(business, 2000, seed=1)} == set(INTENT_WEIGHTS)


def test_synthetic_uses_business_facts(business: Business) -> None:
    replies = " ".join(t.text for c in generate(business, 500, seed=3) for t in c.turns if t.role == "assistant")
    assert business.address in replies and business.phone in replies
    assert business.services[0]["price"] in replies


def test_greeting_prefix_only_on_opening_message(business: Business) -> None:
    for c in generate(business, 2000, seed=9):
        for t in c.turns[2::2]:  # customer turns after the first
            assert not t.text.lower().startswith(("hi, ", "hello, ", "hey, ", "good morning, "))


def test_emergency_conversations_point_to_emergency_services(business: Business) -> None:
    for c in generate(business, 3000, seed=5):
        if c.intent == "emergency":
            assert business.emergency_note in c.turns[-1].text


# ── end-to-end build ─────────────────────────────────────────────────────────
def test_build_end_to_end(tmp_path: Path) -> None:
    config = json.loads((AI_MODEL_ROOT / "config" / "tiny-cpu.json").read_text(encoding="utf-8"))
    config["dataset"]["synthetic_conversations"] = 400
    config["tokenizer"]["vocab_size"] = 512
    cfg_path = tmp_path / "cfg.json"
    cfg_path.write_text(json.dumps(config), encoding="utf-8")
    extra = tmp_path / "approved.jsonl"
    extra.write_text(
        json.dumps({"messages": [{"role": "customer", "text": "My number is +44 7700 900123"}, {"role": "assistant", "text": "Thanks!"}]}) + "\n",
        encoding="utf-8",
    )

    out = tmp_path / "out"
    stats = build(cfg_path, [extra], out, use_synthetic=True, strict=True)

    assert stats["records"]["train"] + stats["records"]["validation"] == stats["records"]["unique"]
    assert stats["tokenizer"]["vocab_size"] <= 512
    tok = BPETokenizer.load(out / "tokenizer.json")
    train_ids = np.fromfile(out / "train.bin", dtype=np.uint16)
    assert len(train_ids) == stats["tokens"]["train"] and train_ids.max() < tok.vocab_size
    assert "<phone>" in (out / "train.jsonl").read_text(encoding="utf-8") + (out / "val.jsonl").read_text(encoding="utf-8")
    # The first training conversation decodes back to its role-tagged text.
    first = json.loads((out / "train.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert tok.decode(train_ids[:200].tolist()).startswith(f"<|customer|>{first['messages'][0]['text']}<|end|>")
