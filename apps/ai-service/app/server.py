import json
import logging
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from routes.datasets import router as datasets_router
from routes.generate import router as generate_router
from routes.health import router as health_router
from routes.models import router as models_router
from routes.training import router as training_router

from .config import Settings, get_settings
from .engine import Engine
from .jobs import DatasetStore, EvaluationManager, TrainingManager

log = logging.getLogger("ai_service")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = Engine(settings.checkpoint_path, settings.ai_queue_timeout_seconds)
    # Uploads are validated with the default preset's cleaning rules (all presets share them).
    default_preset = json.loads((settings.presets_path / f"{settings.training_default_preset}.json").read_text(encoding="utf-8"))
    datasets = DatasetStore(settings.dataset_path, default_preset["dataset"])
    training = TrainingManager(settings.checkpoint_path, settings.presets_path, datasets)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if settings.ai_torch_threads:
            torch.set_num_threads(settings.ai_torch_threads)
        if settings.ai_service_token is None:
            log.warning("AI_SERVICE_TOKEN is not set: /v1 routes will refuse every request")
        if settings.ai_model_checkpoint:
            try:
                engine.load(settings.ai_model_checkpoint)
            except Exception as exc:  # start anyway: /health reports it and the backend can load another one
                log.error("could not load %s: %s", settings.ai_model_checkpoint, exc)
        else:
            log.warning("AI_MODEL_CHECKPOINT is not set: no model loaded")
        yield

    app = FastAPI(title="My Own AI - Inference Service", version="0.9.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.datasets = datasets
    app.state.training = training
    app.state.evaluations = EvaluationManager(engine)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI echoes the offending input by default, which would copy customer messages into the
        # backend's error logs. Return only where and why.
        errors = [{"loc": list(e.get("loc", ())), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors})

    app.include_router(health_router)
    app.include_router(generate_router)
    app.include_router(models_router)
    app.include_router(datasets_router)
    app.include_router(training_router)
    return app
