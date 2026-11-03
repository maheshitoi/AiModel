import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.engine import DEFAULT_FACTS
from app.server import create_app
from model import GPT, GPTConfig
from model.checkpoint import save_checkpoint
from tokenizer import BPETokenizer

TOKEN = "test-internal-token-" + "x" * 32
AUTH = {"X-Internal-Token": TOKEN}


@pytest.fixture(scope="session")
def checkpoint_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """An untrained model: its replies are random, so its confidence is always very low."""
    root = tmp_path_factory.mktemp("checkpoints")
    run = root / "test-run"
    run.mkdir()
    tok = BPETokenizer.train(["hello how can I help you today", "what are your opening hours", "thank you"] * 5, 300)
    tok.save(run / "tokenizer.json")
    shutil.copyfile(DEFAULT_FACTS, run / "business.json")
    save_checkpoint(run / "best.pt", GPT(GPTConfig(vocab_size=tok.vocab_size, context_length=32, n_embd=16, n_head=2, n_layer=1)), step=3)
    (root / "outside.pt").write_bytes(b"not a checkpoint")
    return root


def make_client(checkpoint_root: Path, **overrides) -> TestClient:
    values = {"checkpoint_dir": checkpoint_root, "ai_service_token": TOKEN, "ai_model_checkpoint": "test-run/best.pt", **overrides}
    return TestClient(create_app(Settings(_env_file=None, **values)))


@pytest.fixture
def client(checkpoint_root: Path):
    with make_client(checkpoint_root) as c:
        yield c
