"""
fetch_klines.py — Binance USDT 永續合約 K 線抓取器

輸出：./data/crypto_data.db（與 marks.db 同目錄）
只建立 klines 表，schema 與後端 backend/db.py 讀取的格式一致。

用法：
  python fetch_klines.py                          # 全幣種全時框抓一次
  python fetch_klines.py --symbols BTCUSDT ETHUSDT
  python fetch_klines.py --intervals 1h 4h
  python fetch_klines.py --watch                  # 持續模式，每 60 秒輪詢
  python fetch_klines.py --watch --poll 30
  python fetch_klines.py --interactive            # 舊版互動模式

按 Ctrl+C 可隨時優雅退出。

注意：要讓 FastAPI 後端改讀這個 DB，請把 backend/db.py 的 CRYPTO_DB_PATH
改為本檔產出的路徑（預設 ./data/crypto_data.db）。
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys
from datetime import datetime
from pathlib import Path

import aiohttp
import aiosqlite


# === 設定 =====================================================================

DEFAULT_DB_PATH = Path(__file__).parent / "data" / "crypto_data.db"

BINANCE_BASE = "https://fapi.binance.com"
FETCH_LIMIT = 1500            # Binance 單次請求上限
CONCURRENCY = 5               # 同時並發的 symbol 數
WATCH_POLL_SECONDS = 60       # watch 模式兩輪之間的間隔

PREFETCH_INTERVALS = ("15m", "1h", "4h", "1d")
PREFETCH_DAYS = 180
PREFETCH_TARGET = {
    "15m": 4 * 24 * PREFETCH_DAYS,   # 17280
    "1h":  24 * PREFETCH_DAYS,       # 4320
    "4h":  6 * PREFETCH_DAYS,        # 1080
    "1d":  PREFETCH_DAYS,            # 180
}

INTERVAL_MS = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
    "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
    "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000,
    "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
    "1w": 604_800_000,
}

DONT_TRACK = {
    "USDCUSDT", "BTCSTUSDT", "1000WHYUSDT", "CELOUSDT",
    "BTCUSDT_260626", "DOGSUSDT", "GTCUSDT", "ICXUSDT",
    "DENTUSDT", "FLOWUSDT", "CTSIUSDT", "OGNUSDT", "C98USDT",
}

MAX_RETRIES = 6
INITIAL_BACKOFF = 10
MAX_BACKOFF = 120
HTTP_TIMEOUT = 30

log = logging.getLogger("fetch_klines")


# === 資料庫層 =================================================================

class KlineStore:
    """最小化 SQLite wrapper，只處理 klines 表。啟用 WAL 讓後端讀取不被阻塞。"""

    def __init__(self, path: Path):
        self.path = path
        self._conn: aiosqlite.Connection | None = None

    async def open(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self.path))
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA synchronous=NORMAL")
        await self._conn.execute("""
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
        """)
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

    async def save(self, symbol: str, interval: str, raw: list) -> int:
        assert self._conn
        if not raw:
            return 0
        records = []
        for k in raw:
            try:
                records.append((
                    symbol, interval, int(k[0]),
                    float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]),
                ))
            except (ValueError, IndexError, TypeError):
                continue
        if not records:
            return 0
        await self._conn.executemany(
            """INSERT OR REPLACE INTO klines
               (symbol, interval, timestamp, open, high, low, close, volume)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            records,
        )
        await self._conn.commit()
        return len(records)


# === HTTP 層 ==================================================================

class BinanceError(Exception):
    pass


async def _get_json(session: aiohttp.ClientSession, url: str, params: dict):
    """有界重試 + 尊重 Retry-After。遇 418/429 退避，網路錯誤指數退避。"""
    backoff = INITIAL_BACKOFF
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            async with session.get(url, params=params, timeout=HTTP_TIMEOUT) as resp:
                if resp.status == 200:
                    return await resp.json()
                if resp.status in (418, 429):
                    retry_after = resp.headers.get("Retry-After")
                    wait = int(retry_after) if retry_after and retry_after.isdigit() else backoff
                    log.warning("Rate limited %s on %s, wait %ss [%d/%d]",
                                resp.status, params.get("symbol", url), wait, attempt, MAX_RETRIES)
                    await asyncio.sleep(wait)
                    backoff = min(backoff * 2, MAX_BACKOFF)
                    continue
                log.warning("HTTP %s on %s [%d/%d]", resp.status, params, attempt, MAX_RETRIES)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF)
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            log.warning("Network error on %s: %s [%d/%d]", params, e, attempt, MAX_RETRIES)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF)
    raise BinanceError(f"Exceeded {MAX_RETRIES} retries for {url} {params}")


