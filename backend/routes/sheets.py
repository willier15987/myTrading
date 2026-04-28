import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

WEBAPP_ENV = "GOOGLE_SHEET_WEBAPP_URL"
TOKEN_ENV = "GOOGLE_SHEET_UPLOAD_TOKEN"


class SheetPosition(BaseModel):
    id: str
    symbol: str
    interval: str
    direction: Literal["long", "short"]
    entry_ts: int
    entry_price: float
    tp_price: float
    sl_price: float
    exit_ts: Optional[int] = None
    exit_price: Optional[float] = None
    entry_reason: str = ""
    exit_reason: str = ""
    created_at: str


class UploadReplayPositionsRequest(BaseModel):
    positions: List[SheetPosition]
    timezone: str = "Asia/Taipei"


@router.post("/api/sheets/replay-positions")
def upload_replay_positions(req: UploadReplayPositionsRequest):
    webapp_url = _get_setting(WEBAPP_ENV)
    if not webapp_url:
        raise HTTPException(
            status_code=500,
            detail=f"{WEBAPP_ENV} is not configured.",
        )

    payload = _model_dump(req)
    token = _get_setting(TOKEN_ENV)
    if token:
        payload["token"] = token

    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        webapp_url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(
            status_code=502,
            detail=f"Google Sheet upload failed: HTTP {exc.code}: {detail}",
        ) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Google Sheet upload failed: {exc.reason}",
        ) from exc

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Google Sheet upload returned non-JSON response: {raw[:200]}",
        ) from exc

    if not result.get("ok"):
        raise HTTPException(
            status_code=502,
            detail=result.get("error") or "Google Sheet upload failed.",
        )

    return result


def _model_dump(model: BaseModel) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _get_setting(name: str) -> Optional[str]:
    value = os.getenv(name)
    if value:
        return value
    return _read_dotenv().get(name)


def _read_dotenv() -> dict:
    path = Path(__file__).resolve().parents[2] / ".env"
    if not path.exists():
        return {}

    settings = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            settings[key] = value
    return settings
