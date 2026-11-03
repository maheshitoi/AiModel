"""Build the training dataset and tokenizer.

    python -m dataset.build --config config/tiny-cpu.json                      # synthetic data only
    python -m dataset.build --config config/tiny-cpu.json --input approved.jsonl --input faq.txt

Outputs (default dataset/processed/):
    train.jsonl, val.jsonl   cleaned, de-duplicated conversations
    tokenizer.json           byte-level BPE trained on the training split only
    train.bin, val.bin       uint16 token ids, conversations concatenated
    stats.json               counts, checksums and settings for reproducibility

Only files passed with --input are used besides the synthetic data. Customer conversations must be
reviewed and approved before they are exported to such a file (see docs).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from tokenizer import BPETokenizer

from .cleaning import clean_conversation, deduplicate, split
from .formats import load_dataset, write_jsonl
from .schema import Conversation, validate_conversation
from .synthetic import Business, generate

AI_MODEL_ROOT = Path(__file__).resolve().parents[1]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _encode(tokenizer: BPETokenizer, conversations: list[Conversation], path: Path) -> int:
    ids = [i for conv in conversations for i in tokenizer.encode_conversation(conv.turns)]
    np.asarray(ids, dtype=np.uint16).tofile(path)
    return len(ids)


def build(config_path: Path, inputs: list[Path], out_dir: Path, use_synthetic: bool, strict: bool) -> dict:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    ds_cfg, tok_cfg, seed = config["dataset"], config["tokenizer"], config["seed"]
    if tok_cfg["vocab_size"] > 65535:
        raise ValueError("vocab_size must fit in uint16 (<= 65535) for the .bin token files")
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    conversations: list[Conversation] = []
    sources: list[dict] = []
    if use_synthetic:
        business = Business.load(AI_MODEL_ROOT / ds_cfg["business_facts"])
        synthetic = generate(business, ds_cfg["synthetic_conversations"], seed)
        conversations += synthetic
        sources.append({"source": "synthetic", "records": len(synthetic), "issues": 0, "business": business.name})

    for path in inputs:
        result = load_dataset(path)
        for issue in result.issues[:20]:
            print(f"  {path.name}: record {issue.record}: {issue.message}", file=sys.stderr)
        if len(result.issues) > 20:
            print(f"  {path.name}: ... and {len(result.issues) - 20} more issues", file=sys.stderr)
        if result.issues and strict:
            raise SystemExit(f"{path} has {len(result.issues)} validation issue(s); fix them or drop --strict")
        conversations += result.conversations
        sources.append({"source": str(path), "records": result.record_count, "issues": len(result.issues), "sha256": _sha256(path)})

    if not conversations:
        raise SystemExit("No conversations to build from (enable synthetic data or pass --input files)")

    cleaned = [clean_conversation(c, ds_cfg["max_turn_chars"], ds_cfg["mask_customer_pii"]) for c in conversations]
    # Cleaning can empty a turn (e.g. text that was only control characters); drop those conversations.
    usable = [c for c in cleaned if not validate_conversation(c)]
    unique, duplicates = deduplicate(usable)
    train, val = split(unique, ds_cfg["validation_split"])
    if not val:
        raise SystemExit("Validation split is empty; add more data or increase validation_split")

    write_jsonl(out_dir / "train.jsonl", train)
    write_jsonl(out_dir / "val.jsonl", val)

    tok_started = time.perf_counter()
    tokenizer = BPETokenizer.train((t.text for c in train for t in c.turns), tok_cfg["vocab_size"])
    tokenizer_seconds = time.perf_counter() - tok_started
    tokenizer.save(out_dir / "tokenizer.json")

    train_tokens = _encode(tokenizer, train, out_dir / "train.bin")
    val_tokens = _encode(tokenizer, val, out_dir / "val.bin")
    train_chars = sum(len(t.text) for c in train for t in c.turns)

    stats = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "config": config["name"],
        "seed": seed,
        "sources": sources,
        "records": {
            "loaded": len(conversations),
            "dropped_after_cleaning": len(cleaned) - len(usable),
            "duplicates_removed": duplicates,
            "unique": len(unique),
            "train": len(train),
            "validation": len(val),
        },
        "intents": dict(Counter(c.intent or "unlabelled" for c in unique).most_common()),
        "tokenizer": {
            "requested_vocab_size": tok_cfg["vocab_size"],
            "vocab_size": tokenizer.vocab_size,
            "merges": len(tokenizer.merges),
            "training_seconds": round(tokenizer_seconds, 2),
            "chars_per_token": round(train_chars / max(1, train_tokens), 3),
        },
        "tokens": {"train": train_tokens, "validation": val_tokens},
        "files": {name: _sha256(out_dir / name) for name in ("train.jsonl", "val.jsonl", "tokenizer.json", "train.bin", "val.bin")},
        "seconds": round(time.perf_counter() - started, 2),
    }
    (out_dir / "stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the training dataset and tokenizer")
    parser.add_argument("--config", type=Path, required=True, help="model config JSON (e.g. config/tiny-cpu.json)")
    parser.add_argument("--input", type=Path, action="append", default=[], help="approved JSON/JSONL/TXT file (repeatable)")
    parser.add_argument("--out", type=Path, default=AI_MODEL_ROOT / "dataset" / "processed")
    parser.add_argument("--no-synthetic", action="store_true", help="use only --input files")
    parser.add_argument("--strict", action="store_true", help="fail if any input record is invalid")
    args = parser.parse_args()

    stats = build(args.config, args.input, args.out, use_synthetic=not args.no_synthetic, strict=args.strict)
    r, t = stats["records"], stats["tokenizer"]
    print(f"Conversations: {r['loaded']} loaded, {r['duplicates_removed']} duplicates removed, {r['train']} train / {r['validation']} validation")
    print(f"Tokenizer: vocab {t['vocab_size']} ({t['merges']} merges) in {t['training_seconds']} s, {t['chars_per_token']} chars/token")
    print(f"Tokens: {stats['tokens']['train']:,} train / {stats['tokens']['validation']:,} validation")
    print(f"Written to {args.out} in {stats['seconds']} s")


if __name__ == "__main__":
    main()
