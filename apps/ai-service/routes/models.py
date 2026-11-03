import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.engine import CheckpointPathError, ModelInfo
from app.schemas import CheckpointFile, CurrentModelResponse, LoadModelRequest
from app.security import require_internal_token

router = APIRouter(prefix="/v1/models", tags=["models"], dependencies=[Depends(require_internal_token)])
log = logging.getLogger("ai_service.models")


@router.get("/current", response_model=CurrentModelResponse)
def current(request: Request) -> CurrentModelResponse:
    engine = request.app.state.engine
    loaded = engine.current
    return CurrentModelResponse(loaded=loaded is not None, model=loaded.info if loaded else None, last_load_error=engine.last_load_error)


@router.get("/checkpoints", response_model=list[CheckpointFile])
def checkpoints(request: Request) -> list[dict]:
    return request.app.state.engine.checkpoints()


@router.post("/load", response_model=ModelInfo)
def load(body: LoadModelRequest, request: Request) -> ModelInfo:
    """Loads a checkpoint and makes it the active model. The previous model keeps serving until it's ready."""
    try:
        return request.app.state.engine.load(body.checkpoint)
    except CheckpointPathError as exc:
        raise HTTPException(400, str(exc)) from None
    except FileNotFoundError:
        raise HTTPException(404, "Checkpoint not found") from None
    except Exception as exc:
        log.error("loading %s failed: %s", body.checkpoint, exc)
        raise HTTPException(422, "The checkpoint could not be loaded (see the AI service log)") from None
