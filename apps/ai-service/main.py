"""FastAPI inference service for the self-trained GPT model.

Run from apps/ai-service:  python -m uvicorn main:app --port 8000
"""

import logging

import uvicorn

from app.config import get_settings
from app.server import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = create_app()

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run("main:app", host=settings.ai_service_host, port=settings.ai_service_port)
