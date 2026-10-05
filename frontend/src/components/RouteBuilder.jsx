import { AppRoutes } from "../lib/routes.js";
import { AppMap } from "../lib/mapLayers.js";
import { useStore } from "../hooks.js";
import { goPlanning } from "../lib/nav.js";
import { InfoRow, CoordForm } from "./Panel.jsx";
import { WeatherAlongRoute } from "./WeatherControl.jsx";

function fmtDistance(m) {
  return m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m";
}

export function routeDistance(route) {
  const map = AppMap.getMap();
  let d = 0;
  for (let i = 1; i < route.waypoints.length; i++) {
    const a = route.waypoints[i - 1], b = route.waypoints[i];
    d += map.distance([a.latitude, a.longitude], [b.latitude, b.longitude]);
  }
  return d;
}

// Finished-route list (own panel section).
export function RouteList() {
  useStore(AppRoutes.onChange);
  const routes = AppRoutes.getAll().filter((r) => r.status !== "DRAFT");
  const selected = AppRoutes.getSelectedRouteId();
  return (
    <div id="route-list">
      <div className="field-label">Routes</div>
      {!routes.length && <div className="panel-hint">No routes yet.</div>}
      {routes.map((r) => (
        <button key={r.route_id} type="button"
          className={"route-item" + (r.route_id === selected ? " selected" : "")}
          onClick={() => AppRoutes.selectRoute(r.route_id)}>
          <span className="route-item-name">{r.name}</span>
          <span className="route-item-sub">{r.waypoints.length + " waypoints \u00b7 " + r.status}</span>
        </button>
      ))}
    </div>
  );
}

