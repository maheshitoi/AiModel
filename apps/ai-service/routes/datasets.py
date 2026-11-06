from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.security import require_internal_token

router = APIRouter(prefix="/v1/datasets", tags=["datasets"], dependencies=[Depends(require_internal_token)])


def _store(request: Request):
    return request.app.state.datasets


def _call(fn):
    try:
        return fn()
    except FileNotFoundError:
        raise HTTPException(404, "Dataset file not found") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.put("/{dataset_id}")
async def upload(dataset_id: str, request: Request, format: Literal["json", "jsonl", "txt"] = Query()) -> dict:
    """Stores the raw file (request body) and returns its validation report."""
    limit = request.app.state.settings.dataset_max_bytes
    if int(request.headers.get("content-length") or 0) > limit:
        raise HTTPException(413, f"Dataset files are limited to {limit // 2**20} MB")
    data = await request.body()
    if len(data) > limit:
        raise HTTPException(413, f"Dataset files are limited to {limit // 2**20} MB")
    if not data.strip():
        raise HTTPException(400, "The file is empty")
    return _call(lambda: _store(request).save(dataset_id, format, data))


@router.post("/{dataset_id}/validate")
def validate(dataset_id: str, request: Request) -> dict:
    return _call(lambda: _store(request).report(dataset_id))


@router.get("/{dataset_id}/preview")
def preview(dataset_id: str, request: Request, offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)) -> dict:
    return _call(lambda: _store(request).preview(dataset_id, offset, limit))


@router.delete("/{dataset_id}", status_code=204)
def delete(dataset_id: str, request: Request) -> Response:
    _call(lambda: _store(request).delete(dataset_id))
    return Response(status_code=204)
