from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.engine import CheckpointPathError
from app.jobs import EvaluationUnavailable, JobConflict, JobNotFound
from app.schemas import EvaluationRequest, StartTrainingRequest
from app.security import require_internal_token

router = APIRouter(prefix="/v1", tags=["training"], dependencies=[Depends(require_internal_token)])


def _call(fn):
    try:
        return fn()
    except JobConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except JobNotFound:
        raise HTTPException(404, "Training job not found") from None
    except FileNotFoundError as exc:
        raise HTTPException(404, "Checkpoint not found" if not str(exc).startswith("dataset") else str(exc)) from None
    except (CheckpointPathError, EvaluationUnavailable, ValueError) as exc:
        raise HTTPException(400, str(exc)) from None


@router.get("/training/presets")
def presets(request: Request) -> list[dict]:
    return request.app.state.training.presets()


@router.post("/training/jobs", status_code=201)
def start(body: StartTrainingRequest, request: Request) -> dict:
    """Starts training in a separate process. One job at a time (409 while another is running)."""
    return _call(lambda: request.app.state.training.start(body.job_id, body.preset, body.max_steps, body.include_synthetic, body.dataset_ids))


@router.get("/training/jobs/{job_id}")
def job(job_id: str, request: Request, since_step: int = Query(0, ge=0)) -> dict:
    """State, progress and the train/eval metric events at or after since_step."""
    return _call(lambda: request.app.state.training.get(job_id, since_step))


@router.post("/training/jobs/{job_id}/stop")
def stop(job_id: str, request: Request) -> dict:
    """Asks the job to stop: it saves last.pt first. Safe to call more than once."""
    return _call(lambda: request.app.state.training.stop(job_id))


@router.post("/evaluations", status_code=202)
def evaluate(body: EvaluationRequest, request: Request) -> dict:
    return _call(lambda: request.app.state.evaluations.start(body.checkpoint))


@router.get("/evaluations")
def evaluation(request: Request, checkpoint: str = Query(min_length=1, max_length=300)) -> dict:
    return _call(lambda: request.app.state.evaluations.get(checkpoint))
