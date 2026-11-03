import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request

from app.engine import EngineBusy, NoModelLoaded
from app.guardrails import DEFAULT_FALLBACK
from app.pipeline import decide
from app.schemas import GenerateRequest, GenerateResponse, Usage
from app.security import require_internal_token
from dataset.schema import Turn
from model.chat import GenerationSettings

router = APIRouter(prefix="/v1", tags=["inference"], dependencies=[Depends(require_internal_token)])
log = logging.getLogger("ai_service.generate")


@router.post("/generate", response_model=GenerateResponse)
def generate(body: GenerateRequest, request: Request) -> GenerateResponse:
    """Decides the reply to the latest customer message. Runs in FastAPI's thread pool (CPU-bound)."""
    started = time.perf_counter()
    o = body.options
    settings = GenerationSettings(max_new_tokens=o.max_new_tokens, temperature=o.temperature, top_k=o.top_k, top_p=o.top_p, seed=o.seed)
    min_confidence = o.min_confidence if o.min_confidence is not None else request.app.state.settings.ai_min_confidence
    history = [Turn(m.role, m.text) for m in body.messages]
    try:
        d = decide(request.app.state.engine, history, settings, min_confidence, o.fallback_reply or DEFAULT_FALLBACK)
    except NoModelLoaded:
        raise HTTPException(503, "No model is loaded") from None
    except EngineBusy:
        raise HTTPException(503, "The model is busy, try again", headers={"Retry-After": "2"}) from None

    latency_ms = round((time.perf_counter() - started) * 1000)
    # Never log message text: ids, decision and timings only.
    log.info(
        "request_id=%s action=%s reason=%s confidence=%s tokens=%d+%d latency_ms=%d",
        body.request_id, d.action, d.reason, d.confidence, d.input_tokens, d.output_tokens, latency_ms,
    )
    return GenerateResponse(
        request_id=body.request_id,
        action=d.action,
        text=d.text,
        reason=d.reason,
        detail=d.detail,
        handoff_required=d.handoff_required,
        confidence=d.confidence,
        model_text=d.model_text,
        usage=Usage(input_tokens=d.input_tokens, output_tokens=d.output_tokens),
        latency_ms=latency_ms,
        model=d.model,
    )
