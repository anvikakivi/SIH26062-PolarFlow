"""
Weather data processing: grid/point selection, caching, severity from
configurable thresholds. Provider-agnostic (see weather_provider.py).
This is NOT a decision or simulation engine - it only turns forecast values
into display/input data. Severity is derived from forecast values and the
operator-editable data/weather_config.json (operational assumptions).
"""
import json
import os
import threading
import time
from datetime import datetime, timezone

from .weather_provider import OpenMeteoECMWF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
CONFIG_FILE = os.path.join(DATA_DIR, "weather_config.json")
STATIONS_FILE = os.path.join(DATA_DIR, "stations.json")

provider = OpenMeteoECMWF()  # swap here for another provider
TTL_S = 30 * 60
MAX_CUSTOM_POINTS = 40
GRID_LATS = [-66, -72, -78, -84]
GRID_LONS = list(range(-180, 180, 45))

DEFAULTS = {
    "window_hours": 24,
    "wind_kmh": {"caution": 40, "severe": 70},
    "gust_kmh": {"caution": 60, "severe": 90},
    "temperature_c_below": {"caution": -30, "severe": -40},
}

_cache = {}  # (grid_lat, grid_lon) -> {"fetched": epoch_s, "series": {...}}
_lock = threading.Lock()


def snap(v):
    """Forecast grid is 0.25 deg: requests/caching use that cell."""
    return round(v * 4) / 4


def load_config():
    cfg = json.loads(json.dumps(DEFAULTS))
    try:
        with open(CONFIG_FILE, "r") as f:
            user = json.load(f)
        for k, v in user.items():
            if k in cfg:
                cfg[k] = {**cfg[k], **v} if isinstance(v, dict) else v
        cfg["_note"] = user.get("_note", "")
    except (OSError, ValueError):
        pass
    return cfg


def base_points():
    pts = []
    try:
        with open(STATIONS_FILE, "r") as f:
            for s in json.load(f):
                pts.append({"id": s["id"], "name": s["name"], "kind": "station",
                            "lat": s["latitude"], "lon": s["longitude"]})
    except (OSError, ValueError):
        pass
    for la in GRID_LATS:
        for lo in GRID_LONS:
            pts.append({"id": "grid-%d_%d" % (la, lo), "name": None, "kind": "grid", "lat": la, "lon": lo})
    pts.append({"id": "grid--90_0", "name": None, "kind": "grid", "lat": -90, "lon": 0})
    return pts


def _iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _round(v, n=1):
    return None if v is None else round(v, n)


def _process(series, now_str, cfg):
    times = series["time"]
    idx = 0
    for i, t in enumerate(times):
        if t <= now_str:
            idx = i
    w = int(cfg["window_hours"])
    win = slice(idx, idx + w + 1)

    def vals(k, s=win):
        return [v for v in series[k][s] if v is not None]

    def at(k):
        return _round(series[k][idx]) if idx < len(series[k]) else None

    wind, gust, temp = vals("wind_speed_kmh"), vals("wind_gust_kmh"), vals("temperature_c")
    summary = {
        "window_hours": w,
        "max_wind_kmh": _round(max(wind)) if wind else None,
        "max_gust_kmh": _round(max(gust)) if gust else None,
        "min_temp_c": _round(min(temp)) if temp else None,
        "precip_total_mm": _round(sum(vals("precipitation_mm", slice(idx + 1, idx + w + 1)))),
        "snowfall_total_cm": _round(sum(vals("snowfall_cm", slice(idx + 1, idx + w + 1)))),
    }

    severity, reasons = "normal", []
    if not (wind or gust or temp):
        severity = "unknown"
    rank = {"normal": 0, "caution": 1, "severe": 2}

    def check(value, label, unit, rule, below=False):
        nonlocal severity
        if value is None:
            return
        for level in ("severe", "caution"):
            lim = cfg[rule][level]
            if (value <= lim) if below else (value >= lim):
                if rank[level] > rank.get(severity, 0):
                    severity = level
                reasons.append("%s %g %s %s %s limit %g (%s)" % (
                    label, value, unit, "<=" if below else ">=", level, lim, "assumption"))
                return

    check(summary["max_wind_kmh"], "Max wind", "km/h", "wind_kmh")
    check(summary["max_gust_kmh"], "Max gust", "km/h", "gust_kmh")
    check(summary["min_temp_c"], "Min temp", "\u00b0C", "temperature_c_below", below=True)

    end = idx + 73
    return {
        "current": {
            "time": times[idx] + "Z" if times else None,
            "wind_speed_kmh": at("wind_speed_kmh"),
            "wind_direction_deg": at("wind_direction_deg"),
            "wind_gust_kmh": at("wind_gust_kmh"),
            "temperature_c": at("temperature_c"),
            "precipitation_mm": at("precipitation_mm"),
            "snowfall_cm": at("snowfall_cm"),
        },
        "summary": summary,
        "severity": severity,
        "reasons": reasons,
        "hourly": {k: (v[idx:end] if k == "time" else [_round(x) for x in v[idx:end]]) for k, v in series.items()},
    }


def get_weather(extra=None):
    """extra: list of (lat, lon) e.g. route waypoints. Never raises."""
    cfg = load_config()
    wanted = base_points()
    seen = set()
    for lat, lon in (extra or [])[:MAX_CUSTOM_POINTS]:
        key = (snap(lat), snap(lon))
        if key in seen:
            continue
        seen.add(key)
        wanted.append({"id": "pt-%g_%g" % key, "name": None, "kind": "custom", "lat": lat, "lon": lon})

    keys = sorted({(snap(p["lat"]), snap(p["lon"])) for p in wanted})
    now = time.time()
    error = None
    with _lock:
        missing = [k for k in keys if k not in _cache or now - _cache[k]["fetched"] > TTL_S]
        if missing:
            try:
                fetched = provider.fetch(missing)
                for k, series in fetched.items():
                    if series.get("time"):
                        _cache[k] = {"fetched": now, "series": series}
            except Exception as e:  # network/provider failure: keep serving cached (stale) data
                error = "%s: %s" % (type(e).__name__, e)

        now_str = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%dT%H:%M")
        points, ages = [], []
        for p in wanted:
            key = (snap(p["lat"]), snap(p["lon"]))
            entry = _cache.get(key)
            if not entry:
                continue
            ages.append(entry["fetched"])
            points.append({**p, "grid_lat": key[0], "grid_lon": key[1], **_process(entry["series"], now_str, cfg)})

    oldest = min(ages) if ages else None
    if not points:
        status = "unavailable"
    elif now - oldest > TTL_S:
        status = "stale"
    else:
        status = "ok"
    return {
        "provider": provider.name,
        "model": provider.model,
        "status": status,
        "error": error,
        "fetched_at": _iso(oldest) if oldest else None,
        "forecast_time": points[0]["current"]["time"] if points else None,
        "thresholds": cfg,
        "points": points,
    }
