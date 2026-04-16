from fastapi import APIRouter, Query
from typing import Optional

from ..db import get_crypto_db
from ..core.atr import atr as calc_atr
from ..core.force_analysis import force_analysis
from ..core.displacement import displacement_efficiency

router = APIRouter()


@router.get("/api/indicators/series")
def get_indicator_series(
    symbol: str,
    interval: str,
    lookback: int = Query(20, ge=5, le=100),
    limit: int = Query(500, ge=50, le=2000),
    end: Optional[int] = Query(None),
):
    """
    For each candle in the most recent `limit` candles, compute a rolling
    force_analysis and displacement_efficiency using a window of `lookback` bars.
    Returns a time series suitable for sub-chart display.
    """
    fetch_n = limit + lookback + 14  # extra for ATR warmup

    conn = get_crypto_db()
    try:
        if end is not None:
            rows = conn.execute(
                """
                SELECT timestamp, open, high, low, close, volume
                FROM klines
                WHERE symbol = ? AND interval = ? AND timestamp <= ?
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (symbol, interval, end, fetch_n),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT timestamp, open, high, low, close, volume
                FROM klines
                WHERE symbol = ? AND interval = ?
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (symbol, interval, fetch_n),
            ).fetchall()
        all_candles = [dict(r) for r in reversed(rows)]
    finally:
        conn.close()

    if not all_candles:
        return {"series": []}

    atr_value = calc_atr(all_candles, 14)

    results = []
    start_idx = max(lookback, len(all_candles) - limit)

    for i in range(start_idx, len(all_candles)):
        window = all_candles[i - lookback + 1 : i + 1]
        fa = force_analysis(window, atr_value)
        de = displacement_efficiency(window)

        results.append({
            "t": all_candles[i]["timestamp"],
            "force_ratio": fa["force_ratio"],
            "count_ratio": fa["count_ratio"],
            "quality_ratio": round(min(fa["quality_ratio"], 5.0), 4),
            "displacement_efficiency": de,
        })

    return {"series": results}
