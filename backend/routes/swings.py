from fastapi import APIRouter, Query

from ..db import get_crypto_db
from ..core.atr import atr as calc_atr
from ..core.swing_validity import find_pivots, is_valid_swing_high, is_valid_swing_low

router = APIRouter()


@router.get("/api/swings")
def get_swings(
    symbol: str,
    interval: str,
    pivot_n: int = Query(5, ge=2, le=20),
    limit: int = Query(500, ge=100, le=2000),
    approach: float = Query(0.5,  ge=0.0, le=1.0, description="推進段 force_ratio 門檻"),
    rejection: float = Query(0.55, ge=0.0, le=1.0, description="反轉段 force_ratio 門檻（對稱）"),
    departure_atr: float = Query(0.5, ge=0.0, le=5.0, description="離場 ATR 倍數門檻"),
):
    """
    Detect geometric pivot highs/lows in the most recent `limit` candles
    and validate each one using the three-condition swing validity check.
    """
    # Fetch enough candles: limit + buffer so pivots at the edges still have
    # enough neighbours for the validity lookback (default 5 each side)
    fetch_n = limit + pivot_n * 2 + 30

    conn = get_crypto_db()
    try:
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
        candles = [dict(r) for r in reversed(rows)]
    finally:
        conn.close()

    if not candles:
        return []

    atr_value = calc_atr(candles, 14)
    pivot_indices = find_pivots(candles, pivot_n)

    params = {
        "lookback": 5,
        "lookforward": 5,
        "min_approach_quality": approach,
        "min_rejection_force": rejection,
        "min_departure_atr": departure_atr,
    }

    results = []
    for pivot_type, idx in pivot_indices:
        c = candles[idx]
        price = c['high'] if pivot_type == 'high' else c['low']

        if pivot_type == 'high':
            is_valid, details = is_valid_swing_high(candles, idx, atr_value, params)
        else:
            is_valid, details = is_valid_swing_low(candles, idx, atr_value, params)

        results.append({
            'timestamp': c['timestamp'],
            'type': pivot_type,
            'price': round(price, 4),
            'is_valid': is_valid,
            'details': details,
        })

    return results
