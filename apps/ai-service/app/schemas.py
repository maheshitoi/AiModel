from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .engine import ModelInfo

MessageText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4096)]


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["customer", "assistant"]
    text: MessageText


class GenerationOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_new_tokens: int = Field(64, ge=1, le=256)
    temperature: float = Field(0.0, ge=0, le=2, description="0 = greedy (recommended for the current model)")
    top_k: int = Field(0, ge=0, le=1000, description="0 disables top-k")
    top_p: float = Field(1.0, gt=0, le=1)
    seed: int | None = Field(None, ge=0, le=2**32 - 1)
    min_confidence: float | None = Field(None, ge=0, le=1, description="defaults to AI_MIN_CONFIDENCE")
    fallback_reply: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)] | None = None


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str | None = Field(None, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$", description="echoed back and logged")
    messages: list[ChatMessage] = Field(min_length=1, max_length=50, description="oldest first; the last one must be from the customer")
    options: GenerationOptions = Field(default_factory=GenerationOptions)

    @model_validator(mode="after")
    def _ends_with_customer(self) -> "GenerateRequest":
        if self.messages[-1].role != "customer":
            raise ValueError("the last message must be from the customer")
        return self


class Usage(BaseModel):
    input_tokens: int
    output_tokens: int


class GenerateResponse(BaseModel):
    request_id: str | None
    action: Literal["reply", "fallback", "handoff"]
    text: str = Field(description="safe to send: the model reply, the fallback reply or a fixed safety reply")
    reason: str
    detail: str | None
    handoff_required: bool
    confidence: float | None
    model_text: str | None = Field(description="the model's own reply, for review; never send it when action != reply")
    usage: Usage
    latency_ms: int
    model: ModelInfo | None


class LoadModelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    checkpoint: str = Field(min_length=1, max_length=300, description="relative to CHECKPOINT_DIR, e.g. tiny-cpu-v1/best.pt")


class CurrentModelResponse(BaseModel):
    loaded: bool
    model: ModelInfo | None
    last_load_error: str | None


class CheckpointFile(BaseModel):
    checkpoint: str
    size_bytes: int
    modified_at: str


# ── datasets, training, evaluation (Phase 14) ────────────────────────────────
JobId = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]


class StartTrainingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: JobId = Field(description="chosen by the backend (its TrainingJob id)")
    preset: str = Field(min_length=1, max_length=100, description="name of a config in ai-model/config/")
    max_steps: int | None = Field(None, ge=1, le=1_000_000, description="overrides the preset's training.max_steps")
    include_synthetic: bool = True
    dataset_ids: list[JobId] = Field(default_factory=list, max_length=50)


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    checkpoint: str = Field(min_length=1, max_length=300)
