import torch
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    torch_version: str
    device: str
    cuda_available: bool
    cpu_threads: int
    checkpoint_dir_exists: bool
    model_loaded: bool
    model_name: str | None


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    cuda = torch.cuda.is_available()
    loaded = request.app.state.engine.current
    return HealthResponse(
        status="ok",
        torch_version=torch.__version__,
        device="cuda" if cuda else "cpu",
        cuda_available=cuda,
        cpu_threads=torch.get_num_threads(),
        checkpoint_dir_exists=request.app.state.settings.checkpoint_path.is_dir(),
        model_loaded=loaded is not None,
        model_name=loaded.info.name if loaded else None,
    )
