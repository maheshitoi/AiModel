import math

import pytest
import torch
import torch.nn.functional as F

from model import GPT, GPTConfig
from model.gpt import LayerNorm, MultiHeadAttention, sample_next

TINY = dict(vocab_size=64, context_length=16, n_embd=32, n_head=4, n_layer=2, dropout=0.0)


@pytest.fixture(autouse=True)
def _seed() -> None:
    torch.manual_seed(0)


def tiny(**overrides) -> GPT:
    return GPT(GPTConfig(**{**TINY, **overrides}))


# ── components ───────────────────────────────────────────────────────────────
def test_layernorm_matches_pytorch() -> None:
    ln = LayerNorm(32)
    with torch.no_grad():
        ln.weight.uniform_(0.5, 1.5)
        ln.bias.uniform_(-0.5, 0.5)
    x = torch.randn(3, 5, 32) * 4 + 2
    expected = F.layer_norm(x, (32,), ln.weight, ln.bias, eps=ln.eps)
    torch.testing.assert_close(ln(x), expected)


def test_attention_weights_are_causal_and_normalised() -> None:
    attn = MultiHeadAttention(GPTConfig(**TINY))
    q, k = torch.randn(2, 4, 10, 8), torch.randn(2, 4, 10, 8)
    w = attn.attention_weights(q, k)
    assert w.shape == (2, 4, 10, 10)
    torch.testing.assert_close(w.sum(-1), torch.ones(2, 4, 10))
    assert torch.all(w.triu(diagonal=1) == 0)  # nothing attends to the future


def test_manual_and_fused_attention_agree() -> None:
    manual = MultiHeadAttention(GPTConfig(**TINY, attention="manual"))
    fused = MultiHeadAttention(GPTConfig(**TINY, attention="sdpa"))
    fused.load_state_dict(manual.state_dict())
    x = torch.randn(2, 12, 32)
    torch.testing.assert_close(manual.eval()(x), fused.eval()(x), atol=1e-5, rtol=1e-5)


@pytest.mark.parametrize("attention", ["manual", "sdpa"])
def test_model_is_causal(attention: str) -> None:
    model = tiny(attention=attention).eval()
    a = torch.randint(0, 64, (1, 12))
    b = a.clone()
    b[0, 8:] = (b[0, 8:] + 1) % 64  # change only the future
    la, _ = model(a)
    lb, _ = model(b)
    torch.testing.assert_close(la[:, :8], lb[:, :8])
    assert not torch.allclose(la[:, 8:], lb[:, 8:])


def test_rejects_head_count_that_does_not_divide_width() -> None:
    with pytest.raises(ValueError):
        GPTConfig(vocab_size=10, n_embd=30, n_head=4)


# ── full model ───────────────────────────────────────────────────────────────
def test_forward_shapes_and_initial_loss() -> None:
    model = tiny()
    idx = torch.randint(0, 64, (4, 16))
    # Targets independent of the input: with tied embeddings, copying the *current* token already scores
    # slightly better than chance at init, so idx-as-targets would understate the loss.
    targets = torch.randint(0, 64, (4, 16))
    logits, loss = model(idx, targets)
    assert logits.shape == (4, 16, 64)
    # Small random init ⇒ near-uniform predictions ⇒ loss ≈ ln(V).
    assert abs(loss.item() - math.log(64)) < 0.3


def test_ignored_targets_are_excluded_from_loss() -> None:
    model = tiny().eval()
    idx = torch.randint(0, 64, (1, 16))
    targets = idx.clone()
    targets[0, :8] = -100
    logits, loss = model(idx, targets)
    expected = F.cross_entropy(logits[0, 8:], idx[0, 8:])
    torch.testing.assert_close(loss, expected)


def test_parameter_count_matches_formula() -> None:
    cfg = GPTConfig(**TINY)
    V, T, C, L = cfg.vocab_size, cfg.context_length, cfg.n_embd, cfg.n_layer
    per_block = (3 * C * C + 3 * C) + (C * C + C) + (4 * C * C + 4 * C) + (4 * C * C + C) + 4 * C  # attn, proj, mlp, 2×LN
    expected = V * C + T * C + L * per_block + 2 * C  # tied head adds nothing; final LN
    model = GPT(cfg)
    assert model.num_parameters() == expected
    assert model.lm_head.weight is model.token_emb.weight


