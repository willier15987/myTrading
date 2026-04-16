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
from pathlib import Path

from backend.core.live_fetch import (
    DEFAULT_DB_PATH,
    KlineStore,
    PREFETCH_INTERVALS,
    WATCH_POLL_SECONDS,
    run_once,
    run_watch,
)


log = logging.getLogger("fetch_klines")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--watch", action="store_true", help="持續模式（預設為抓一次後退出）")
    parser.add_argument("--poll", type=int, default=WATCH_POLL_SECONDS, help="watch 模式的輪詢間隔秒數")
    parser.add_argument("--symbols", nargs="*", help="指定幣種（留空則抓全部）")
    parser.add_argument("--intervals", nargs="*", default=list(PREFETCH_INTERVALS), help="要抓的時框")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="輸出資料庫路徑")
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="互動詢問幣種（沿用舊版體驗，與 --watch/--symbols 互斥）",
    )
    return parser.parse_args(argv)


def _install_signal_handlers(stop: asyncio.Event) -> None:
    """Windows 不支援 asyncio.add_signal_handler；該平台靠 KeyboardInterrupt 收尾。"""
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):
            pass


async def async_main(args) -> None:
    store = KlineStore(args.db)
    await store.open()

    symbols = [symbol.upper() for symbol in args.symbols] if args.symbols else None
    intervals = tuple(args.intervals)

    if args.interactive and not symbols:
        raw = input("輸入幣種（多個用空白隔開，直接 Enter 則抓全部）: ").strip().upper()
        symbols = [symbol for symbol in raw.split() if symbol] or None

    try:
        if args.watch:
            stop = asyncio.Event()
            _install_signal_handlers(stop)
            await run_watch(store, symbols, intervals, args.poll, stop)
        else:
            await run_once(store, symbols, intervals)
    finally:
        await store.close()


def main() -> None:
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
