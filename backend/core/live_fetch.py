from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Sequence

import aiohttp
import aiosqlite

from ..db import CRYPTO_DB_PATH


DEFAULT_DB_PATH = Path(CRYPTO_DB_PATH)

BINANCE_BASE = "https://fapi.binance.com"
FETCH_LIMIT = 1500
CONCURRENCY = 5
WATCH_POLL_SECONDS = 60

PREFETCH_INTERVALS = ("15m", "1h", "4h", "1d")
PREFETCH_DAYS = 180
PREFETCH_TARGET = {
    "15m": 4 * 24 * PREFETCH_DAYS,
    "1h": 24 * PREFETCH_DAYS,
    "4h": 6 * PREFETCH_DAYS,
    "1d": PREFETCH_DAYS,
}

INTERVAL_MS = {
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "6h": 21_600_000,
    "8h": 28_800_000,
    "12h": 43_200_000,
    "1d": 86_400_000,
    "3d": 259_200_000,
    "1w": 604_800_000,
}

DONT_TRACK = {
    "USDCUSDT",
    "BTCSTUSDT",
    "1000WHYUSDT",
    "CELOUSDT",
    "BTCUSDT_260626",
    "DOGSUSDT",
    "GTCUSDT",
    "ICXUSDT",
    "DENTUSDT",
    "FLOWUSDT",
    "CTSIUSDT",
    "OGNUSDT",
    "C98USDT",
}

MAX_RETRIES = 6
INITIAL_BACKOFF = 10
MAX_BACKOFF = 120
HTTP_TIMEOUT = 30

log = logging.getLogger("fetch_klines")


