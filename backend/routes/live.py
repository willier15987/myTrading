from __future__ import annotations

import asyncio
import time
from collections.abc import Iterable

from fastapi import APIRouter, HTTPException, Query

from ..core.live_fetch import PREFETCH_INTERVALS, sync_symbol


router = APIRouter()

_locks: dict[str, asyncio.Lock] = {}
_locks_guard = asyncio.Lock()


def _get_lock(symbol: str) -> asyncio.Lock:
    if symbol not in _locks:
        _locks[symbol] = asyncio.Lock()
    return _locks[symbol]


async def _try_acquire(symbol: str) -> asyncio.Lock | None:
    async with _locks_guard:
        lock = _get_lock(symbol)
        if lock.locked():
            return None
        await lock.acquire()
        return lock


def _parse_intervals(raw: str | None) -> tuple[str, ...]:
    if raw is None or raw.strip() == "":
        return PREFETCH_INTERVALS

    requested = tuple(dict.fromkeys(part.strip() for part in raw.split(",") if part.strip()))
    invalid = [interval for interval in requested if interval not in PREFETCH_INTERVALS]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported intervals: {', '.join(invalid)}",
        )
    return requested


def _skipped_results(intervals: Iterable[str], reason: str) -> list[dict[str, object]]:
    return [
        {
            "interval": interval,
            "added": 0,
            "last_ts": None,
            "skipped": True,
            "reason": reason,
        }
        for interval in intervals
    ]


@router.post("/api/live/sync")
async def live_sync(
    symbol: str = Query(..., min_length=1),
    intervals: str | None = Query(None),
):
    normalized_symbol = symbol.strip().upper()
    if normalized_symbol == "":
        raise HTTPException(status_code=400, detail="symbol is required")

    interval_list = _parse_intervals(intervals)
    lock = await _try_acquire(normalized_symbol)

    if lock is None:
        results = _skipped_results(interval_list, "in_progress")
    else:
        try:
            results = await sync_symbol(normalized_symbol, interval_list)
        finally:
            lock.release()

    return {
        "symbol": normalized_symbol,
        "fetched_at": int(time.time() * 1000),
        "results": results,
    }
