"""Byte-level Byte-Pair-Encoding tokenizer, implemented from scratch.

Vocabulary layout (ids):
    0..255                      raw bytes (so any UTF-8 text is representable, no unknown token)
    256..256+M-1                learned merges, in the order they were learned (lower id = higher priority)
    256+M..256+M+S-1            special tokens (role markers etc.)

Special tokens are never produced by `encode(text)`. They are inserted only by
`encode_conversation`, so a customer typing "<|assistant|>" cannot forge a role switch.
"""

from __future__ import annotations

import heapq
import json
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from pathlib import Path

from dataset.schema import Turn

SPECIAL_TOKENS = ["<|pad|>", "<|customer|>", "<|assistant|>", "<|end|>", "<|system|>"]
FORMAT_VERSION = 1

# GPT-2 style pre-tokenisation: contractions, words with an optional leading space, short digit runs,
# punctuation runs, and whitespace. Merges never cross these boundaries.
PRETOKENIZE = re.compile(r"""'(?:[sdmt]|ll|ve|re)| ?[^\W\d_]+| ?\d{1,3}| ?[^\s\w]+|\s+(?!\S)|\s+""")

Pair = tuple[int, int]


def _merge(ids: Sequence[int], pair: Pair, new_id: int) -> list[int]:
    out: list[int] = []
    i = 0
    while i < len(ids):
        if i < len(ids) - 1 and ids[i] == pair[0] and ids[i + 1] == pair[1]:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


