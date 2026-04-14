from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import get_crypto_db
from ..core.atr import atr as calc_atr
from ..core.candle_quality import candle_quality
from ..core.force_analysis import force_analysis
from ..core.displacement import displacement_efficiency

router = APIRouter()


class CandleIndicatorRequest(BaseModel):
    symbol: str
    interval: str
    timestamp: int
    atr_period: int = 14


class RangeIndicatorRequest(BaseModel):
    symbol: str
    interval: str
    start_ts: int
    end_ts: int
    atr_period: int = 14


def _fetch_candles_before(conn, symbol: str, interval: str, end_ts: int, limit: int) -> list[dict]:
    rows = conn.execute(
        """
        SELECT timestamp, open, high, low, close, volume
        FROM klines
        WHERE symbol = ? AND interval = ? AND timestamp <= ?
        ORDER BY timestamp DESC
        LIMIT ?
        """,
        (symbol, interval, end_ts, limit),
    ).fetchall()
    return [dict(r) for r in reversed(rows)]


@router.post("/api/indicators/candle")
def get_candle_indicators(req: CandleIndicatorRequest):
    conn = get_crypto_db()
    try:
        # Fetch target candle + enough history for ATR
        candles = _fetch_candles_before(
            conn, req.symbol, req.interval, req.timestamp, req.atr_period + 2
        )
    finally:
        conn.close()

    if not candles:
        raise HTTPException(status_code=404, detail="Candle not found")

    target = next((c for c in candles if c["timestamp"] == req.timestamp), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Candle not found at given timestamp")

    atr_value = calc_atr(candles, req.atr_period)
    quality = candle_quality(target, atr_value)
    quality["atr"] = round(atr_value, 4)
    return quality


@router.post("/api/indicators/range")
def get_range_indicators(req: RangeIndicatorRequest):
    conn = get_crypto_db()
    try:
        range_rows = conn.execute(
            """
            SELECT timestamp, open, high, low, close, volume
            FROM klines
            WHERE symbol = ? AND interval = ? AND timestamp BETWEEN ? AND ?
            ORDER BY timestamp ASC
            """,
            (req.symbol, req.interval, req.start_ts, req.end_ts),
        ).fetchall()
        range_candles = [dict(r) for r in range_rows]

        # Extra candles before range for ATR accuracy
        pre_rows = conn.execute(
            """
            SELECT timestamp, open, high, low, close, volume
            FROM klines
            WHERE symbol = ? AND interval = ? AND timestamp < ?
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (req.symbol, req.interval, req.start_ts, req.atr_period),
        ).fetchall()
        pre_candles = [dict(r) for r in reversed(pre_rows)]
    finally:
        conn.close()

    if not range_candles:
        raise HTTPException(status_code=404, detail="No candles found in range")

    all_candles = pre_candles + range_candles
    atr_value = calc_atr(all_candles, req.atr_period)
    fa = force_analysis(range_candles, atr_value)
    de = displacement_efficiency(range_candles)

    return {
        "candle_count": len(range_candles),
        "force_analysis": fa,
        "displacement_efficiency": round(de, 4),
        "atr": round(atr_value, 4),
    }
