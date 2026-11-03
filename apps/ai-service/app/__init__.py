"""Inference service package. The tokenizer and model code live in ai-model/ and are imported from there."""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
AI_MODEL_DIR = REPO_ROOT / "ai-model"

if str(AI_MODEL_DIR) not in sys.path:
    sys.path.insert(0, str(AI_MODEL_DIR))
