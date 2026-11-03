# Dataset & tokenizer (Phase 6)

Everything here is plain Python and NumPy, written from scratch. No pretrained tokenizer or
model weights are used.

## Build

```powershell
npm run ai:data
# or, from ai-model/:
..\.venv\Scripts\python.exe -m dataset.build --config config/tiny-cpu.json [--input approved.jsonl ...] [--no-synthetic] [--strict]
```

Outputs go to `ai-model/dataset/processed/` (git-ignored; rebuild any time):

| File | Contents |
|---|---|
| `train.jsonl`, `val.jsonl` | cleaned, de-duplicated conversations |
| `tokenizer.json` | BPE merges + special tokens (trained on `train.jsonl` only) |
| `train.bin`, `val.bin` | token ids as `uint16`, conversations concatenated |
| `stats.json` | counts, intent mix, tokenizer stats, SHA-256 of every output |

The build is **deterministic**: the same config, seed and inputs give byte-identical files (verified).

## Pipeline

1. **Sources.** Synthetic conversations from `config/business.json` (edit it with your real details),
   plus any approved files passed with `--input`.
2. **Load & validate** (`dataset/formats.py`). JSON, JSONL and TXT files are checked. Each problem
   is reported with its record or line number. Invalid records are skipped, or the build fails with `--strict`.
3. **Clean** (`dataset/cleaning.py`):
   - Unicode NFKC normalisation and removal of control and zero-width characters.
   - Whitespace collapsing, and truncation to `max_turn_chars` at a word boundary.
   - **Phone numbers and emails in customer turns are replaced** with `<phone>` / `<email>`.
     Assistant turns are left alone, since they legitimately contain the business's own contact details.
4. **De-duplicate.** Conversations are compared by a hash of their text, ignoring case and whitespace.
5. **Split.** Each conversation goes to train or validation by its content hash. Adding data never moves
   an existing conversation between splits, so validation data can't leak into training.
6. **Tokenize.** A byte-level BPE is trained on the training split, then both splits are encoded.

## File formats

```jsonc
// JSONL: one conversation per line (JSON: an array of these, or {"conversations": [...]})
{"messages": [{"role": "customer", "text": "Are you open Sunday?"},
              {"role": "assistant", "text": "Sorry, we are closed on Sunday."}],
 "intent": "hours"}
```

```text
# TXT: blank line between conversations
Customer: Are you open Sunday?
Assistant: Sorry, we are closed on Sunday.
```

Rules: roles alternate, starting with `customer` and ending with `assistant`, and no turn may be empty.

## Tokenizer (`tokenizer/bpe.py`)

- **Byte-level.** The 256 base tokens are raw bytes, so any text, including emoji and any script,
  is encodable. There is no "unknown" token.
- **Pre-tokenisation** (GPT-2 style regex) keeps merges inside words, numbers and punctuation runs.
- **Training** maintains pair counts incrementally and uses a lazily cleaned max-heap. Ties break on
  the smaller pair, which keeps training deterministic.
- **Special tokens** come after the merges: `<|pad|> <|customer|> <|assistant|> <|end|> <|system|>`.
  Conversation layout: `<|customer|>text<|end|><|assistant|>text<|end|>…`
- **Injection-safe.** `encode(text)` never emits special tokens, so a customer typing
  `<|assistant|>` can't forge a role switch. Role tokens are inserted only by `encode_conversation`.

## Current numbers (tiny-cpu, synthetic only)

| | |
|---|---|
| Conversations | 10,000 generated → 7,406 unique (6,657 train / 749 validation) |
| Vocabulary | **1,129** (868 merges) of 4,096 requested |
| Compression | 3.65 characters per token |
| Tokens | 467,584 train / 52,180 validation |
| Build time | ~2 s |

**Why the vocabulary is smaller than configured:** BPE only merges pairs that occur at least twice.
The templates use a small set of words, so after ~870 merges almost every word is already one token.
That is a property of the data, not a bug. The model's embedding size follows the tokenizer's
*actual* vocabulary, which saves parameters. Adding varied real data grows the vocabulary.

## Limitations (read before training)

- The synthetic data teaches **the templates and your business facts, nothing more**. Expect good
  answers to phrasings close to the templates, and poor answers to unusual ones. For example, "teeth
  whitening" tokenizes into fragments because the data never contains it.
- 25% of generated conversations were exact duplicates and were removed. Diversity, not volume, is
  what limits this dataset.
- The best improvement is **reviewed, approved real conversations** (and more templates). Customer
  messages are never added automatically. Export only approved conversations to a file and pass it
  with `--input`. Phase 14 adds review and approval in the dashboard.
