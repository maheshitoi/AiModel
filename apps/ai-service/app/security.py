import hmac
from typing import Annotated

from fastapi import Header, HTTPException, Request


def require_internal_token(request: Request, x_internal_token: Annotated[str | None, Header()] = None) -> None:
    """Only the backend may call /v1 routes. It sends the shared AI_SERVICE_TOKEN in X-Internal-Token."""
    expected = request.app.state.settings.ai_service_token
    if expected is None:
        raise HTTPException(503, "AI_SERVICE_TOKEN is not configured")
    if x_internal_token is None or not hmac.compare_digest(x_internal_token.encode(), expected.get_secret_value().encode()):
        raise HTTPException(401, "Invalid or missing X-Internal-Token")
