"""
FastAPI backend. Replaces the old pywebview `Api` class one-for-one, using the
same data files (data/*.json, data/telemetry_log.csv). Persistence stays
behind these endpoints, so swapping the files for the team's database later
only touches this file.
"""
import csv
import json
import os
import threading
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db
from .simulation import engine as sim_engine
from .simulation.excel import build_workbook
from .weather import get_weather

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
WAYPOINTS_FILE = os.path.join(DATA_DIR, "waypoints.json")
PLANS_FILE = os.path.join(DATA_DIR, "plans.json")
ROUTES_FILE = os.path.join(DATA_DIR, "routes.json")
STATIONS_FILE = os.path.join(DATA_DIR, "stations.json")
LAND_GEOJSON_FILE = os.path.join(DATA_DIR, "antarctica_land.geojson")
TELEMETRY_LOG_FILE = os.path.join(DATA_DIR, "telemetry_log.csv")
TELEMETRY_FIELDS = ["timestamp", "entity_id", "latitude", "longitude", "accuracy", "source"]
DIST_DIR = os.path.join(ROOT, "frontend", "dist")

_lock = threading.Lock()
app = FastAPI(title="Antarctic Operations API")


class TelemetryRecord(BaseModel):
    timestamp: str
    entity_id: str
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    source: Optional[str] = None


@app.get("/api/stations")
def load_stations():
    with open(STATIONS_FILE, "r") as f:
        return json.load(f)


@app.get("/api/waypoints")
def load_waypoints():
    if not os.path.exists(WAYPOINTS_FILE):
        return []
    with open(WAYPOINTS_FILE, "r") as f:
        return json.load(f)


@app.put("/api/waypoints")
def save_waypoints(waypoints: List[dict]):
    with _lock, open(WAYPOINTS_FILE, "w") as f:
        json.dump(waypoints, f, indent=2)
    return {"status": "ok", "count": len(waypoints)}


@app.get("/api/routes")
def load_routes():
    if not os.path.exists(ROUTES_FILE):
        return []
    with open(ROUTES_FILE, "r") as f:
        return json.load(f)


@app.put("/api/routes")
def save_routes(routes: List[dict]):
    """Finished (PLANNED) routes with their waypoints. Drafts are never saved."""
    with _lock, open(ROUTES_FILE, "w") as f:
        json.dump(routes, f, indent=2)
    return {"status": "ok", "count": len(routes)}


@app.get("/api/plans")
def load_plans():
    if not os.path.exists(PLANS_FILE):
        return []
    with open(PLANS_FILE, "r") as f:
        return json.load(f)


@app.put("/api/plans")
def save_plans(plans: List[dict]):
    """Expedition plans, one per route. Local file only - not the central database."""
    with _lock, open(PLANS_FILE, "w") as f:
        json.dump(plans, f, indent=2)
    return {"status": "ok", "count": len(plans)}


@app.get("/api/land")
def load_land_geojson():
    # Served as the raw file (~1 MB) - unchanged SCAR ADD data.
    return FileResponse(LAND_GEOJSON_FILE, media_type="application/json")


@app.post("/api/telemetry")
def append_telemetry(rec: TelemetryRecord):
    """Append ONE telemetry record to data/telemetry_log.csv (never overwrites)."""
    row = ["" if v is None else v for v in (getattr(rec, k) for k in TELEMETRY_FIELDS)]
    with _lock:
        new_file = not os.path.exists(TELEMETRY_LOG_FILE) or os.path.getsize(TELEMETRY_LOG_FILE) == 0
        with open(TELEMETRY_LOG_FILE, "a", newline="") as f:
            w = csv.writer(f)
            if new_file:
                w.writerow(TELEMETRY_FIELDS)
            w.writerow(row)
    return {"status": "ok"}


@app.get("/api/weather")
def weather(points: str = ""):
    """Forecast for stations + a coarse Antarctic grid, plus optional extra points
    ("lat,lon;lat,lon" - e.g. route waypoints). Always 200: failures are reported
    in `status`/`error` so the map and the rest of the app keep working."""
    extra = []
    for part in points.split(";"):
        try:
            la, lo = (float(x) for x in part.split(","))
        except ValueError:
            continue
        if -90 <= la <= 90 and -180 <= lo <= 180:
            extra.append((la, lo))
    return get_weather(extra)


class CargoDelayRequest(BaseModel):
    cargo_id: str
    delay_days: int
    as_of: Optional[str] = None  # ISO date; defaults to today


def _run_cargo_delay(req: CargoDelayRequest):
    from datetime import date
    try:
        as_of = date.fromisoformat(req.as_of) if req.as_of else None
        conn = db.connect_readonly()  # read-only: what-if runs cannot modify real data
        try:
            return sim_engine.run_cargo_delay(conn, req.cargo_id, req.delay_days, as_of)
        finally:
            conn.close()
    except sim_engine.SimulationError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/simulation/cargo")
def simulation_cargo():
    conn = db.connect_readonly()
    try:
        return sim_engine.list_cargo(conn)
    except Exception as e:  # missing tables etc.
        raise HTTPException(status_code=500, detail="Simulation data unavailable: %s" % e)
    finally:
        conn.close()


@app.post("/api/simulation/cargo-delay")
def simulation_cargo_delay(req: CargoDelayRequest):
    return _run_cargo_delay(req)


@app.post("/api/simulation/cargo-delay/export")
def simulation_cargo_delay_export(req: CargoDelayRequest):
    data = build_workbook(_run_cargo_delay(req))
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="cargo_delay_%s_%dd.xlsx"' % (req.cargo_id, req.delay_days)})


# Built React app (npm run build) is served at "/"; registered last so /api wins.
if os.path.isdir(DIST_DIR):
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="ui")
