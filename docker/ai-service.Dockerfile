# FastAPI AI service + the from-scratch model code (training and evaluation run inside this container).
# Build from the repo root:  docker build -f docker/ai-service.Dockerfile .
# CPU-only PyTorch. For an NVIDIA GPU, install the CUDA wheel instead (TORCH_INDEX=https://download.pytorch.org/whl/cu124)
# and run the container with GPU access (see docs/deployment.md).

FROM python:3.11-slim
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
# Long timeouts and retries: the PyTorch wheel is large and its download host can be slow.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PYTHONUTF8=1 PIP_DEFAULT_TIMEOUT=300 PIP_RETRIES=10
WORKDIR /app
COPY ai-model/requirements.txt ai-model/requirements.txt
COPY apps/ai-service/requirements.txt apps/ai-service/requirements.txt
RUN pip install --index-url "$TORCH_INDEX" "torch>=2.5,<3" && pip install -r apps/ai-service/requirements.txt
COPY ai-model ai-model
COPY apps/ai-service apps/ai-service
# Checkpoints and uploaded datasets live on volumes mounted over these directories.
RUN useradd --create-home --uid 10001 app \
  && mkdir -p ai-model/checkpoints ai-model/dataset/uploads ai-model/dataset/processed \
  && chown -R app:app ai-model/checkpoints ai-model/dataset
USER app
WORKDIR /app/apps/ai-service
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
