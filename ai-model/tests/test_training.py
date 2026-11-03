import json
import math
from pathlib import Path

import numpy as np
import pytest
import torch

from dataset.build import AI_MODEL_ROOT, build
from dataset.schema import Turn
from model import GPT, GPTConfig
from model.chat import GenerationSettings, build_prompt, generate_reply
from model.checkpoint import load_model, read_checkpoint, save_checkpoint
from tokenizer import BPETokenizer
from training.data import IGNORE, TokenSplit, assistant_mask
from training.train import lr_at, make_optimizer, train


@pytest.fixture(scope="module")
def tok() -> BPETokenizer:
    return BPETokenizer.train(["hello there", "how can I help"] * 5, vocab_size=300)


@pytest.fixture(scope="module")
def run_env(tmp_path_factory) -> dict:
    """A tiny dataset + config shared by the training tests (built once)."""
    root = tmp_path_factory.mktemp("train")
    config = json.loads((AI_MODEL_ROOT / "config" / "tiny-cpu.json").read_text(encoding="utf-8"))
    config["dataset"]["synthetic_conversations"] = 600
    config["tokenizer"]["vocab_size"] = 400
    config["model"].update(context_length=32, n_embd=32, n_head=2, n_layer=2, dropout=0.0)
    config["training"].update(batch_size=8, max_steps=60, warmup_steps=5, log_interval=10, eval_interval=20,
                              eval_batches=2, checkpoint_interval=20, early_stop_patience=0, learning_rate=3e-3)
    cfg_path = root / "cfg.json"
    cfg_path.write_text(json.dumps(config), encoding="utf-8")
    data = root / "data"
    build(cfg_path, [], data, use_synthetic=True, strict=True)
    return {"root": root, "cfg": cfg_path, "data": data}


# ── data ─────────────────────────────────────────────────────────────────────
def test_assistant_mask_covers_reply_text_and_end_only(tok: BPETokenizer) -> None:
    ids = tok.encode_conversation([Turn("customer", "hello"), Turn("assistant", "how can I help"), Turn("customer", "there")])
    mask = assistant_mask(np.array(ids), tok)
    a, e = tok.special_id("<|assistant|>"), tok.end_id
    start = ids.index(a)
    end = ids.index(e, start)
    assert not mask[: start + 1].any()  # customer turn and the <|assistant|> marker itself
    assert mask[start + 1 : end + 1].all()  # reply text and its <|end|>
    assert not mask[end + 1 :].any()  # next customer turn


def test_batches_shift_targets_and_ignore_customer_tokens(tok: BPETokenizer, tmp_path: Path) -> None:
    ids = tok.encode_conversation([Turn("customer", "hello there"), Turn("assistant", "how can I help")] * 30)
    path = tmp_path / "t.bin"
    np.asarray(ids, dtype=np.uint16).tofile(path)
    split = TokenSplit(path, tok, "assistant")
    x, y = split.batch(4, 16, torch.Generator().manual_seed(0))
    assert x.shape == y.shape == (4, 16)
    kept = y != IGNORE
    assert kept.any() and (~kept).any()
    # Where a target is kept, it equals the next input token.
    torch.testing.assert_close(y[:, :-1][kept[:, :-1]], x[:, 1:][kept[:, :-1]])
    all_split = TokenSplit(path, tok, "all")
    assert (all_split.batch(4, 16, torch.Generator().manual_seed(0))[1] != IGNORE).all()


# ── schedule & optimiser ─────────────────────────────────────────────────────
def test_lr_schedule_warmup_then_cosine() -> None:
    cfg = {"learning_rate": 1e-3, "min_learning_rate": 1e-4, "warmup_steps": 100, "max_steps": 1000}
    assert lr_at(0, cfg) == pytest.approx(1e-5)
    assert lr_at(99, cfg) == pytest.approx(1e-3)
    assert lr_at(550, cfg) == pytest.approx(5.5e-4)  # halfway through the cosine
    assert lr_at(1000, cfg) == pytest.approx(1e-4)
    assert all(lr_at(s, cfg) >= lr_at(s + 1, cfg) for s in range(100, 999))


def test_weight_decay_only_on_matrices() -> None:
    model = GPT(GPTConfig(vocab_size=50, context_length=8, n_embd=16, n_head=2, n_layer=1))
    decay, no_decay = make_optimizer(model, 1e-3, 0.1).param_groups
    assert all(p.dim() >= 2 for p in decay["params"]) and all(p.dim() < 2 for p in no_decay["params"])
    assert len(decay["params"]) + len(no_decay["params"]) == len(list(model.parameters()))


