"""FastAPI inference service for the self-trained GPT model.

Run from apps/ai-service:  python -m uvicorn main:app --port 8000
"""

import uvicorn
from fastapi import FastAPI

from app.config import get_settings
from routes.health import router as health_router

app = FastAPI(title="My Own AI - Inference Service", version="0.1.0")
app.include_router(health_router)

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run("main:app", host=settings.ai_service_host, port=settings.ai_service_port)