// Create (draft) / Edit (finished) route. Reads live state from AppRoutes.
export default function RouteBuilder({ onDeleteRoute }) {
  useStore(AppRoutes.onChange);
  const route = AppRoutes.getWorking();
  if (!route) return null;
  const draftMode = route.status === "DRAFT";
  const wps = route.waypoints;
  const n = wps.length;
  const last = wps[n - 1];
  const selId = AppRoutes.getSelectedId();
  const sel = wps.find((w) => w.waypoint_id === selId);

  const commitName = (wp) => (e) => {
    if (e.target.value !== (wp.named ? wp.name : "")) AppRoutes.renameWaypoint(wp.waypoint_id, e.target.value);
  };

  const onAddCoords = (latStr, lonStr) => {
    const c = AppRoutes.parseCoordinates(latStr, lonStr);
    if (c.error) return c.error;
    AppRoutes.addWaypoint(c.latitude, c.longitude);
    AppMap.ensureVisible(c.latitude, c.longitude);
    return null;
  };

  const onSave = (id, name, latStr, lonStr) => {
    const err = AppRoutes.updateWaypoint(id, { name, latitude: latStr, longitude: lonStr });
    if (!err) {
      const wp = AppRoutes.getWorking().waypoints.find((w) => w.waypoint_id === id);
      AppMap.ensureVisible(wp.latitude, wp.longitude);
    }
    return err;
  };

  const start = wps[0];
  const dest = wps.find((w) => w.type === "DESTINATION");
  const stops = wps.filter((w) => w.type === "STOP").length; // intermediate waypoints
  const summary = (
    <>
      {!draftMode && <InfoRow label="Route ID">{route.route_id}</InfoRow>}
      <InfoRow label="Start">{start ? start.name : "\u2014"}</InfoRow>
      <InfoRow label="Stops">{String(stops)}</InfoRow>
      <InfoRow label="Destination">{dest ? dest.name : "not set"}</InfoRow>
      <InfoRow label="Distance">{"\u2248 " + fmtDistance(routeDistance(route))}</InfoRow>
    </>
  );

  return (
    <>
      <h3>{draftMode ? "Create Route" : "Route"}</h3>
      {!draftMode && (
        <>
          {summary}
          <button type="button" className="btn btn-primary-lg" onClick={() => goPlanning(route.route_id)}>
            Route Details &amp; Planning
          </button>
        </>
      )}

      <label className="field-label">Route Name</label>
      <input key={route.route_id + route.name} type="text" className="text-input" defaultValue={route.name}
        onBlur={(e) => AppRoutes.setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />

      <label className="field-label">Waypoints</label>
      <div className="wp-list">
        {!n && <p className="panel-hint">Click the map (or a station) to place the start.</p>}
        {wps.map((wp) => (
          <div key={wp.waypoint_id} className={"wp-row" + (wp.waypoint_id === selId ? " wp-selected" : "")}>
            <span className="wp-num" title="Select to edit" style={{ cursor: "pointer" }}
              onClick={() => AppRoutes.selectWaypoint(wp.waypoint_id)}>{wp.sequence}.</span>
            <input key={wp.waypoint_id + "|" + wp.name + "|" + wp.named} type="text" className="text-input wp-name"
              defaultValue={wp.named ? wp.name : ""} placeholder={wp.name}
              onBlur={commitName(wp)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
            <span className="wp-tag">{wp.type === "DESTINATION" ? "DEST" : wp.type === "START" ? "START" : ""}</span>
            <button type="button" className="wp-del" onClick={() => AppRoutes.deleteWaypoint(wp.waypoint_id)}
              disabled={!draftMode && n <= 2}
              title={!draftMode && n <= 2 ? "A route needs 2+ waypoints - delete the route instead" : "Delete waypoint"}>
              {"\u00d7"}
            </button>
          </div>
        ))}
      </div>

      {/* Add a waypoint by typed WGS84 coordinates (same object as a map click). */}
      <CoordForm key={"add-" + n} title="Add by Coordinates" submitText="Add Waypoint" onSubmit={onAddCoords} />

      {/* Edit the selected waypoint (name + coordinates). */}
      {sel && (
        <CoordForm key={[sel.waypoint_id, sel.latitude, sel.longitude, sel.name].join("|")}
          title={"Waypoint " + sel.sequence + " \u2014 " + sel.type}
          lat={String(sel.latitude)} lon={String(sel.longitude)} submitText="Save Changes"
          nameOpts={{ name: sel.named ? sel.name : "", placeholder: sel.name }}
          onSubmit={(lat, lon, name) => onSave(sel.waypoint_id, name, lat, lon)}>
          <button type="button" className="btn btn-secondary" onClick={() => AppRoutes.selectWaypoint(null)}>Close</button>
        </CoordForm>
      )}

      {draftMode && (
        <>
          <InfoRow label="Waypoints">{String(n)}</InfoRow>
          <InfoRow label="Segments">{String(Math.max(0, n - 1))}</InfoRow>
          {summary}
        </>
      )}

      <WeatherAlongRoute route={route} />

      {draftMode ? (
        <>
          <button type="button" className="btn btn-secondary" disabled={n === 0} onClick={() => AppRoutes.undo()}>Undo</button>
          <button type="button" className="btn btn-secondary" disabled={n < 2 || last.type === "DESTINATION"}
            onClick={() => AppRoutes.setDestination()}>Set as Destination</button>
          <button type="button" className="btn" disabled={n < 2} onClick={() => AppRoutes.finishRoute()}>Finish Route</button>
          <button type="button" className="btn btn-danger" onClick={() => AppRoutes.cancelRoute()}>Cancel</button>
        </>
      ) : (
        <>
          <InfoRow label="Status">{route.status}</InfoRow>
          <button type="button" className="btn btn-secondary" disabled={n < 2 || last.type === "DESTINATION"}
            onClick={() => AppRoutes.setDestination()}>Set as Destination</button>
          <button type="button" className="btn btn-secondary" onClick={() => AppRoutes.selectRoute(null)}>Close</button>
          <button type="button" className="btn btn-danger" onClick={() => onDeleteRoute(route)}>Delete Route</button>
        </>
      )}
    </>
  );
}
