import L from 'leaflet';
import { AppCRS } from './projection.js';
import { AppLocations } from './waypoints.js';
import { AppData } from './api.js';
import { gridCells, levelInfo } from './weather.js';
/*
 * map.js
 * ---------------------------------------------------------------
 * All Leaflet-specific rendering lives here: map initialization
 * with the Antarctic CRS (see projection.js), the land basemap
 * layer, the geographic grid (graticule), and station/waypoint
 * markers. Station and waypoint *data* lives in waypoints.js -
 * this file only draws whatever that module currently holds.
 * ---------------------------------------------------------------
 */


  let map = null;
  let markerLayer = null;
  const markerById = {}; // id -> Leaflet marker, so we can update in place

  const STATION_ICON = L.divIcon({
    className: "station-marker",
    iconSize: [14, 14]
  });

  const waypointIcons = {}; // cache: colour key -> divIcon
  function waypointIcon(colorKey) {
    const hex = AppLocations.colorHex(colorKey);
    if (!waypointIcons[hex]) {
      waypointIcons[hex] = L.divIcon({
        className: "waypoint-marker",
        html: '<span class="wp-dot" style="background:' + hex + '"></span>',
        iconSize: [14, 14]
      });
    }
    return waypointIcons[hex];
  }

  // ---- Region fitting (reusable by future modules) -------------------
  // A "region" is a rectangle in EPSG:3031 metres (L.Bounds). fitRegion()
  // picks the zoom from the CRS's own scale, so it is real-distance based.
  // The full-Antarctica region is derived from the loaded land data; the
  // fallback below is only used until that data has loaded.
  const crs = AppCRS.antarctic;
  const REGION_MARGIN = 0.06; // fraction of extent added as ocean margin
  let homeRegion = L.bounds([-3000000, -3000000], [3000000, 3000000]);

  function fitZoomFor(region) {
    const size = map.getSize();
    const w = Math.max(1, region.max.x - region.min.x);
    const h = Math.max(1, region.max.y - region.min.y);
    const mPerPx = Math.max(w / Math.max(1, size.x), h / Math.max(1, size.y));
    const z = crs.zoom(1 / mPerPx);
    return Math.max(0, Math.floor(z * 4) / 4); // snap down so it always fits
  }

  function fitRegion(region, opts) {
    const c = region.getCenter();
    map.setView(crs.unproject(c), fitZoomFor(region), Object.assign({ animate: false }, opts));
  }

  function setHomeRegion(region) {
    homeRegion = region;
    map.setMinZoom(fitZoomFor(homeRegion)); // cannot zoom out past the home view
    // Pan limit: the home region (converted via the CRS, no pixel maths).
    map.setMaxBounds(L.latLngBounds(crs.unproject(homeRegion.min), crs.unproject(homeRegion.max)));
  }

  function showFullView() {
    fitRegion(homeRegion);
  }

  // The Leaflet map is now created by React-Leaflet (<MapContainer>, see
  // components/MapView.jsx) with the same options as before; everything
  // below is the unchanged map logic, attached to that instance.
  function attach(m) {
    map = m;
    // Stacking inside the SVG overlay: land (400) < weather cells (410) < route lines (420).
    map.createPane("weatherArea").style.zIndex = 410;
    map.createPane("routeLines").style.zIndex = 420;

    setHomeRegion(homeRegion);
    showFullView();
    map.on("resize", () => {
      map.setMinZoom(fitZoomFor(homeRegion));
    });

    new FullViewControl().addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
    new CoordinateReadout().addTo(map);

    return map;
  }

  const FullViewControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function () {
      const btn = L.DomUtil.create("button", "full-view-btn");
      btn.type = "button";
      btn.title = "Full Antarctica view";
      btn.textContent = "Full Antarctica";
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, "click", showFullView);
      return btn;
    }
  });

  function fmt(v) {
    const t = v.toFixed(5);
    return v < 0 ? t : "&nbsp;" + t;
  }

  const CoordinateReadout = L.Control.extend({
    options: { position: "bottomleft" },
    onAdd: function (m) {
      this._el = L.DomUtil.create("div", "coord-readout");
      this._el.innerHTML = "LAT  --<br/>LON  --";
      m.on("mousemove click", this._update, this);
      return this._el;
    },
    onRemove: function (m) {
      m.off("mousemove click", this._update, this);
    },
    _update: function (e) {
      this._el.innerHTML =
        "LAT&nbsp;&nbsp;" + fmt(e.latlng.lat) + "&deg;<br/>" +
        "LON&nbsp;&nbsp;" + fmt(e.latlng.wrap().lng) + "&deg;";
    }
  });

  // Projected (EPSG:3031 m) extent of a GeoJSON, padded by REGION_MARGIN.
  function regionFromGeoJSON(gj) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (function walk(c) {
      if (typeof c[0] === "number") {
        {
          const p = crs.project(L.latLng(c[1], c[0]));
          if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
      } else c.forEach(walk);
    })(gj.features ? gj.features.map((f) => f.geometry.coordinates) : gj.coordinates);
    const half = Math.max(maxX - minX, maxY - minY) / 2 * (1 + 2 * REGION_MARGIN);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return L.bounds([cx - half, cy - half], [cx + half, cy + half]);
  }

  async function loadLandLayer() {
    const geojson = await AppData.loadLandGeoJSON();
    setHomeRegion(regionFromGeoJSON(geojson));
    showFullView();
    L.geoJSON(geojson, {
      style: {
        color: "#889",
        weight: 1,
        fillColor: "#f2f3f5",
        fillOpacity: 1
      }
    }).addTo(map);
  }

  function addGraticule() {
    // Dynamic metric grid in EPSG:3031 (replaces the old fixed lat/lon
    // graticule). Spacing is a real projected distance chosen from a
    // fixed step table so it always represents actual EPSG:3031 metres,
    // never an arbitrary pixel interval. Only the currently visible
    // extent is drawn, and it is rebuilt (not redrawn per-frame) only
    // on moveend/zoomend, so the DOM/SVG element count stays small.
    const GRID_STEPS_M = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
    const MIN_PX_GAP = 80; // don't let lines get closer than this on screen

    const gridLayer = L.layerGroup().addTo(map);

    function pickSpacing(metresPerPixel) {
      for (let i = 0; i < GRID_STEPS_M.length; i++) {
        if (GRID_STEPS_M[i] / metresPerPixel >= MIN_PX_GAP) return GRID_STEPS_M[i];
      }
      return GRID_STEPS_M[GRID_STEPS_M.length - 1];
    }

    // Pixel coordinates -> raw EPSG:3031 projected metres (inverse of
    // what Leaflet uses internally to place things on screen).
    function pixelToProjected(pixelPoint, zoom) {
      return crs.transformation.untransform(pixelPoint, crs.scale(zoom));
    }

    function rebuild() {
      gridLayer.clearLayers();

      const zoom = map.getZoom();
      const metresPerPixel = 1 / crs.scale(zoom);
      const spacing = pickSpacing(metresPerPixel);

      const pb = map.getPixelBounds();
      const a = pixelToProjected(pb.min, zoom);
      const b = pixelToProjected(pb.max, zoom);
      const minX = Math.min(a.x, b.x) - spacing;
      const maxX = Math.max(a.x, b.x) + spacing;
      const minY = Math.min(a.y, b.y) - spacing;
      const maxY = Math.max(a.y, b.y) + spacing;

      const style = { color: "#8fa6c2", weight: 1, opacity: 0.6, interactive: false };

      const x0 = Math.floor(minX / spacing) * spacing;
      for (let x = x0; x <= maxX; x += spacing) {
        L.polyline([crs.unproject(L.point(x, minY)), crs.unproject(L.point(x, maxY))], style).addTo(gridLayer);
      }
      const y0 = Math.floor(minY / spacing) * spacing;
      for (let y = y0; y <= maxY; y += spacing) {
        L.polyline([crs.unproject(L.point(minX, y)), crs.unproject(L.point(maxX, y))], style).addTo(gridLayer);
      }
    }

    map.on("moveend zoomend", rebuild);
    rebuild();
  }

  function renderAllMarkers(locations, onMarkerClick) {
    if (markerLayer) {
      map.removeLayer(markerLayer);
    }
    markerLayer = L.layerGroup().addTo(map);
    for (const key in markerById) delete markerById[key];

    locations.forEach((loc) => {
      const icon = loc.type === "station" ? STATION_ICON : waypointIcon(loc.color);
      const marker = L.marker([loc.latitude, loc.longitude], { icon: icon });
      marker.bindTooltip(loc.name, { permanent: false, direction: "top", className: "loc-label" });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onMarkerClick(loc.id);
      });
      marker.addTo(markerLayer);
      markerById[loc.id] = marker;
    });
  }

  // ---- Route layer -----------------------------------------------------
  // Draws AppRoutes data: straight segments between consecutive waypoints
  // (straight in the EPSG:3031 plane, as Leaflet draws them) and numbered
  // markers. Draft waypoints are draggable; a drag updates the line live
  // and commits the new WGS84 position on dragend.
  let routeLayer = null;

  function routeIcon(wp, selected, severity) {
    const cls = "route-pin route-" + wp.type.toLowerCase() + (selected ? " route-selected" : "") +
      (severity === "moderate" || severity === "high" || severity === "extreme" ? " wx-ring-" + severity : "");
    return L.divIcon({
      className: "route-pin-wrap",
      html: '<span class="' + cls + '">' + (wp.type === "DESTINATION" ? "&#9873;" : wp.sequence) + "</span>",
      iconSize: [24, 24]
    });
  }

  function renderRoutes(routes, handlers) {
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.layerGroup().addTo(map);
    routes.forEach((route) => {
      const draft = route.status === "DRAFT";
      const active = route.route_id === handlers.workingId; // draft or selected route
      const line = L.polyline(route.waypoints.map((w) => [w.latitude, w.longitude]), {
        color: active ? "#c4652b" : "#1c4e80",
        weight: active ? 4 : 3,
        dashArray: draft ? "8 6" : null,
        interactive: false,
        pane: "routeLines"
      }).addTo(routeLayer);
      if (!active && !handlers.creating && handlers.onSelectRoute) {
        // wide invisible hit-line so a route can be selected by clicking it on the map
        L.polyline(route.waypoints.map((w) => [w.latitude, w.longitude]), {
          weight: 16, opacity: 0, pane: "routeLines", interactive: true, bubblingMouseEvents: false
        }).bindTooltip(route.name, { sticky: true, className: "loc-label" })
          .on("click", () => handlers.onSelectRoute(route.route_id)).addTo(routeLayer);
      }
      const markers = route.waypoints.map((wp) => {
        const m = L.marker([wp.latitude, wp.longitude], {
          icon: routeIcon(wp, handlers.selectedId === wp.waypoint_id, handlers.severityOf && handlers.severityOf(wp)),
          draggable: active,
          zIndexOffset: 1000
        });
        m.bindTooltip(wp.sequence + ". " + wp.name, { direction: "top", offset: [0, -10], className: "loc-label" });
        if (!active) {
          m.on("click", () => handlers.onSelectRoute && handlers.onSelectRoute(route.route_id));
        } else {
          m.on("click", () => handlers.onSelect && handlers.onSelect(wp.waypoint_id));
          m.on("drag", () => line.setLatLngs(markers.map((x) => x.getLatLng())));
          m.on("dragend", () => {
            const p = m.getLatLng().wrap();
            handlers.onMove(wp.waypoint_id, p.lat, p.lng);
          });
        }
        return m.addTo(routeLayer);
      });
    });
  }

  // Pan (only if needed) so a coordinate typed in by the user is on screen.
  function ensureVisible(lat, lon) {
    const ll = L.latLng(lat, lon);
    if (!map.getBounds().contains(ll)) map.panTo(ll, { animate: false });
  }

  // ---- Tracked-entity layer ---------------------------------------------
  // One marker per entity_id: created on first fix, then MOVED in place.
  let entityLayer = null;
  const entityMarkers = {}; // entity_id -> Leaflet marker

  // Popup body built from the entity's latest telemetry record. `ent` is
  // the receiver's own state object (mutated in place), so this always
  // reflects the record that produced the marker's current position. The
  // time shown is the message timestamp (UTC), never the click time.
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function p2(n) { return n < 10 ? "0" + n : String(n); }

  function entityPopupContent(ent) {
    const t = new Date(ent.timestamp);
    const rows = [
      ["Name", ent.name],
      ["ID", ent.entity_id],
      ["Latitude", ent.latitude.toFixed(5) + "\u00b0"],
      ["Longitude", ent.longitude.toFixed(5) + "\u00b0"],
      ["Location received", p2(t.getUTCHours()) + ":" + p2(t.getUTCMinutes()) + ":" + p2(t.getUTCSeconds()) + " UTC"],
      ["Date", t.getUTCDate() + " " + MONTHS[t.getUTCMonth()] + " " + t.getUTCFullYear()],
      ["Source", ent.source || "\u2014"]
    ];
    if (ent.accuracy_m !== null) rows.push(["Accuracy", ent.accuracy_m + " m"]);
    const box = L.DomUtil.create("div", "entity-popup");
    rows.forEach(([k, v]) => {
      const r = L.DomUtil.create("div", "entity-popup-row", box);
      L.DomUtil.create("span", "entity-popup-key", r).textContent = k;
      L.DomUtil.create("span", "entity-popup-val", r).textContent = v; // textContent: no HTML injection
    });
    return box;
  }

  function upsertEntityMarker(ent) {
    if (!entityLayer) entityLayer = L.layerGroup().addTo(map);
    const label = ent.name + " (" + ent.entity_id + ")";
    let m = entityMarkers[ent.entity_id];
    if (m) {
      m.setLatLng([ent.latitude, ent.longitude]);
      m.setTooltipContent(label);
      if (m.isPopupOpen()) m.getPopup().setContent(entityPopupContent(ent)); // refresh if open
    } else {
      m = L.marker([ent.latitude, ent.longitude], {
        icon: L.divIcon({
          className: "entity-marker-wrap",
          html: '<span class="entity-marker entity-' + ent.type.toLowerCase() + '"></span>',
          iconSize: [18, 18]
        }),
        zIndexOffset: 2000
      });
      m.bindTooltip(label, { direction: "top", offset: [0, -10], className: "loc-label" });
      m.bindPopup(() => entityPopupContent(ent), { className: "entity-popup-wrap", minWidth: 200 });
      m.addTo(entityLayer);
      entityMarkers[ent.entity_id] = m;
    }
    return m;
  }

  // ---- Weather layer ----------------------------------------------------
  // Small wind arrows (station + coarse grid forecast points) in the marker pane
  // BELOW stations/routes/personnel (negative zIndexOffset). Arrow rotation: wind
  // direction is a compass bearing "from"; the arrow points where the wind blows
  // TOWARD (dir+180). On the EPSG:3031 map, true north at longitude L points
  // screen-clockwise by L degrees from "up", so rotation = L + (dir+180).
  let weatherLayer = null;
  const LEVEL_Z = { extreme: -300, high: -400, moderate: -500, low: -600, none: -700 };

  function windArrowAngle(lon, dirFrom) {
    return (((lon + dirFrom + 180) % 360) + 360) % 360;
  }

  // Closed ring (lat/lon) for one forecast cell. Meridian edges are straight lines on the
  // polar map; parallels are curves, so they are densified (every 5 deg of longitude).
  function cellRing(c) {
    const ring = [];
    const lonAt = (k) => c.west + (c.step * k) / Math.ceil(c.step / 5);
    const n = Math.ceil(c.step / 5);
    if (c.pole) {
      for (let k = 0; k < 72; k++) ring.push([c.north, -180 + k * 5]);
      return ring;
    }
    for (let k = 0; k <= n; k++) ring.push([c.north, lonAt(k)]);
    for (let k = n; k >= 0; k--) ring.push([c.south, lonAt(k)]);
    return ring;
  }

  // Severity areas: one translucent polygon per forecast cell, coloured and opacity-scaled by
  // the derived level (computed from real forecast values; not official storm boundaries).
  // Normal cells are not drawn. Non-interactive so map clicks / route building pass through.
  function renderWeatherAreas(points, selectedId) {
    gridCells(points).forEach((c) => {
      const lv = levelInfo(c.point.level);
      const selected = c.point.id === selectedId;
      if (lv.opacity === 0 && !selected) return;
      L.polygon(cellRing(c), {
        pane: "weatherArea", interactive: false, stroke: selected, color: "#1c2530", weight: 2, dashArray: "5 4",
        fillColor: lv.color, fillOpacity: lv.opacity, fill: true
      }).addTo(weatherLayer);
    });
  }

  function renderWeather(points, opts) {
    if (weatherLayer) map.removeLayer(weatherLayer);
    weatherLayer = null;
    if (!points || !points.length) return;
    weatherLayer = L.layerGroup().addTo(map);
    renderWeatherAreas(points, opts.selectedId);
    points.forEach((p) => {
      const c = p.current || {};
      const hasWind = c.wind_direction_deg !== null && c.wind_direction_deg !== undefined;
      const rot = hasWind ? windArrowAngle(p.lon, c.wind_direction_deg) : 0;
      const sel = opts.selectedId === p.id ? " wx-selected" : "";
      const icon = L.divIcon({
        className: "wx-wrap",
        html: '<span class="wx wx-arrow' + sel + '"><svg viewBox="0 0 20 20" width="16" height="16" style="transform:rotate(' + rot +
          'deg)">' + (hasWind ? '<path d="M10 1 L15.5 13 L10 10.5 L4.5 13 Z" fill="currentColor"/>' : '<circle cx="10" cy="10" r="3" fill="currentColor"/>') +
          "</svg></span>",
        iconSize: [22, 22],
        iconAnchor: p.kind === "station" ? [-8, 26] : [11, 11] // station arrow sits beside the station marker
      });
      const m = L.marker([p.lat, p.lon], {
        icon: icon, interactive: opts.interactive !== false, zIndexOffset: LEVEL_Z[p.level] || -700, keyboard: false
      });
      if (opts.interactive !== false) {
        m.bindTooltip((p.name ? p.name + " \u2013 " : "") + (c.wind_speed_kmh ?? "?") + " km/h \u00b7 " + levelInfo(p.level).label,
          { direction: "top", offset: [0, -8], className: "loc-label" });
        m.on("click", () => opts.onSelect(p.id));
      }
      m.addTo(weatherLayer);
    });
  }

  function getMap() {
    return map;
  }

  function onMapClick(handler) {
    map.on("click", (e) => {
      handler(e.latlng.lat, e.latlng.lng);
    });
  }

  export const AppMap = {
    attach: attach,
    loadLandLayer: loadLandLayer,
    addGraticule: addGraticule,
    renderAllMarkers: renderAllMarkers,
    onMapClick: onMapClick,
    renderRoutes: renderRoutes,
    getMap: getMap,
    renderWeather: renderWeather,
    windArrowAngle: windArrowAngle,
    upsertEntityMarker: upsertEntityMarker,
    ensureVisible: ensureVisible,
    fitRegion: fitRegion,
    showFullView: showFullView
  };

