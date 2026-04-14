from fastapi import APIRouter, Query
from typing import Optional

from ..db import get_crypto_db

router = APIRouter()

INTERVAL_ORDER = {"15m": 0, "1h": 1, "4h": 2, "1d": 3}


@router.get("/api/symbols")
def get_symbols():
    conn = get_crypto_db()
    try:
        rows = conn.execute("""
            SELECT symbol, interval,
                   MIN(timestamp) AS start_ts,
                   MAX(timestamp) AS end_ts,
                   COUNT(*)       AS count
            FROM klines
            GROUP BY symbol, interval
            ORDER BY symbol, interval
        """).fetchall()
    finally:
        conn.close()

    symbols: dict = {}
    for row in rows:
        sym = row["symbol"]
        if sym not in symbols:
            symbols[sym] = {"symbol": sym, "intervals": []}
        symbols[sym]["intervals"].append(
            {
                "interval": row["interval"],
                "start_ts": row["start_ts"],
                "end_ts": row["end_ts"],
                "count": row["count"],
            }
        )

    for sym_data in symbols.values():
        sym_data["intervals"].sort(
            key=lambda x: INTERVAL_ORDER.get(x["interval"], 99)
        )

    return list(symbols.values())


@router.get("/api/klines")
def get_klines(
    symbol: str,
    interval: str,
    start: Optional[int] = Query(None),
    end: Optional[int] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
):
    conn = get_crypto_db()
    try:
        if start is not None and end is not None:
            rows = conn.execute(
                """
                SELECT timestamp AS t, open AS o, high AS h, low AS l, close AS c, volume AS v
                FROM klines
                WHERE symbol = ? AND interval = ? AND timestamp BETWEEN ? AND ?
                ORDER BY timestamp ASC
                LIMIT ?
                """,
                (symbol, interval, start, end, limit),
            ).fetchall()

        elif start is not None:
            rows = conn.execute(
                """
                SELECT timestamp AS t, open AS o, high AS h, low AS l, close AS c, volume AS v
                FROM klines
                WHERE symbol = ? AND interval = ? AND timestamp >= ?
                ORDER BY timestamp ASC
                LIMIT ?
                """,
                (symbol, interval, start, limit),
            ).fetchall()

        elif end is not None:
            rows = conn.execute(
                """
                SELECT timestamp AS t, open AS o, high AS h, low AS l, close AS c, volume AS v
                FROM klines
                WHERE symbol = ? AND interval = ? AND timestamp <= ?
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (symbol, interval, end, limit),
            ).fetchall()
            rows = list(reversed(rows))

        else:
            # No bounds: return the most recent `limit` candles
            rows = conn.execute(
                """
                SELECT timestamp AS t, open AS o, high AS h, low AS l, close AS c, volume AS v
                FROM klines
                WHERE symbol = ? AND interval = ?
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (symbol, interval, limit),
            ).fetchall()
            rows = list(reversed(rows))

    finally:
        conn.close()

    return {
        "symbol": symbol,
        "interval": interval,
        "candles": [dict(row) for row in rows],
    }