async def fetch_klines(session, symbol: str, interval: str,
                       start_time: int | None = None, limit: int = FETCH_LIMIT):
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    if start_time:
        params["startTime"] = start_time
    return await _get_json(session, f"{BINANCE_BASE}/fapi/v1/klines", params)


async def list_symbols(session) -> list[str]:
    info = await _get_json(session, f"{BINANCE_BASE}/fapi/v1/exchangeInfo", {})
    return [
        s["symbol"] for s in info.get("symbols", [])
        if "USDT" in s["symbol"]
        and s.get("status") == "TRADING"
        and s["symbol"] not in DONT_TRACK
    ]


# === 同步邏輯 =================================================================

async def _sync_symbol_interval(session, store: KlineStore, symbol: str, interval: str):
    now_ms = int(datetime.now().timestamp() * 1000)
    step_ms = INTERVAL_MS.get(interval, 60_000)
    last_ts = await store.last_timestamp(symbol, interval)

    if last_ts is not None:
        # 已有資料：若上一根還沒收（距今不到一根週期），跳過
        if now_ms - last_ts < step_ms:
            return
        data = await fetch_klines(session, symbol, interval, start_time=last_ts)
        saved = await store.save(symbol, interval, data)
        if saved:
            log.info("%-20s %-4s +%d (incremental)", symbol, interval, saved)
        return

    # 冷啟動：從 PREFETCH_DAYS 天前分批抓到現在
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
    if total:
        log.info("%-20s %-4s +%d (backfill)", symbol, interval, total)


async def _sync_one_symbol(sem, session, store, symbol, intervals):
    async with sem:
        for interval in intervals:
            try:
                await _sync_symbol_interval(session, store, symbol, interval)
            except BinanceError as e:
                log.error("Give up %s/%s: %s", symbol, interval, e)


async def sync_all(session, store: KlineStore, symbols: list[str], intervals):
    sem = asyncio.Semaphore(CONCURRENCY)
    await asyncio.gather(*(_sync_one_symbol(sem, session, store, s, intervals) for s in symbols))


# === 模式 =====================================================================

async def run_once(store, symbols, intervals):
    async with aiohttp.ClientSession() as session:
        if not symbols:
            symbols = await list_symbols(session)
            log.info("Resolved %d tradable symbols", len(symbols))
        await sync_all(session, store, symbols, intervals)


async def run_watch(store, symbols, intervals, poll: int, stop: asyncio.Event):
    async with aiohttp.ClientSession() as session:
        if not symbols:
            symbols = await list_symbols(session)
            log.info("Watching %d symbols every %ds", len(symbols), poll)

        tick = 0
        while not stop.is_set():
            tick += 1
            started = datetime.now()
            log.info("=== tick #%d @ %s ===", tick, started.strftime("%H:%M:%S"))
            try:
                await sync_all(session, store, symbols, intervals)
            except Exception:
                log.exception("Cycle failed")
            log.info("tick #%d done in %.1fs", tick, (datetime.now() - started).total_seconds())

            try:
                await asyncio.wait_for(stop.wait(), timeout=poll)
            except asyncio.TimeoutError:
                pass  # 時間到，下一輪


# === CLI ======================================================================

def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--watch", action="store_true", help="持續模式（預設為抓一次後退出）")
    p.add_argument("--poll", type=int, default=WATCH_POLL_SECONDS, help="watch 模式的輪詢間隔秒數")
    p.add_argument("--symbols", nargs="*", help="指定幣種（留空則抓全部）")
    p.add_argument("--intervals", nargs="*", default=list(PREFETCH_INTERVALS),
                   help="要抓的時框")
    p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="輸出資料庫路徑")
    p.add_argument("--interactive", action="store_true",
                   help="互動詢問幣種（沿用舊版體驗，與 --watch/--symbols 互斥）")
    return p.parse_args(argv)


def _install_signal_handlers(stop: asyncio.Event):
    """Windows 不支援 asyncio.add_signal_handler；該平台靠 KeyboardInterrupt 收尾。"""
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):
            pass


async def async_main(args):
    store = KlineStore(args.db)
    await store.open()

    symbols: list[str] | None = [s.upper() for s in args.symbols] if args.symbols else None
    intervals = tuple(args.intervals)

    if args.interactive and not symbols:
        raw = input("輸入幣種（多個用空白隔開，直接 Enter 則抓全部）: ").strip().upper()
        symbols = [s for s in raw.split() if s] or None

    try:
        if args.watch:
            stop = asyncio.Event()
            _install_signal_handlers(stop)
            await run_watch(store, symbols or [], intervals, args.poll, stop)
        else:
            await run_once(store, symbols or [], intervals)
    finally:
        await store.close()


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    args = parse_args()
    try:
        asyncio.run(async_main(args))
    except KeyboardInterrupt:
        log.info("Interrupted by user")
        sys.exit(0)


if __name__ == "__main__":
    main()
