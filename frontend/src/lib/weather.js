/*
 * weather.js - weather store (state + fetching). No Leaflet / DOM.
 * Data comes from the FastAPI backend (/api/weather); the browser never talks
 * to the forecast provider. Severity is computed by the backend from forecast
 * values and data/weather_config.json (operational ASSUMPTIONS, not official limits).
 *
 * Simulation hook: getEnvironmentalInputs(route) returns the forecast
 * conditions at each route waypoint in a plain structure that the (separate)
 * Simulation Engine can consume. Nothing here changes routes or decides anything.
 */
import { AppData } from "./api.js";
import { AppRoutes } from "./routes.js";

const REFRESH_MS = 10 * 60 * 1000; // backend caches 30 min, so this is cheap
const snap = (v) => Math.round(v * 4) / 4; // forecast grid cell (0.25 deg), same as backend

// Severity scale for the map overlay, derived from the API's forecast summary and
// the configured limits (operational ASSUMPTIONS, not official storm boundaries).
//   Low      >= 70% of the caution limit        (very transparent)
//   Moderate >= caution limit                    (low opacity)
//   High     >= severe limit                     (medium opacity)
//   Extreme  >= 125% of the severe limit         (highest opacity)
export const LEVELS = [
  { key: "none", label: "Normal", color: "#6b7f99", opacity: 0 },
  { key: "low", label: "Low", color: "#f7a23b", opacity: 0.1 },
  { key: "moderate", label: "Moderate", color: "#f2751a", opacity: 0.22 },
  { key: "high", label: "High", color: "#e0401a", opacity: 0.38 },
  { key: "extreme", label: "Extreme", color: "#b3121a", opacity: 0.55 }
];
export const levelInfo = (key) => LEVELS.find((l) => l.key === key) || LEVELS[0];

function rank(v, caution, severe) {
  if (v === null || v === undefined) return 0;
  if (v >= severe * 1.25) return 4;
  if (v >= severe) return 3;
  if (v >= caution) return 2;
  if (v >= 0.7 * caution) return 1;
  return 0;
}

function computeLevel(p, t) {
  if (!t || !p.summary) return "none";
  const s = p.summary, cold = t.temperature_c_below;
  const r = Math.max(
    rank(s.max_wind_kmh, t.wind_kmh.caution, t.wind_kmh.severe),
    rank(s.max_gust_kmh, t.gust_kmh.caution, t.gust_kmh.severe),
    s.min_temp_c !== null && s.min_temp_c < 0 ? rank(-s.min_temp_c, -cold.caution, -cold.severe) : 0
  );
  return LEVELS[r].key;
}

// Forecast grid cells, derived from the grid points the API returns (no duplicated constants):
// rings of latitude between mid-points, lon sectors of one grid step, pole = full cap.
export function gridCells(points) {
  const g = points.filter((p) => p.kind === "grid");
  const lats = [...new Set(g.map((p) => p.lat))].sort((a, b) => b - a);
  const lons = [...new Set(g.map((p) => p.lon))].sort((a, b) => a - b);
  const step = lons.length > 1 ? lons[1] - lons[0] : 360;
  const gap = lats.length > 1 ? lats[0] - lats[1] : 6;
  return g.map((p) => {
    const i = lats.indexOf(p.lat), pole = p.lat <= -89.9;
    return {
      point: p, pole,
      north: i === 0 ? p.lat + gap / 2 : (lats[i - 1] + p.lat) / 2,
      south: pole ? -90 : i === lats.length - 1 ? Math.max(-90, p.lat - gap / 2) : (p.lat + lats[i + 1]) / 2,
      west: p.lon - step / 2, step
    };
  });
}

let state = {
  enabled: false, loading: false, status: "idle", error: null,
  points: [], fetchedAt: null, forecastTime: null, provider: "", thresholds: null
};
let selectedId = null;
let listeners = [];
let timer = null, debounce = null, seq = 0;

const notify = () => listeners.forEach((fn) => fn());

function routePoints() {
  const out = [], seen = new Set();
  AppRoutes.getAll().forEach((r) => r.waypoints.forEach((w) => {
    const k = snap(w.latitude) + "," + snap(w.longitude);
    if (!seen.has(k) && out.length < 40) { seen.add(k); out.push([w.latitude, w.longitude]); }
  }));
  return out;
}

async function refresh() {
  if (!state.enabled) return;
  const mine = ++seq;
  state = { ...state, loading: true };
  notify();
  try {
    const d = await AppData.loadWeather(routePoints());
    if (mine !== seq || !state.enabled) return;
    state = {
      ...state, loading: false, status: d.status, error: d.error,
      points: d.points.map((p) => ({ ...p, level: computeLevel(p, d.thresholds) })),
      fetchedAt: d.fetched_at, forecastTime: d.forecast_time,
      provider: d.provider + " \u00b7 " + d.model, thresholds: d.thresholds
    };
  } catch (e) {
    // Backend unreachable: keep what we have, but never present it as live.
    state = { ...state, loading: false, error: String(e.message || e), status: state.points.length ? "stale" : "unavailable" };
  }
  notify();
}

function setEnabled(on) {
  state = { ...state, enabled: on };
  clearInterval(timer);
  if (on) { timer = setInterval(refresh, REFRESH_MS); refresh(); }
  else { selectedId = null; notify(); }
}

// Called when routes change (debounced; backend cache makes repeats free).
function scheduleRefresh() {
  if (!state.enabled) return;
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 1200);
}

const conditionFor = (lat, lon) => {
  if (!state.enabled) return null;
  const g = [snap(lat), snap(lon)];
  return state.points.find((p) => p.grid_lat === g[0] && p.grid_lon === g[1]) || null;
};

function getRouteConditions(route) {
  return route.waypoints.map((w) => {
    const c = conditionFor(w.latitude, w.longitude);
    return {
      waypoint_id: w.waypoint_id, sequence: w.sequence, name: w.name,
      latitude: w.latitude, longitude: w.longitude,
      severity: c ? c.severity : null, conditions: c
    };
  });
}

export const AppWeather = {
  onChange: (fn) => { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; },
  getState: () => state,
  setEnabled, refresh, scheduleRefresh,
  select: (id) => { selectedId = id; notify(); },
  getSelectedId: () => selectedId,
  getPoint: (id) => (state.enabled ? state.points.find((p) => p.id === id) || null : null),
  layerPoints: () => (state.enabled ? state.points.filter((p) => p.kind !== "custom") : []),
  conditionFor,
  // Forecast cell containing a clicked location (null when weather is off / outside the grid).
  pointAt: (lat, lon) => {
    if (!state.enabled) return null;
    const c = gridCells(state.points).find((c) =>
      lat <= c.north && lat > (c.pole ? -90.0001 : c.south) &&
      (c.pole || ((((lon - c.west) % 360) + 360) % 360) < c.step));
    return c ? c.point : null;
  },
  getRouteConditions,
  // For the Simulation Engine: environmental input per waypoint (+ provenance).
  getEnvironmentalInputs: (route) => ({
    source: { provider: state.provider, status: state.status, fetched_at: state.fetchedAt, forecast_time: state.forecastTime },
    thresholds: state.thresholds,
    route_id: route.route_id,
    waypoints: getRouteConditions(route)
  })
};