def test_untied_head_adds_its_own_matrix() -> None:
    assert tiny(tie_embeddings=False).num_parameters() - tiny().num_parameters() == 64 * 32


def test_rejects_sequences_longer_than_context() -> None:
    with pytest.raises(ValueError):
        tiny()(torch.zeros(1, 17, dtype=torch.long))


def test_backprop_can_overfit_a_batch() -> None:
    """If gradients flow correctly, a small model memorises one fixed batch quickly."""
    model = tiny()
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3)
    data = torch.randint(0, 64, (4, 17))
    x, y = data[:, :-1], data[:, 1:]
    first = None
    for _ in range(300):
        _, loss = model(x, y)
        first = first or loss.item()
        opt.zero_grad()
        loss.backward()
        opt.step()
    assert first > 3.5 and loss.item() < 0.1


def test_every_parameter_receives_a_gradient() -> None:
    model = tiny()
    idx = torch.randint(0, 64, (2, 16))
    _, loss = model(idx, idx)
    loss.backward()
    missing = [n for n, p in model.named_parameters() if p.grad is None or not torch.any(p.grad != 0)]
    assert not missing


# ── generation ───────────────────────────────────────────────────────────────
def test_generate_respects_length_stop_and_greedy_determinism() -> None:
    model = tiny()
    prompt = torch.randint(0, 64, (1, 5))
    out = model.generate(prompt, max_new_tokens=10, temperature=0)
    assert out.shape == (10,)
    assert torch.equal(out, model.generate(prompt, max_new_tokens=10, temperature=0))
    stop = int(out[3])
    stopped = model.generate(prompt, max_new_tokens=10, temperature=0, stop_ids={stop})
    assert int(stopped[-1]) == stop and len(stopped) <= 4


def test_generate_crops_long_prompts_and_restores_mode() -> None:
    model = tiny().train()
    out = model.generate(torch.randint(0, 64, (1, 40)), max_new_tokens=3)
    assert out.shape == (3,) and model.training


def test_seeded_sampling_is_reproducible() -> None:
    model = tiny()
    prompt = torch.randint(0, 64, (1, 4))
    a = model.generate(prompt, 8, temperature=1.0, generator=torch.Generator().manual_seed(1))
    b = model.generate(prompt, 8, temperature=1.0, generator=torch.Generator().manual_seed(1))
    assert torch.equal(a, b)


def test_top_k_and_top_p_filtering() -> None:
    logits = torch.tensor([5.0, 4.0, 1.0, 0.0, -1.0])
    g = torch.Generator().manual_seed(0)
    assert {sample_next(logits, top_k=2, generator=g) for _ in range(200)} <= {0, 1}
    # p(token 0) ≈ 0.71, so top_p=0.5 keeps only token 0; top_p=0.9 keeps tokens 0 and 1.
    assert {sample_next(logits, top_p=0.5, generator=g) for _ in range(200)} == {0}
    assert {sample_next(logits, top_p=0.9, generator=g) for _ in range(200)} == {0, 1}
    assert sample_next(logits, temperature=0) == 0


def test_generate_reports_unscaled_token_probabilities() -> None:
    model = tiny()
    prompt = torch.randint(0, 64, (1, 5))
    probs: list[float] = []
    out = model.generate(prompt, 6, temperature=0, token_probs=probs)
    assert len(probs) == len(out) and all(0 < p <= 1 for p in probs)
    # Greedy picks the argmax, so its probability is the largest in the distribution.
    logits, _ = model(prompt)
    assert abs(probs[0] - torch.softmax(logits[0, -1], -1).max().item()) < 1e-6
    # Sampling temperature changes what is picked, not how the model's own probability is measured.
    hot: list[float] = []
    model.generate(prompt, 1, temperature=0.01, token_probs=hot)
    assert abs(hot[0] - probs[0]) < 1e-6
