import { useEffect, useState } from "react";
import MapView from "./components/MapView.jsx";
import RouteBuilder, { RouteList } from "./components/RouteBuilder.jsx";
import { Hint, ClickedLocation, CreateForm, LocationInfo, EditForm, Confirm } from "./components/Panel.jsx";
import { useStore } from "./hooks.js";
import { AppData } from "./lib/api.js";
import { AppLocations } from "./lib/waypoints.js";
import { AppRoutes } from "./lib/routes.js";
import { AppTelemetry } from "./lib/telemetry.js";
import { AppSimulator } from "./lib/simulator.js";
import { AppMap } from "./lib/mapLayers.js";
import { AppWeather } from "./lib/weather.js";
import PlanningPage from "./components/PlanningPage.jsx";
import { AppPlans } from "./lib/plans.js";
import SimulationPage from "./components/SimulationPage.jsx";
import { useHashRoute, goMap, goSimulation } from "./lib/nav.js";
import { WeatherControl, WeatherDetail, ClickedForecast } from "./components/WeatherControl.jsx";

const HINT = { kind: "hint" };

export default function App() {
  const [ready, setReady] = useState(false);
  // What the panel's content area shows (last writer wins, as before).
  const [content, setContent] = useState(HINT);
  const [simRunning, setSimRunning] = useState(false);
  useStore(AppRoutes.onChange); // Create Route / route list visibility
  useStore(AppWeather.onChange); // weather detail panel
  const view = useHashRoute();
  const onPlan = view.page === "plan";
  const onSim = view.page === "simulation";
  // map stays mounted (hidden) on the planning page; re-measure it on return
  useEffect(() => { if (!onPlan && !onSim && ready) AppMap.getMap().invalidateSize(); }, [onPlan, onSim, ready]);

  // Map + base layers are ready -> load stations/waypoints.
  const onMapReady = async () => {
    const [stations, waypoints, routes, plans] = await Promise.all([AppData.loadStations(), AppData.loadWaypoints(), AppData.loadRoutes(), AppData.loadPlans()]);
    AppPlans.load(plans);
    AppLocations.init(stations, waypoints);
    AppRoutes.load(routes); // saved routes come back on startup
    setReady(true);
  };

  // ---- Wiring between stores and map layers (was js/app.js) ----------
  useEffect(() => {
    if (!ready) return;
    const offs = [];

    // Stations + waypoints
    const onMarkerClick = (id) => {
      const loc = AppLocations.getById(id);
      if (!loc) return;
      if (AppRoutes.isCreating()) { // stations can be route start/stop points
        if (loc.type === "station") AppRoutes.addWaypoint(loc.latitude, loc.longitude, loc.name);
        return;
      }
      setContent({ kind: "location", id });
    };
    const redraw = () => AppMap.renderAllMarkers(AppLocations.getAll(), onMarkerClick);
    offs.push(AppLocations.onChange(redraw));
    redraw();

    AppMap.onMapClick((lat, lon) => {
      if (AppRoutes.isCreating()) { AppRoutes.addWaypoint(lat, lon); return; }
      setContent({ kind: "clicked", lat, lon });
    });

    // Routes
    const drawRoutes = () => {
      const creating = AppRoutes.isCreating();
      const work = AppRoutes.getWorking();
      AppMap.renderRoutes(AppRoutes.getAll(), {
        workingId: work ? work.route_id : null,
        selectedId: AppRoutes.getSelectedId(),
        // severity ring on route pins comes from the weather layer (when on)
        severityOf: (wp) => { const c = AppWeather.conditionFor(wp.latitude, wp.longitude); return c && c.level; },
        onSelect: (id) => AppRoutes.selectWaypoint(id),
        creating: creating,
        onSelectRoute: (id) => { if (!creating) AppRoutes.selectRoute(id); },
        onMove: (id, lat, lon) => AppRoutes.moveWaypoint(id, lat, lon)
      });
    };
    offs.push(AppRoutes.onChange((kind) => {
      const work = AppRoutes.getWorking();
      drawRoutes();
      drawWeather(); // arrows become non-interactive while a route is being created
      if (kind !== "rename") AppWeather.scheduleRefresh(); // forecast for the route's waypoints
      if (kind === "rename") return;
      setContent(work ? { kind: "route" } : HINT);
    }));

    // Persist finished routes (drafts never); skip if nothing changed.
    let saveTimer = null, lastSaved = JSON.stringify(AppRoutes.exportAll());
    offs.push(AppRoutes.onChange(() => {
      clearTimeout(saveTimer);
      AppPlans.prune(AppRoutes.exportAll().map((r) => r.route_id));
      saveTimer = setTimeout(() => {
        const snap = JSON.stringify(AppRoutes.exportAll());
        if (snap === lastSaved) return;
        AppData.saveRoutes(JSON.parse(snap)).then(() => { lastSaved = snap; }).catch((e) => console.warn("Route save failed:", e));
      }, 400);
    }));

    // Weather overlay (below operational markers); selecting a point opens its forecast.
    function drawWeather() {
      AppMap.renderWeather(AppWeather.layerPoints(), {
        interactive: !AppRoutes.isCreating(),
        selectedId: AppWeather.getSelectedId(),
        onSelect: (id) => { AppWeather.select(id); setContent({ kind: "weather", id }); }
      });
    }
    offs.push(AppWeather.onChange(() => { drawWeather(); drawRoutes(); }));
    drawRoutes(); // routes loaded from storage

    // Telemetry: source -> message -> receiver -> entity -> marker (+ CSV log)
    if (!AppTelemetry.getEntity("PER-0007")) {
      AppTelemetry.registerEntity({ entity_id: "PER-0007", name: "Field Team Alpha", type: "PERSONNEL" });
    }
    offs.push(AppTelemetry.onUpdate((ent) => AppMap.upsertEntityMarker(ent)));
    offs.push(AppTelemetry.onUpdate((ent) => {
      AppData.appendTelemetry({
        timestamp: ent.timestamp, entity_id: ent.entity_id, latitude: ent.latitude,
        longitude: ent.longitude, accuracy: ent.accuracy_m, source: ent.source
      }).catch((e) => console.warn("Telemetry log failed:", e));
    }));

    return () => { offs.forEach((off) => off()); AppSimulator.stop(); };
  }, [ready]);

  const toggleSim = () => {
    if (AppSimulator.isRunning()) {
      AppSimulator.stop();
      setSimRunning(false);
    } else {
      AppSimulator.start("PER-0007", AppTelemetry.receive); // source only knows the receiver
      setSimRunning(true);
    }
  };

  // ---- Panel content ---------------------------------------------------
  const creating = AppRoutes.isCreating();
  const loc = content.id ? AppLocations.getById(content.id) : null;
  let body;
  switch (content.kind) {
    case "clicked":
      body = <ClickedLocation lat={content.lat} lon={content.lon}
        onCreate={() => setContent({ kind: "create", lat: content.lat, lon: content.lon })}>
        <ClickedForecast point={AppWeather.pointAt(content.lat, content.lon)}
          onDetails={(id) => { AppWeather.select(id); setContent({ kind: "weather", id }); }} />
      </ClickedLocation>;
      break;
    case "create":
      body = <CreateForm lat={content.lat} lon={content.lon} onCreate={(lat, lon, name, color) => {
        AppLocations.addWaypoint(lat, lon, name, color);
        setContent(HINT);
      }} />;
      break;
    case "location":
      body = loc ? <LocationInfo loc={loc} onEdit={() => setContent({ kind: "edit", id: loc.id })}
        onDelete={(id) => { AppLocations.deleteWaypoint(id); setContent(HINT); }} /> : <Hint />;
      break;
    case "edit":
      body = loc ? <EditForm loc={loc} onRename={(id, name, color) => {
        AppLocations.renameWaypoint(id, name, color);
        setContent(HINT);
      }} /> : <Hint />;
      break;
    case "route":
      body = <RouteBuilder onDeleteRoute={(r) => setContent({ kind: "confirm", route: { id: r.route_id, name: r.name } })} />;
      break;
    case "weather": {
      const wp = AppWeather.getPoint(content.id);
      body = wp ? <WeatherDetail point={wp} onClose={() => { AppWeather.select(null); setContent(HINT); }} /> : <Hint />;
      break;
    }
    case "confirm":
      body = <Confirm text={'Delete Route "' + content.route.name + '"?'} confirmLabel="Delete"
        onConfirm={() => AppRoutes.deleteRoute(content.route.id)}
        onCancel={() => setContent({ kind: "route" })} />;
      break;
    default:
      body = <Hint />;
  }

  return (
    <>
    {onSim && <SimulationPage onBack={goMap} />}
    {onPlan && ready && <PlanningPage routeId={view.routeId} onBack={goMap} />}
    <div id="app" style={onPlan || onSim ? { display: "none" } : undefined}>
      <MapView onReady={onMapReady} />
      <div id="panel">
        <div className="panel-header">Antarctic Operations</div>
        <div id="panel-actions">
          {!creating && <button type="button" className="btn" onClick={() => AppRoutes.startRoute()}>Create Route</button>}
          <button type="button" className="btn btn-secondary" onClick={toggleSim}>
            {simRunning ? "Stop Simulator" : "Start Simulator"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={goSimulation}>Simulation</button>
        </div>
        <WeatherControl />
        {!creating && <RouteList />}
        <div id="panel-content">{body}</div>
      </div>
    </div>
    </>
  );
}
