from fastapi import APIRouter, Query
from typing import Optional

from ..db import get_crypto_db
from ..core.displacement import displacement_efficiency

router = APIRouter()


@router.get("/api/ranges")
def get_ranges(
    symbol: str,
    interval: str,
    min_bars: int = Query(10, ge=5, le=100),
    eff_threshold: float = Query(0.3, ge=0.05, le=0.6),
    lookback: int = Query(20, ge=10, le=60),
    end: Optional[int] = Query(None),
):
    """
    Detect consolidation / trading ranges using rolling displacement efficiency.

    A range is a contiguous block of at least `min_bars` candles where the
    rolling displacement efficiency stays below `eff_threshold`.
    """
    conn = get_crypto_db()
    try:
        if end is not None:
            rows = conn.execute(
                """
                SELECT timestamp, open, high, low, close, volume
                FROM klines
                WHERE symbol = ? AND interval = ? AND timestamp <= ?
                ORDER BY timestamp DESC
                LIMIT 800
                """,
                (symbol, interval, end),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT timestamp, open, high, low, close, volume
                FROM klines
                WHERE symbol = ? AND interval = ?
                ORDER BY timestamp DESC
                LIMIT 800
                """,
                (symbol, interval),
            ).fetchall()
        candles = [dict(r) for r in reversed(rows)]
    finally:
        conn.close()

    if len(candles) < lookback:
        return []

    # Rolling displacement efficiency for each candle
    eff_series: list[tuple[int, int, float]] = []  # (candle_idx, timestamp, eff)
    for i in range(lookback - 1, len(candles)):
        window = candles[i - lookback + 1 : i + 1]
        de = displacement_efficiency(window)
        eff_series.append((i, candles[i]["timestamp"], de))

    # Find contiguous blocks where eff < threshold
    ranges = []
    in_range = False
    block_start = 0

    def _build_range(start: int, end: int, active: bool) -> dict:
        cidx_s = eff_series[start][0]
        cidx_e = eff_series[end][0]
        block_candles = candles[cidx_s : cidx_e + 1]
        block_effs = [e[2] for e in eff_series[start : end + 1]]
        return {
            "start_ts": eff_series[start][1],
            "end_ts": eff_series[end][1],
            "upper": round(max(c["high"] for c in block_candles), 4),
            "lower": round(min(c["low"] for c in block_candles), 4),
            "bar_count": end - start + 1,
            "avg_efficiency": round(sum(block_effs) / len(block_effs), 4),
            "is_active": active,
        }

    for i, (_, _, de) in enumerate(eff_series):
        if de < eff_threshold:
            if not in_range:
                in_range = True
                block_start = i
        else:
            if in_range:
                in_range = False
                length = i - block_start
                if length >= min_bars:
                    ranges.append(_build_range(block_start, i - 1, False))

    # Currently active range
    if in_range:
        length = len(eff_series) - block_start
        if length >= min_bars:
            ranges.append(_build_range(block_start, len(eff_series) - 1, True))

    return ranges