class KlineStore:
    """Minimal SQLite wrapper for the shared klines table."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._conn: aiosqlite.Connection | None = None

    async def open(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self.path))
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA synchronous=NORMAL")
        await self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS klines (
                symbol    TEXT,
                interval  TEXT,
                timestamp INTEGER,
                open      REAL,
                high      REAL,
                low       REAL,
                close     REAL,
                volume    REAL,
                PRIMARY KEY (symbol, interval, timestamp)
            )
            """
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_symbol_interval ON klines(symbol, interval)"
        )
        await self._conn.commit()
        log.info("DB opened at %s", self.path)

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None

    async def last_timestamp(self, symbol: str, interval: str) -> int | None:
        assert self._conn
        cur = await self._conn.execute(
            "SELECT MAX(timestamp) FROM klines WHERE symbol=? AND interval=?",
            (symbol, interval),
        )
        row = await cur.fetchone()
        return row[0] if row and row[0] is not None else None

    async def save(self, symbol: str, interval: str, raw: list[Any]) -> int:
        assert self._conn
        if not raw:
            return 0

        records: list[tuple[str, str, int, float, float, float, float, float]] = []
        for kline in raw:
            try:
                records.append(
                    (
                        symbol,
                        interval,
                        int(kline[0]),
                        float(kline[1]),
                        float(kline[2]),
                        float(kline[3]),
                        float(kline[4]),
                        float(kline[5]),
                    )
                )
            except (IndexError, TypeError, ValueError):
                continue

        if not records:
            return 0

        await self._conn.executemany(
            """
            INSERT OR REPLACE INTO klines
                (symbol, interval, timestamp, open, high, low, close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            records,
        )
        await self._conn.commit()
        return len(records)


class BinanceError(Exception):
    pass


def _normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def _result(
    interval: str,
    added: int,
    last_ts: int | None,
    *,
    skipped: bool = False,
    reason: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "interval": interval,
        "added": added,
        "last_ts": last_ts,
    }
    if skipped:
        payload["skipped"] = True
    if reason:
        payload["reason"] = reason
    return payload


async def _get_json(session: aiohttp.ClientSession, url: str, params: dict[str, Any]) -> Any:
    backoff = INITIAL_BACKOFF
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            async with session.get(url, params=params, timeout=HTTP_TIMEOUT) as resp:
                if resp.status == 200:
                    return await resp.json()

                if resp.status in (418, 429):
                    retry_after = resp.headers.get("Retry-After")
                    wait = int(retry_after) if retry_after and retry_after.isdigit() else backoff
                    log.warning(
                        "Rate limited %s on %s, wait %ss [%d/%d]",
                        resp.status,
                        params.get("symbol", url),
                        wait,
                        attempt,
                        MAX_RETRIES,
                    )
                    await asyncio.sleep(wait)
                    backoff = min(backoff * 2, MAX_BACKOFF)
                    continue

                log.warning("HTTP %s on %s [%d/%d]", resp.status, params, attempt, MAX_RETRIES)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF)
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            log.warning("Network error on %s: %s [%d/%d]", params, exc, attempt, MAX_RETRIES)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF)

    raise BinanceError(f"Exceeded {MAX_RETRIES} retries for {url} {params}")


async def fetch_klines(
    session: aiohttp.ClientSession,
    symbol: str,
    interval: str,
    start_time: int | None = None,
    limit: int = FETCH_LIMIT,
) -> Any:
    params: dict[str, Any] = {
        "symbol": _normalize_symbol(symbol),
        "interval": interval,
        "limit": limit,
    }
    if start_time is not None:
        params["startTime"] = start_time
    return await _get_json(session, f"{BINANCE_BASE}/fapi/v1/klines", params)


async def list_symbols(session: aiohttp.ClientSession) -> list[str]:
    info = await _get_json(session, f"{BINANCE_BASE}/fapi/v1/exchangeInfo", {})
    return [
        entry["symbol"]
        for entry in info.get("symbols", [])
        if "USDT" in entry["symbol"]
        and entry.get("status") == "TRADING"
        and entry["symbol"] not in DONT_TRACK
    ]


async def _sync_symbol_interval(
    session: aiohttp.ClientSession,
    store: KlineStore,
    symbol: str,
    interval: str,
) -> dict[str, Any]:
    now_ms = int(datetime.now().timestamp() * 1000)
    step_ms = INTERVAL_MS.get(interval, 60_000)
    last_ts = await store.last_timestamp(symbol, interval)

    if last_ts is not None:
        if now_ms - last_ts < step_ms:
            return _result(interval, 0, last_ts, skipped=True, reason="not_due")

        data = await fetch_klines(session, symbol, interval, start_time=last_ts)
        added = await store.save(symbol, interval, data)
        next_last_ts = await store.last_timestamp(symbol, interval)
        if added:
            log.info("%-20s %-4s +%d (incremental)", symbol, interval, added)
        return _result(interval, added, next_last_ts)

    target = PREFETCH_TARGET.get(interval, 500)
    start = now_ms - target * step_ms
    total = 0

    while True:
        data = await fetch_klines(session, symbol, interval, start_time=start)
        if not data:
            break

        total += await store.save(symbol, interval, data)
        last_candle = int(data[-1][0])
        if last_candle >= now_ms - step_ms:
            break
        start = last_candle + 1

    next_last_ts = await store.last_timestamp(symbol, interval)
    if total:
        log.info("%-20s %-4s +%d (backfill)", symbol, interval, total)
    return _result(interval, total, next_last_ts)


async def sync_symbol_interval(
    symbol: str,
    interval: str,
    db_path: str | Path = CRYPTO_DB_PATH,
) -> dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    store = KlineStore(db_path)
    await store.open()
    try:
        async with aiohttp.ClientSession() as session:
            return await _sync_symbol_interval(session, store, normalized_symbol, interval)
    finally:
        await store.close()


async def sync_symbol(
    symbol: str,
    intervals: Iterable[str] = PREFETCH_INTERVALS,
    db_path: str | Path = CRYPTO_DB_PATH,
) -> list[dict[str, Any]]:
    normalized_symbol = _normalize_symbol(symbol)
    interval_list = tuple(dict.fromkeys(intervals))
    store = KlineStore(db_path)
    await store.open()
    try:
        async with aiohttp.ClientSession() as session:
            return list(
                await asyncio.gather(
                    *(
                        _sync_symbol_interval(session, store, normalized_symbol, interval)
                        for interval in interval_list
                    )
                )
            )
    finally:
        await store.close()


async def _sync_one_symbol(
    sem: asyncio.Semaphore,
    session: aiohttp.ClientSession,
    store: KlineStore,
    symbol: str,
    intervals: Sequence[str],
) -> None:
    async with sem:
        for interval in intervals:
            try:
                await _sync_symbol_interval(session, store, symbol, interval)
            except BinanceError as exc:
                log.error("Give up %s/%s: %s", symbol, interval, exc)


async def sync_all(
    session: aiohttp.ClientSession,
    store: KlineStore,
    symbols: Sequence[str],
    intervals: Sequence[str],
) -> None:
    sem = asyncio.Semaphore(CONCURRENCY)
    await asyncio.gather(
        *(_sync_one_symbol(sem, session, store, _normalize_symbol(symbol), intervals) for symbol in symbols)
    )


async def run_once(
    store: KlineStore,
    symbols: Sequence[str] | None,
    intervals: Sequence[str],
) -> None:
    async with aiohttp.ClientSession() as session:
        resolved_symbols = list(symbols or [])
        if not resolved_symbols:
            resolved_symbols = await list_symbols(session)
            log.info("Resolved %d tradable symbols", len(resolved_symbols))
        await sync_all(session, store, resolved_symbols, intervals)


async def run_watch(
    store: KlineStore,
    symbols: Sequence[str] | None,
    intervals: Sequence[str],
    poll: int,
    stop: asyncio.Event,
) -> None:
    async with aiohttp.ClientSession() as session:
        resolved_symbols = list(symbols or [])
        if not resolved_symbols:
            resolved_symbols = await list_symbols(session)
            log.info("Watching %d symbols every %ds", len(resolved_symbols), poll)

        tick = 0
        while not stop.is_set():
            tick += 1
            started = datetime.now()
            log.info("=== tick #%d @ %s ===", tick, started.strftime("%H:%M:%S"))
            try:
                await sync_all(session, store, resolved_symbols, intervals)
            except Exception:
                log.exception("Cycle failed")
            log.info("tick #%d done in %.1fs", tick, (datetime.now() - started).total_seconds())

            try:
                await asyncio.wait_for(stop.wait(), timeout=poll)
            except asyncio.TimeoutError:
                pass
