import sqlite3
from pathlib import Path

CRYPTO_DB_PATH = r"D:\AI_Projects\Trading\crypto_data.db"
MARKS_DB_PATH = Path(__file__).parent.parent / "data" / "marks.db"


def get_crypto_db() -> sqlite3.Connection:
    conn = sqlite3.connect(CRYPTO_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_marks_db() -> sqlite3.Connection:
    MARKS_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(MARKS_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_marks_db() -> None:
    conn = get_marks_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS marks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol      TEXT NOT NULL,
            interval    TEXT NOT NULL,
            timestamp   INTEGER NOT NULL,
            label_type  TEXT NOT NULL,
            price       REAL,
            note        TEXT,
            indicators  TEXT,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_marks_lookup ON marks(symbol, interval, timestamp)"
    )
    conn.commit()
    conn.close()
