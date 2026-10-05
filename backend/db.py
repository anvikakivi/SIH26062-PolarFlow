"""SQLite access for the asset database (data/asset.db). Simulations use the read-only connection."""
import os
import re
import sqlite3
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
DB_FILE = os.path.join(DATA_DIR, "asset.db")

# Minimal additions needed by the Cargo Delay simulation (existing tables are untouched).
SIM_SCHEMA = """
CREATE TABLE IF NOT EXISTS cargo (
    cargo_id TEXT PRIMARY KEY,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_of_measure TEXT NOT NULL,
    destination_location_id TEXT NOT NULL,
    expected_arrival DATE NOT NULL,
    status TEXT DEFAULT 'IN_TRANSIT' CHECK(status IN ('PLANNED', 'IN_TRANSIT', 'ARRIVED')),
    FOREIGN KEY (destination_location_id) REFERENCES locations(location_id)
);
CREATE TABLE IF NOT EXISTS stock_reserves (
    stock_id TEXT PRIMARY KEY,
    min_reserve INTEGER NOT NULL,
    FOREIGN KEY (stock_id) REFERENCES consumable_stock(stock_id)
);
CREATE TABLE IF NOT EXISTS expedition_requirements (
    req_id TEXT PRIMARY KEY,
    expedition_id TEXT NOT NULL,
    expedition_name TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    location_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    quantity_required INTEGER NOT NULL,
    FOREIGN KEY (location_id) REFERENCES locations(location_id)
);
"""


def connect_readonly():
    """Read-only: SQLite itself rejects any write, so what-if runs cannot change real data."""
    conn = sqlite3.connect(Path(DB_FILE).as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def connect_write():
    """Only for schema setup / demo seeding. Never used by the simulation."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_sim_schema(conn):
    conn.executescript(SIM_SCHEMA)
    conn.commit()


SEED_FILE = os.path.join(DATA_DIR, "seed_supplied.sql")


def apply_supplied_seed(conn):
    """Supplied operational locations + 20 assets (data/seed_supplied.sql). INSERT OR IGNORE only, so it is
    idempotent and never changes or removes existing rows. Adds assets.content_id if the table lacks it."""
    if not os.path.exists(SEED_FILE):
        return
    if "content_id" not in {r[1] for r in conn.execute("PRAGMA table_info(assets)")}:
        conn.execute("ALTER TABLE assets ADD COLUMN content_id TEXT")
    sql = open(SEED_FILE, encoding="utf-8").read()
    conn.executescript(re.sub(r"\bINSERT\s+INTO\b", "INSERT OR IGNORE INTO", sql, flags=re.I))
