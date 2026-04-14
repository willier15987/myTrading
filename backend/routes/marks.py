import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..db import get_crypto_db, get_marks_db
from ..core.atr import atr as calc_atr
from ..core.candle_quality import candle_quality
from ..core.force_analysis import force_analysis
from ..core.displacement import displacement_efficiency

router = APIRouter()

LOOKBACK = 20
ATR_PERIOD = 14
VALID_LABEL_TYPES = {
    "bull_dominance",
    "bear_dominance",
    "force_shift",
    "valid_swing_high",
    "valid_swing_low",
}


class CreateMarkRequest(BaseModel):
    symbol: str
    interval: str
    timestamp: int
    label_type: str
    price: Optional[float] = None
    note: Optional[str] = None


class PatchMarkRequest(BaseModel):
    note: Optional[str] = None


def _parse_mark(row) -> dict:
    d = dict(row)
    if d.get("indicators"):
        try:
            d["indicators"] = json.loads(d["indicators"])
        except Exception:
            d["indicators"] = None
    return d


@router.get("/api/marks")
def get_marks(symbol: str, interval: str):
    conn = get_marks_db()
    try:
        rows = conn.execute(
            """
            SELECT id, symbol, interval, timestamp, label_type, price, note, indicators, created_at
            FROM marks
            WHERE symbol = ? AND interval = ?
            ORDER BY timestamp ASC
            """,
            (symbol, interval),
        ).fetchall()
    finally:
        conn.close()

    return [_parse_mark(r) for r in rows]


@router.post("/api/marks", status_code=201)
def create_mark(req: CreateMarkRequest):
    if req.label_type not in VALID_LABEL_TYPES:
        raise HTTPException(
            status_code=400, detail=f"Invalid label_type: {req.label_type}"
        )

    # ---- Compute indicator snapshot ----
    crypto_conn = get_crypto_db()
    try:
        rows = crypto_conn.execute(
            """
            SELECT timestamp, open, high, low, close, volume
            FROM klines
            WHERE symbol = ? AND interval = ? AND timestamp <= ?
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (req.symbol, req.interval, req.timestamp, LOOKBACK + ATR_PERIOD + 2),
        ).fetchall()
        candles = [dict(r) for r in reversed(rows)]
    finally:
        crypto_conn.close()

    indicators: dict = {}
    if candles:
        atr_value = calc_atr(candles, ATR_PERIOD)
        indicators["atr_14"] = round(atr_value, 4)

        target = next((c for c in candles if c["timestamp"] == req.timestamp), None)
        if target:
            indicators["candle_quality"] = candle_quality(target, atr_value)

        lookback_candles = candles[-LOOKBACK:]
        indicators[f"force_analysis_lookback_{LOOKBACK}"] = force_analysis(
            lookback_candles, atr_value
        )
        indicators[f"displacement_efficiency_lookback_{LOOKBACK}"] = round(
            displacement_efficiency(lookback_candles), 4
        )

    # ---- Persist ----
    marks_conn = get_marks_db()
    try:
        cursor = marks_conn.execute(
            """
            INSERT INTO marks (symbol, interval, timestamp, label_type, price, note, indicators)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                req.symbol,
                req.interval,
                req.timestamp,
                req.label_type,
                req.price,
                req.note,
                json.dumps(indicators),
            ),
        )
        marks_conn.commit()
        mark_id = cursor.lastrowid
        row = marks_conn.execute(
            "SELECT * FROM marks WHERE id = ?", (mark_id,)
        ).fetchone()
    finally:
        marks_conn.close()

    return _parse_mark(row)


@router.delete("/api/marks/{mark_id}")
def delete_mark(mark_id: int):
    conn = get_marks_db()
    try:
        result = conn.execute("DELETE FROM marks WHERE id = ?", (mark_id,))
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Mark not found")
    finally:
        conn.close()
    return {"deleted": True, "id": mark_id}


@router.patch("/api/marks/{mark_id}")
def patch_mark(mark_id: int, req: PatchMarkRequest):
    conn = get_marks_db()
    try:
        result = conn.execute(
            "UPDATE marks SET note = ? WHERE id = ?", (req.note, mark_id)
        )
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Mark not found")
        row = conn.execute(
            "SELECT * FROM marks WHERE id = ?", (mark_id,)
        ).fetchone()
    finally:
        conn.close()
    return _parse_mark(row)