class BPETokenizer:
    def __init__(self, merges: list[Pair], special_tokens: Sequence[str] = SPECIAL_TOKENS):
        self.merges = [tuple(p) for p in merges]
        self.ranks: dict[Pair, int] = {p: i for i, p in enumerate(self.merges)}
        self.vocab: list[bytes] = [bytes([b]) for b in range(256)]
        for a, b in self.merges:
            self.vocab.append(self.vocab[a] + self.vocab[b])
        first_special = len(self.vocab)
        self.special_to_id = {tok: first_special + i for i, tok in enumerate(special_tokens)}
        self.id_to_special = {i: tok for tok, i in self.special_to_id.items()}
        self._cache: dict[bytes, list[int]] = {}

    # ── vocabulary ───────────────────────────────────────────────────────────
    @property
    def vocab_size(self) -> int:
        return len(self.vocab) + len(self.special_to_id)

    def special_id(self, token: str) -> int:
        return self.special_to_id[token]

    @property
    def pad_id(self) -> int:
        return self.special_to_id["<|pad|>"]

    @property
    def end_id(self) -> int:
        return self.special_to_id["<|end|>"]

    # ── training ─────────────────────────────────────────────────────────────
    @classmethod
    def train(
        cls,
        texts: Iterable[str],
        vocab_size: int,
        special_tokens: Sequence[str] = SPECIAL_TOKENS,
        min_frequency: int = 2,
    ) -> "BPETokenizer":
        """Learns up to vocab_size - 256 - len(special_tokens) merges. Deterministic for the same input.

        Pair counts are maintained incrementally: after each merge only the words containing the
        merged pair are re-counted. A max-heap with lazy invalidation finds the most frequent pair.
        """
        num_merges = vocab_size - 256 - len(special_tokens)
        if num_merges < 0:
            raise ValueError(f"vocab_size must be at least {256 + len(special_tokens)}")

        word_counts = Counter(chunk.encode("utf-8") for text in texts for chunk in PRETOKENIZE.findall(text))
        words: list[list[int]] = [list(w) for w in word_counts]
        counts: list[int] = list(word_counts.values())

        pair_counts: dict[Pair, int] = defaultdict(int)
        where: dict[Pair, set[int]] = defaultdict(set)
        for wi, w in enumerate(words):
            for pair in zip(w, w[1:]):
                pair_counts[pair] += counts[wi]
                where[pair].add(wi)
        # Ties break on the smaller pair, which keeps training deterministic.
        heap = [(-c, p) for p, c in pair_counts.items()]
        heapq.heapify(heap)

        merges: list[Pair] = []
        while len(merges) < num_merges and heap:
            neg_count, best = heapq.heappop(heap)
            if pair_counts.get(best, 0) != -neg_count:
                continue  # stale heap entry
            if -neg_count < min_frequency:
                break
            new_id = 256 + len(merges)
            merges.append(best)

            touched: set[Pair] = set()
            for wi in list(where[best]):
                w, c = words[wi], counts[wi]
                for pair in zip(w, w[1:]):
                    pair_counts[pair] -= c
                    where[pair].discard(wi)
                    touched.add(pair)
                w = _merge(w, best, new_id)
                words[wi] = w
                for pair in zip(w, w[1:]):
                    pair_counts[pair] += c
                    where[pair].add(wi)
                    touched.add(pair)
            for pair in touched:
                if pair_counts[pair] > 0:
                    heapq.heappush(heap, (-pair_counts[pair], pair))
                else:
                    pair_counts.pop(pair, None)
                    where.pop(pair, None)
            pair_counts.pop(best, None)
            where.pop(best, None)

        return cls(merges, special_tokens)

    # ── encoding / decoding ─────────────────────────────────────────────────
    def _encode_chunk(self, chunk: bytes) -> list[int]:
        cached = self._cache.get(chunk)
        if cached is not None:
            return cached
        ids = list(chunk)
        while len(ids) >= 2:
            # Apply the earliest-learned merge present in the sequence.
            pair = min(zip(ids, ids[1:]), key=lambda p: self.ranks.get(p, len(self.ranks)))
            rank = self.ranks.get(pair)
            if rank is None:
                break
            ids = _merge(ids, pair, 256 + rank)
        if len(self._cache) < 200_000:
            self._cache[chunk] = ids
        return ids

    def encode(self, text: str) -> list[int]:
        """Encodes plain text. Special-token strings in the text are treated as ordinary characters."""
        ids: list[int] = []
        for chunk in PRETOKENIZE.findall(text):
            ids.extend(self._encode_chunk(chunk.encode("utf-8")))
        return ids

    def encode_conversation(self, turns: Iterable[Turn], system: str | None = None) -> list[int]:
        """Training/inference layout: [<|system|> text <|end|>] (<|role|> text <|end|>)*"""
        ids: list[int] = []
        if system:
            ids += [self.special_to_id["<|system|>"], *self.encode(system), self.end_id]
        for turn in turns:
            ids += [self.special_to_id[f"<|{turn.role}|>"], *self.encode(turn.text), self.end_id]
        return ids

    def decode(self, ids: Iterable[int], skip_special: bool = False) -> str:
        parts: list[bytes] = []
        for i in ids:
            if i in self.id_to_special:
                if not skip_special:
                    parts.append(self.id_to_special[i].encode("utf-8"))
            elif 0 <= i < len(self.vocab):
                parts.append(self.vocab[i])
            else:
                raise ValueError(f"token id {i} is outside the vocabulary (size {self.vocab_size})")
        # A truncated multi-byte character (e.g. mid-generation) decodes to U+FFFD instead of raising.
        return b"".join(parts).decode("utf-8", errors="replace")

    # ── persistence ──────────────────────────────────────────────────────────
    def save(self, path: str | Path) -> None:
        data = {
            "format": "byte-level-bpe",
            "version": FORMAT_VERSION,
            "vocab_size": self.vocab_size,
            "pretokenize_pattern": PRETOKENIZE.pattern,
            "special_tokens": list(self.special_to_id),
            "merges": [list(p) for p in self.merges],
        }
        Path(path).write_text(json.dumps(data), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "BPETokenizer":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("format") != "byte-level-bpe" or data.get("version") != FORMAT_VERSION:
            raise ValueError(f"{path} is not a version-{FORMAT_VERSION} byte-level BPE tokenizer file")
        if data["pretokenize_pattern"] != PRETOKENIZE.pattern:
            raise ValueError("tokenizer was trained with a different pre-tokenisation pattern")
        tokenizer = cls([tuple(p) for p in data["merges"]], data["special_tokens"])
        if tokenizer.vocab_size != data["vocab_size"]:
            raise ValueError("tokenizer file is inconsistent: vocab_size does not match merges + special tokens")
        return tokenizer
