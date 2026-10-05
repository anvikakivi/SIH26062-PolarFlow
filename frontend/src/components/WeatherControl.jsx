import { AppWeather, LEVELS, levelInfo } from "../lib/weather.js";
import { useStore } from "../hooks.js";
import { InfoRow } from "./Panel.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n) => (n < 10 ? "0" + n : String(n));

export function fmtUtc(iso) {
  if (!iso) return "\u2014";
  const t = new Date(iso);
  return p2(t.getUTCDate()) + " " + MONTHS[t.getUTCMonth()] + " " + p2(t.getUTCHours()) + ":" + p2(t.getUTCMinutes()) + " UTC";
}
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (d) => COMPASS[Math.round(d / 22.5) % 16];
const v = (x, unit) => (x === null || x === undefined ? "\u2014" : x + " " + unit);

export function SevChip({ level }) {
  const l = levelInfo(level);
  return <span className="wx-chip" style={{ background: level && level !== "none" ? l.color : "#6b7f99" }}>{level ? l.label : "n/a"}</span>;
}

// Forecast for the clicked location (cell it falls in) - shown when the weather layer is on.
export function ClickedForecast({ point, onDetails }) {
  if (!point) return null;
  const c = point.current;
  return (
    <div className="wx-route">
      <div className="field-label">Forecast here</div>
      <InfoRow label="Severity"><SevChip level={point.level} /></InfoRow>
      <InfoRow label="Wind">{v(c.wind_speed_kmh, "km/h") + " \u00b7 gust " + v(c.wind_gust_kmh, "km/h")}</InfoRow>
      <InfoRow label="Temperature">{v(c.temperature_c, "\u00b0C")}</InfoRow>
      <button type="button" className="btn btn-secondary" onClick={() => onDetails(point.id)}>Forecast details</button>
    </div>
  );
}

// Layer toggle + freshness + legend (compact, lives under the panel buttons).
export function WeatherControl() {
  useStore(AppWeather.onChange);
  const s = AppWeather.getState();
  const note =
    s.status === "unavailable" ? "Weather data unavailable" + (s.loading ? " \u2026" : "")
    : s.status === "stale" ? "STALE \u2013 last updated " + fmtUtc(s.fetchedAt)
    : s.loading && !s.fetchedAt ? "Loading forecast\u2026"
    : "Forecast retrieved " + fmtUtc(s.fetchedAt);
  return (
    <div id="wx-control">
      <label className="wx-toggle">
        <input type="checkbox" checked={s.enabled} onChange={(e) => AppWeather.setEnabled(e.target.checked)} />
        Weather layer
        {s.enabled && <button type="button" className="wx-refresh" title="Refresh forecast" onClick={() => AppWeather.refresh()}>{"\u21bb"}</button>}
      </label>
      {s.enabled && (
        <>
          <div className={"wx-status" + (s.status === "stale" || s.status === "unavailable" ? " wx-bad" : "")}>{note}</div>
          {s.status === "ok" && <div className="wx-sub">{"Valid " + fmtUtc(s.forecastTime) + " \u00b7 " + s.provider}</div>}
          <div className="wx-legend">
            {LEVELS.filter((l) => l.opacity > 0).map((l) => (
              <span key={l.key}><i className="wx-swatch" style={{ background: l.color, opacity: Math.min(1, l.opacity + 0.25) }} />{l.label}</span>
            ))}
          </div>
          <div className="wx-sub">Shading = forecast severity, next 24 h, from configurable assumed limits (not official storm boundaries). Arrows = wind direction.</div>
        </>
      )}
    </div>
  );
}

// Selected weather point (shown in the panel content area).
export function WeatherDetail({ point, onClose }) {
  const c = point.current, s = point.summary, t = AppWeather.getState().thresholds;
  return (
    <>
      <h3>Forecast Point</h3>
      <InfoRow label="Location">{point.name || point.lat.toFixed(2) + ", " + point.lon.toFixed(2)}</InfoRow>
      <InfoRow label="Severity"><SevChip level={point.level} /></InfoRow>
      {point.reasons.map((r) => <div key={r} className="wx-reason">{r}</div>)}
      <InfoRow label="Valid">{fmtUtc(c.time)}</InfoRow>
      <InfoRow label="Wind">
        {v(c.wind_speed_kmh, "km/h")}
        {c.wind_direction_deg !== null && " from " + Math.round(c.wind_direction_deg) + "\u00b0 " + compass(c.wind_direction_deg)}
      </InfoRow>
      <InfoRow label="Gusts">{v(c.wind_gust_kmh, "km/h")}</InfoRow>
      <InfoRow label="Temperature">{v(c.temperature_c, "\u00b0C")}</InfoRow>
      <InfoRow label="Precip (1 h)">{v(c.precipitation_mm, "mm")}</InfoRow>
      <InfoRow label="Snowfall (1 h)">{v(c.snowfall_cm, "cm")}</InfoRow>
      <div className="field-label">{"Next " + s.window_hours + " h"}</div>
      <InfoRow label="Max wind">{v(s.max_wind_kmh, "km/h")}</InfoRow>
      <InfoRow label="Max gust">{v(s.max_gust_kmh, "km/h")}</InfoRow>
      <InfoRow label="Min temp">{v(s.min_temp_c, "\u00b0C")}</InfoRow>
      <InfoRow label="Precip total">{v(s.precip_total_mm, "mm")}</InfoRow>
      <InfoRow label="Snow total">{v(s.snowfall_total_cm, "cm")}</InfoRow>
      <div className="wx-sub">
        {"Forecast grid cell " + point.grid_lat + ", " + point.grid_lon + ". Retrieved " + fmtUtc(AppWeather.getState().fetchedAt) +
          ". Caution/severe: wind " + t.wind_kmh.caution + "/" + t.wind_kmh.severe + ", gust " + t.gust_kmh.caution + "/" + t.gust_kmh.severe +
          " km/h, temp \u2264 " + t.temperature_c_below.caution + "/" + t.temperature_c_below.severe + " \u00b0C (operational assumptions)."}
      </div>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
    </>
  );
}

// Forecast along a route: information for the operator / simulation input only.
export function WeatherAlongRoute({ route }) {
  useStore(AppWeather.onChange);
  const s = AppWeather.getState();
  if (!s.enabled || !route.waypoints.length) return null;
  const rows = AppWeather.getRouteConditions(route);
  const flagged = rows.filter((r) => r.conditions && ["moderate", "high", "extreme"].includes(r.conditions.level));
  const win = rows.find((r) => r.conditions)?.conditions.summary.window_hours;
  return (
    <div className="wx-route">
      <div className="field-label">{"Forecast along route" + (win ? " (next " + win + " h)" : "")}</div>
      {s.status !== "ok" && <div className="wx-status wx-bad">{s.status === "stale" ? "Stale data" : "Weather unavailable"}</div>}
      {rows.map((r) => (
        <div key={r.waypoint_id} className="wx-route-row">
          <span className="wp-num">{r.sequence + "."}</span>
          <span className="wx-route-name">{r.name}</span>
          <SevChip level={r.conditions && r.conditions.level} />
          <span className="wx-route-val">{r.conditions ? v(r.conditions.summary.max_gust_kmh, "km/h") : "\u2026"}</span>
        </div>
      ))}
      {flagged.length > 0 && (
        <div className="wx-reason">{flagged.length + " waypoint(s) exceed a configured threshold - potential operational constraint (information only; route unchanged)."}</div>
      )}
    </div>
  );
}
