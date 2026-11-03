import torch
from fastapi import APIRouter
from pydantic import BaseModel

from app.config import get_settings

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    torch_version: str
    device: str
    cuda_available: bool
    cpu_threads: int
    checkpoint_dir_exists: bool
    model_loaded: bool


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    cuda = torch.cuda.is_available()
    return HealthResponse(
        status="ok",
        torch_version=torch.__version__,
        device="cuda" if cuda else "cpu",
        cuda_available=cuda,
        cpu_threads=torch.get_num_threads(),
        checkpoint_dir_exists=get_settings().checkpoint_path.is_dir(),
        model_loaded=False,  # Inference model loading arrives in Phase 9.
    )