# ── checkpoint & inference helpers ───────────────────────────────────────────
def test_checkpoint_round_trip(tok: BPETokenizer, tmp_path: Path) -> None:
    model = GPT(GPTConfig(vocab_size=tok.vocab_size, context_length=16, n_embd=16, n_head=2, n_layer=1, dropout=0.0))
    tok.save(tmp_path / "tokenizer.json")
    save_checkpoint(tmp_path / "m.pt", model, step=7)
    loaded, loaded_tok, meta = load_model(tmp_path / "m.pt")
    x = torch.randint(0, tok.vocab_size, (1, 16))
    torch.testing.assert_close(model.eval()(x)[0], loaded(x)[0])
    assert meta["step"] == 7 and loaded_tok.vocab_size == tok.vocab_size
    assert not (tmp_path / "m.pt.tmp").exists()


def test_build_prompt_drops_oldest_turns(tok: BPETokenizer) -> None:
    history = [Turn("customer" if i % 2 == 0 else "assistant", "how can I help " * 3) for i in range(9)]
    ids = build_prompt(tok, history, context_length=64, reserve=16)
    assert len(ids) <= 48
    assert ids[-1] == tok.special_id("<|assistant|>")
    assert ids[0] in (tok.special_id("<|customer|>"), tok.special_id("<|assistant|>"))  # starts on a turn boundary


# ── end-to-end training ──────────────────────────────────────────────────────
def test_training_learns_and_writes_run_files(run_env: dict) -> None:
    out = run_env["root"] / "run"
    summary = train(run_env["cfg"], run_env["data"], out)

    assert summary["status"] == "completed" and summary["steps"] == 60
    for name in ("config.json", "tokenizer.json", "best.pt", "last.pt", "metrics.jsonl", "status.json"):
        assert (out / name).exists(), name
    events = [json.loads(line) for line in (out / "metrics.jsonl").read_text(encoding="utf-8").splitlines()]
    evals = [e for e in events if e["type"] == "eval"]
    assert len(evals) == 3
    first_train = next(e for e in events if e["type"] == "train")
    assert evals[-1]["val_loss"] < first_train["train_loss"] - 1.0  # it learned something
    assert json.loads((out / "status.json").read_text())["status"] == "completed"
    best = read_checkpoint(out / "best.pt")
    assert best["best_val_loss"] == pytest.approx(min(e["val_loss"] for e in evals), abs=1e-3)


def test_resume_continues_from_last_checkpoint(run_env: dict) -> None:
    out = run_env["root"] / "resume"
    train(run_env["cfg"], run_env["data"], out, max_steps=40)
    summary = train(run_env["cfg"], run_env["data"], out, resume=True, max_steps=60)
    assert summary["steps"] == 60
    starts = [json.loads(l) for l in (out / "metrics.jsonl").read_text().splitlines() if '"start"' in l]
    assert [s["step"] for s in starts] == [0, 40] and starts[1]["resumed"]


def test_stop_file_stops_safely(run_env: dict, monkeypatch) -> None:
    out = run_env["root"] / "stop"
    out.mkdir()
    import training.train as tt

    original = tt.TokenSplit.batch
    calls = {"n": 0}

    def batch_then_request_stop(self, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 15:
            (out / "STOP").write_text("")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(tt.TokenSplit, "batch", batch_then_request_stop)
    summary = train(run_env["cfg"], run_env["data"], out)
    assert summary["status"] == "stopped" and 0 < summary["steps"] < 60
    assert read_checkpoint(out / "last.pt")["step"] == summary["steps"]
    assert not (out / "STOP").exists()


def test_generate_reply_and_evaluation_report(run_env: dict) -> None:
    from evaluation.evaluate import evaluate

    out = run_env["root"] / "run"
    model, tokenizer, _ = load_model(out / "best.pt")
    reply = generate_reply(model, tokenizer, [Turn("customer", "What are your opening hours?")], GenerationSettings(max_new_tokens=20))
    assert isinstance(reply.text, str) and 0 < reply.output_tokens <= 20

    report = evaluate(out / "best.pt", run_env["data"], AI_MODEL_ROOT / "config" / "business.json")
    assert set(report["groups"]) == {"in_distribution", "paraphrased", "safety", "out_of_scope"}
    assert report["validation"]["loss"] < report["validation"]["uniform_baseline_loss"]
    assert math.isfinite(report["validation"]["perplexity"])
    assert (out / "evaluation.md").read_text(encoding="utf-8").startswith("# Evaluation")
