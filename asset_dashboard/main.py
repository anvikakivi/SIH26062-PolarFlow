import os
import io
import re
import sqlite3
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd

app = FastAPI(title="45ISEA Expedition Asset Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Absolute paths so the app works no matter which folder it is launched from
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "asset.db")
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# --- DATABASE SEEDING FOR LOCATIONS & TABLES ---
def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Create tables if they don't exist
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS locations (
            location_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assets (
            asset_id TEXT PRIMARY KEY,
            barcode_id TEXT UNIQUE,
            content_id TEXT,
            name TEXT NOT NULL,
            category TEXT,
            status TEXT DEFAULT 'AVAILABLE',
            current_location_id TEXT,
            FOREIGN KEY (current_location_id) REFERENCES locations (location_id)
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS transfer_requests (
            transfer_id TEXT PRIMARY KEY,
            asset_id TEXT,
            source_location_id TEXT,
            destination_location_id TEXT,
            status TEXT DEFAULT 'IN_TRANSIT',
            FOREIGN KEY (asset_id) REFERENCES assets (asset_id)
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS consumable_stock (
            stock_id TEXT PRIMARY KEY,
            location_id TEXT,
            item_name TEXT,
            quantity_on_hand INTEGER,
            unit_of_measure TEXT
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS consumption_logs (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_id TEXT,
            logged_by_team TEXT,
            quantity_used INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Seed official 45ISEA locations
    locations = [
        ('LOC-NCPOR', 'NCPOR Logistics Warehouse (Goa)', 'WAREHOUSE'),
        ('LOC-BHARATI', 'Bharati Research Station (Larsemann Hills)', 'STATION'),
        ('LOC-MAITRI', 'Maitri Research Station (Schiermacher Oasis)', 'STATION'),
        ('LOC-TRAVERSE', 'Mobile Traverse Unit (Piston Bully Route)', 'MOBILE_UNIT')
    ]
    cursor.executemany("INSERT OR IGNORE INTO locations VALUES (?, ?, ?)", locations)

    # --- MIGRATION ---
    # Older asset.db files were created without `content_id`, which made every
    # inward insert fail. CREATE TABLE IF NOT EXISTS never alters an existing
    # table, so add the missing column explicitly.
    asset_cols = [row[1] for row in cursor.execute("PRAGMA table_info(assets)")]
    if "content_id" not in asset_cols:
        cursor.execute("ALTER TABLE assets ADD COLUMN content_id TEXT")

    conn.commit()
    create_triggers(conn)
    conn.close()

# --- DATABASE TRIGGERS ---
# Business rules live in the database so they hold no matter which client writes.
#
# Inward flow : INSERT INTO inward_scans  --(trigger)-->  INSERT INTO assets
# Transfer    : INSERT INTO transfer_requests --(trigger)--> asset becomes IN_TRANSIT
#               UPDATE transfer_requests.status --(trigger)--> asset moves / is released
TRIGGER_SQL = """
CREATE TABLE IF NOT EXISTS inward_scans (
    scan_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id    TEXT NOT NULL,
    barcode_id  TEXT NOT NULL,
    content_id  TEXT,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    location_id TEXT NOT NULL,
    scanned_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===== INWARD SCAN =====
DROP TRIGGER IF EXISTS trg_inward_validate;
CREATE TRIGGER trg_inward_validate BEFORE INSERT ON inward_scans
BEGIN
    SELECT RAISE(ABORT, 'Asset ID already exists.')
        WHERE EXISTS (SELECT 1 FROM assets WHERE asset_id = NEW.asset_id);
    SELECT RAISE(ABORT, 'Barcode already exists.')
        WHERE EXISTS (SELECT 1 FROM assets WHERE barcode_id = NEW.barcode_id);
    SELECT RAISE(ABORT, 'Selected location does not exist.')
        WHERE NOT EXISTS (SELECT 1 FROM locations WHERE location_id = NEW.location_id);
END;

DROP TRIGGER IF EXISTS trg_inward_to_assets;
CREATE TRIGGER trg_inward_to_assets AFTER INSERT ON inward_scans
BEGIN
    INSERT INTO assets (asset_id, barcode_id, content_id, name, category, status, current_location_id)
    VALUES (NEW.asset_id, NEW.barcode_id, NEW.content_id, NEW.name, NEW.category, 'AVAILABLE', NEW.location_id);
END;

-- ===== ASSET GUARDS =====
DROP TRIGGER IF EXISTS trg_asset_move_guard;
CREATE TRIGGER trg_asset_move_guard BEFORE UPDATE OF current_location_id ON assets
BEGIN
    SELECT RAISE(ABORT, 'Selected location does not exist.')
        WHERE NOT EXISTS (SELECT 1 FROM locations WHERE location_id = NEW.current_location_id);
    SELECT RAISE(ABORT, 'Asset is in transit. Confirm or reject its transfer first.')
        WHERE OLD.status = 'IN_TRANSIT' AND NEW.status = 'IN_TRANSIT'
          AND NEW.current_location_id IS NOT OLD.current_location_id;
END;

DROP TRIGGER IF EXISTS trg_asset_delete_guard;
CREATE TRIGGER trg_asset_delete_guard BEFORE DELETE ON assets
BEGIN
    SELECT RAISE(ABORT, 'Asset is in transit. Confirm or reject its transfer before deleting.')
        WHERE OLD.status = 'IN_TRANSIT';
END;

DROP TRIGGER IF EXISTS trg_asset_delete_cleanup;
CREATE TRIGGER trg_asset_delete_cleanup AFTER DELETE ON assets
BEGIN
    DELETE FROM transfer_requests WHERE asset_id = OLD.asset_id;
END;

-- ===== MOBILIZATION / TRANSFERS =====
DROP TRIGGER IF EXISTS trg_transfer_validate;
CREATE TRIGGER trg_transfer_validate BEFORE INSERT ON transfer_requests
BEGIN
    SELECT RAISE(ABORT, 'Asset does not exist in inventory.')
        WHERE NOT EXISTS (SELECT 1 FROM assets WHERE asset_id = NEW.asset_id);
    SELECT RAISE(ABORT, 'Asset is not AVAILABLE (it may already be in transit).')
        WHERE (SELECT status FROM assets WHERE asset_id = NEW.asset_id) <> 'AVAILABLE';
    SELECT RAISE(ABORT, 'Source location does not match the asset''s current location.')
        WHERE (SELECT current_location_id FROM assets WHERE asset_id = NEW.asset_id)
              IS NOT NEW.source_location_id;
    SELECT RAISE(ABORT, 'Destination location does not exist.')
        WHERE NOT EXISTS (SELECT 1 FROM locations WHERE location_id = NEW.destination_location_id);
    SELECT RAISE(ABORT, 'Source and destination must be different.')
        WHERE NEW.source_location_id = NEW.destination_location_id;
END;

DROP TRIGGER IF EXISTS trg_transfer_dispatch;
CREATE TRIGGER trg_transfer_dispatch AFTER INSERT ON transfer_requests
WHEN NEW.status = 'IN_TRANSIT'
BEGIN
    UPDATE assets SET status = 'IN_TRANSIT' WHERE asset_id = NEW.asset_id;
END;

DROP TRIGGER IF EXISTS trg_transfer_status_guard;
CREATE TRIGGER trg_transfer_status_guard BEFORE UPDATE OF status ON transfer_requests
BEGIN
    SELECT RAISE(ABORT, 'This transfer has already been closed.')
        WHERE OLD.status IN ('CONFIRMED', 'REJECTED');
END;

DROP TRIGGER IF EXISTS trg_transfer_confirmed;
CREATE TRIGGER trg_transfer_confirmed AFTER UPDATE OF status ON transfer_requests
WHEN NEW.status = 'CONFIRMED'
BEGIN
    UPDATE assets SET current_location_id = NEW.destination_location_id, status = 'AVAILABLE'
    WHERE asset_id = NEW.asset_id;
END;

DROP TRIGGER IF EXISTS trg_transfer_rejected;
CREATE TRIGGER trg_transfer_rejected AFTER UPDATE OF status ON transfer_requests
WHEN NEW.status = 'REJECTED'
BEGIN
    UPDATE assets SET status = 'AVAILABLE' WHERE asset_id = NEW.asset_id;
END;
"""

def create_triggers(conn):
    conn.executescript(TRIGGER_SQL)
    conn.commit()

init_db()

# --- VALIDATION HELPERS ---
SAFE_ID = re.compile(r"^[A-Za-z0-9._\-]+$")

def clean_id(value: str, label: str) -> str:
    value = (value or "").strip()
    if not value or not SAFE_ID.match(value):
        raise HTTPException(status_code=400, detail=f"{label} may only contain letters, numbers, '-', '_' and '.'.")
    return value

def clean_text(value: str, label: str) -> str:
    value = (value or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail=f"{label} is required.")
    if "<" in value or ">" in value:
        raise HTTPException(status_code=400, detail=f"{label} must not contain '<' or '>'.")
    return value

def db_error_detail(exc: Exception) -> str:
    """Turn a SQLite / trigger error into a readable message for the UI."""
    msg = str(exc)
    if "UNIQUE constraint failed: assets.barcode_id" in msg:
        return "Barcode already exists."
    if "UNIQUE constraint failed: assets.asset_id" in msg:
        return "Asset ID already exists."
    if "UNIQUE constraint failed: transfer_requests.transfer_id" in msg:
        return "Transfer ID already exists."
    return msg

# --- SCHEMAS ---
class AssetInward(BaseModel):
    asset_id: str
    barcode_id: str
    content_id: str
    name: str
    category: str
    current_location_id: str

class AssetUpdate(BaseModel):
    barcode_id: str
    content_id: str
    name: str
    category: str

class LocationUpdate(BaseModel):
    new_location_id: str

class TransferRequest(BaseModel):
    transfer_id: str
    asset_id: str
    source_location_id: str
    destination_location_id: str

class TransferConfirm(BaseModel):
    status: str  # 'CONFIRMED' or 'REJECTED'

# --- API ENDPOINTS ---

@app.get("/api/locations")
def list_locations():
    conn = get_db()
    rows = conn.execute("SELECT location_id, name, type FROM locations").fetchall()
    conn.close()
    return [dict(r) for r in rows]

# Asset CRUD & Direct Location Update
@app.post("/api/assets/scan-inward")
def scan_inward_asset(asset: AssetInward):
    """CREATE: inserts into `inward_scans`; the DB trigger creates the real `assets` row."""
    asset_id = clean_id(asset.asset_id, "Asset ID")
    barcode_id = clean_text(asset.barcode_id, "Barcode ID")
    content_id = clean_text(asset.content_id, "Packet ID")
    name = clean_text(asset.name, "Item name")
    category = clean_text(asset.category, "Category")
    location_id = (asset.current_location_id or "").strip()
    if not location_id:
        raise HTTPException(status_code=400, detail="Location is required.")

    conn = get_db()
    try:
        conn.execute("""
            INSERT INTO inward_scans (asset_id, barcode_id, content_id, name, category, location_id)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (asset_id, barcode_id, content_id, name, category, location_id))
        conn.commit()
    except sqlite3.DatabaseError as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=db_error_detail(e))
    finally:
        conn.close()
    return {"message": "Asset added successfully"}

@app.get("/api/assets/available")
def list_available_assets(location_id: Optional[str] = None):
    """READ: only assets that really exist in the DB and can be mobilized (status AVAILABLE)."""
    conn = get_db()
    query = """
        SELECT a.asset_id, a.name AS asset_name, a.category, a.current_location_id
        FROM assets a
        WHERE a.status = 'AVAILABLE'
    """
    params = []
    if location_id:
        query += " AND a.current_location_id = ?"
        params.append(location_id)
    query += " ORDER BY a.asset_id"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.put("/api/assets/{asset_id}")
def update_asset(asset_id: str, asset: AssetUpdate):
    """UPDATE: edit the descriptive fields of an existing asset."""
    barcode_id = clean_text(asset.barcode_id, "Barcode ID")
    content_id = clean_text(asset.content_id, "Packet ID")
    name = clean_text(asset.name, "Item name")
    category = clean_text(asset.category, "Category")

    conn = get_db()
    try:
        if not conn.execute("SELECT 1 FROM assets WHERE asset_id = ?", (asset_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Asset not found.")
        clash = conn.execute("SELECT 1 FROM assets WHERE barcode_id = ? AND asset_id <> ?",
                             (barcode_id, asset_id)).fetchone()
        if clash:
            raise HTTPException(status_code=400, detail="Barcode already exists.")
        conn.execute("""
            UPDATE assets SET barcode_id = ?, content_id = ?, name = ?, category = ?
            WHERE asset_id = ?
        """, (barcode_id, content_id, name, category, asset_id))
        conn.commit()
    except sqlite3.DatabaseError as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=db_error_detail(e))
    finally:
        conn.close()
    return {"message": f"Asset {asset_id} updated."}

@app.put("/api/assets/{asset_id}/location")
def update_asset_location(asset_id: str, loc: LocationUpdate):
    conn = get_db()
    try:
        cur = conn.execute("UPDATE assets SET current_location_id = ? WHERE asset_id = ?", (loc.new_location_id, asset_id))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Asset not found.")
        conn.commit()
    except sqlite3.DatabaseError as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=db_error_detail(e))
    finally:
        conn.close()
    return {"message": f"Asset {asset_id} location updated."}

@app.delete("/api/assets/{asset_id}")
def delete_asset(asset_id: str):
    conn = get_db()
    try:
        cur = conn.execute("DELETE FROM assets WHERE asset_id = ?", (asset_id,))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Asset not found.")
        conn.commit()
    except sqlite3.DatabaseError as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=db_error_detail(e))
    finally:
        conn.close()
    return {"message": f"Asset {asset_id} deleted."}

# Reporting & Live Views
@app.get("/api/reports/issued-assets")
def get_assets_list(location_id: Optional[str] = None):
    conn = get_db()
    query = """
        SELECT a.asset_id, a.barcode_id, a.content_id, a.name AS asset_name, a.category, a.status,
               l.name AS location_name, a.current_location_id
        FROM assets a
        LEFT JOIN locations l ON a.current_location_id = l.location_id
        WHERE 1=1
    """
    params = []
    if location_id:
        query += " AND a.current_location_id = ?"
        params.append(location_id)
        
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/reports/stock")
def get_stock_report(location_id: Optional[str] = None):
    conn = get_db()
    query = """
        SELECT l.name AS location_name, c.item_name, c.quantity_on_hand, c.unit_of_measure
        FROM consumable_stock c
        JOIN locations l ON c.location_id = l.location_id
        WHERE 1=1
    """
    params = []
    if location_id:
        query += " AND c.location_id = ?"
        params.append(location_id)
        
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/reports/consumption")
def get_consumption_report():
    conn = get_db()
    rows = conn.execute("""
        SELECT c.item_name, cl.logged_by_team, SUM(cl.quantity_used) AS total_consumed, cl.timestamp
        FROM consumption_logs cl
        JOIN consumable_stock c ON cl.stock_id = c.stock_id
        WHERE cl.timestamp >= date('now', '-30 days')
        GROUP BY c.item_name, cl.logged_by_team
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# Dynamic Transfers & Mobilization
@app.get("/api/transfers")
def get_all_transfers():
    conn = get_db()
    rows = conn.execute("""
        SELECT t.transfer_id, a.name AS asset_name, t.asset_id,
               loc1.name AS source_station, loc2.name AS destination_station, t.status
        FROM transfer_requests t
        JOIN assets a ON t.asset_id = a.asset_id
        JOIN locations loc1 ON t.source_location_id = loc1.location_id
        JOIN locations loc2 ON t.destination_location_id = loc2.location_id
        ORDER BY t.transfer_id DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/transfers/request")
def request_mobilization(req: TransferRequest):
    """Validation + marking the asset IN_TRANSIT is done by DB triggers."""
    transfer_id = clean_id(req.transfer_id, "Transfer ID")
    conn = get_db()
    try:
        conn.execute("""
            INSERT INTO transfer_requests (transfer_id, asset_id, source_location_id, destination_location_id, status)
            VALUES (?, ?, ?, ?, 'IN_TRANSIT')
        """, (transfer_id, req.asset_id, req.source_location_id, req.destination_location_id))
        conn.commit()
    except sqlite3.DatabaseError as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=db_error_detail(e))
    finally:
        conn.close()
    return {"message": "Mobilization transfer initiated"}

@app.put("/api/transfers/{transfer_id}/confirm")
def confirm_mobilization(transfer_id: str, action: TransferConfirm):
    if action.status not in ("CONFIRMED", "REJECTED"):
        raise HTTPException(status_code=400, detail="Status must be CONFIRMED or REJECTED.")
    conn = get_db()
    try:
        transfer = conn.execute("SELECT * FROM transfer_requests WHERE transfer_id = ?", (transfer_id,)).fetchone()
        if not transfer:
            raise HTTPException(status_code=404, detail="Transfer record not found.")
        # Triggers move the asset (CONFIRMED) or release it (REJECTED)
        conn.execute("UPDATE transfer_requests SET status = ? WHERE transfer_id = ?", (action.status, transfer_id))
        conn.commit()
    except sqlite3.DatabaseError as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=db_error_detail(e))
    finally:
        conn.close()
    return {"message": f"Transfer status updated to {action.status}"}

# Excel Exporter
@app.get("/api/reports/export-excel")
def export_reports_to_excel():
    conn = get_db()
    df_assets = pd.read_sql_query("SELECT * FROM assets", conn)
    df_stock = pd.read_sql_query("""
        SELECT c.item_name, c.quantity_on_hand, c.unit_of_measure, l.name as location
        FROM consumable_stock c JOIN locations l ON c.location_id = l.location_id
    """, conn)
    df_transfers = pd.read_sql_query("SELECT * FROM transfer_requests", conn)
    conn.close()

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df_assets.to_excel(writer, sheet_name='Assets_Master', index=False)
        df_stock.to_excel(writer, sheet_name='Stock_Levels', index=False)
        df_transfers.to_excel(writer, sheet_name='Mobilization_Logs', index=False)

    output.seek(0)
    headers = {'Content-Disposition': 'attachment; filename="45ISEA_Expedition_Report.xlsx"'}
    return StreamingResponse(output, headers=headers, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

if os.path.exists(PUBLIC_DIR):
    app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
