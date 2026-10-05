/*
 * routes.js
 * ---------------------------------------------------------------
 * Expedition route state (in memory only - no persistence yet; the
 * database layer is being built separately). Pure data/logic: it never
 * touches Leaflet or the DOM, and stores only WGS84 lat/lon.
 *
 * Route    { route_id, name, status: DRAFT|PLANNED, waypoints[] }
 * Waypoint { waypoint_id, sequence, name, named, type, latitude, longitude }
 *   type: START | STOP | DESTINATION  (CHECKPOINT reserved for later)
 *
 * `sequence` is the position in the route (1-based) and is recomputed
 * on every change. `name` is always a usable display name: the custom
 * name if the user gave one (`named` = true), otherwise a default built
 * from the SEQUENCE ("Stop 3"), never from a count of named points.
 * ---------------------------------------------------------------
 */


  let routes = [];      // finished (PLANNED) routes
  let draft = null;     // route currently being created, or null
  let idCounter = 0;
  let listeners = [];
  let selectedRouteId = null; // finished route currently selected for viewing/editing
  let routeSeq = 0;           // finished-route counter (default names never repeat)
  let selectedId = null; // waypoint selected for editing (draft only)

  function notify(kind) {
    listeners.forEach((fn) => fn(kind || "change"));
  }
  function onChange(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter((f) => f !== fn); };
  }
  // The route the user is working on: the draft, else the selected route.
  function work() {
    return draft || routes.find((r) => r.route_id === selectedRouteId) || null;
  }

  function newId(prefix) {
    idCounter += 1;
    return prefix + "-" + Date.now().toString(36) + "-" + idCounter;
  }

  function defaultName(wp) {
    if (wp.type === "START") return "Start";
    if (wp.type === "DESTINATION") return "Destination";
    return "Stop " + wp.sequence;
  }

  // Recompute sequence, type and default names from list order.
  function normalize(route) {
    const last = route.waypoints.length - 1;
    route.waypoints.forEach((wp, i) => {
      wp.sequence = i + 1;
      wp.route_id = route.route_id;
      // Destination must be the final waypoint; otherwise it reverts.
      if (wp.type === "DESTINATION" && i !== last) wp.type = "STOP";
      if (i === 0) wp.type = "START";
      else if (wp.type === "START") wp.type = "STOP";
      if (!wp.named) wp.name = defaultName(wp);
    });
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  // Shared WGS84 validation for every entry path (typed input, edit form).
  // Accepts numbers or numeric strings; returns {latitude, longitude} or {error}.
  function parseCoordinates(latIn, lonIn) {
    function num(v) {
      if (typeof v === "number") return v;
      const s = String(v === null || v === undefined ? "" : v).trim();
      return s === "" ? NaN : Number(s);
    }
    const lat = num(latIn), lon = num(lonIn);
    if (!isFinite(lat)) return { error: "Latitude must be a number between -90 and 90." };
    if (lat < -90 || lat > 90) return { error: "Latitude must be between -90 and 90." };
    if (!isFinite(lon)) return { error: "Longitude must be a number between -180 and 180." };
    if (lon < -180 || lon > 180) return { error: "Longitude must be between -180 and 180." };
    return { latitude: lat, longitude: lon };
  }

  function startRoute() {
    selectedId = null;
    selectedRouteId = null;
    draft = {
      route_id: newId("route"),
      name: "Expedition Route " + pad2(routeSeq + 1),
      status: "DRAFT",
      waypoints: []
    };
    notify("structure");
    return draft;
  }

  function addWaypoint(lat, lon, customName) {
    if (!draft) return null;
    const last = draft.waypoints[draft.waypoints.length - 1];
    if (last && last.type === "DESTINATION") last.type = "STOP"; // extending the route
    const named = !!(customName && customName.trim());
    const wp = {
      waypoint_id: newId("rwp"),
      route_id: draft.route_id,
      sequence: 0,
      name: named ? customName.trim() : "",
      named: named,
      type: "STOP",
      latitude: lat,
      longitude: lon
    };
    draft.waypoints.push(wp);
    normalize(draft);
    notify("structure");
    return wp;
  }

  function find(id) {
    const r = work();
    return r ? r.waypoints.find((w) => w.waypoint_id === id) : null;
  }

  function renameWaypoint(id, name) {
    const wp = find(id);
    if (!wp) return false;
    wp.named = !!(name && name.trim());
    wp.name = wp.named ? name.trim() : "";
    normalize(work());
    notify("rename"); // panel keeps focus; map labels refresh
    return true;
  }

  function moveWaypoint(id, lat, lon) {
    const wp = find(id);
    if (!wp) return false;
    wp.latitude = lat;
    wp.longitude = lon;
    notify("move");
    return true;
  }

  // Deletes one waypoint from the working route (draft or selected route).
  // A finished route must keep at least 2 waypoints - delete the route instead.
  function deleteWaypoint(id) {
    const r = work();
    if (!r) return false;
    if (r.status !== "DRAFT" && r.waypoints.length <= 2) return false;
    const before = r.waypoints.length;
    r.waypoints = r.waypoints.filter((w) => w.waypoint_id !== id);
    if (r.waypoints.length === before) return false;
    if (selectedId === id) selectedId = null;
    normalize(r);
    notify("structure");
    return true;
  }

  function undo() {
    if (!draft || !draft.waypoints.length) return false;
    const popped = draft.waypoints.pop();
    if (popped && selectedId === popped.waypoint_id) selectedId = null;
    normalize(draft);
    notify("structure");
    return true;
  }

  // Marks the final waypoint as the destination (needs 2+ waypoints).
  // Edit name and/or coordinates of an existing waypoint in place.
  // Identity and sequence are kept; returns an error string or null.
  function updateWaypoint(id, changes) {
    const wp = find(id);
    if (!wp) return "Waypoint not found.";
    const c = parseCoordinates(changes.latitude, changes.longitude);
    if (c.error) return c.error;
    wp.latitude = c.latitude;
    wp.longitude = c.longitude;
    wp.named = !!(changes.name && changes.name.trim());
    wp.name = wp.named ? changes.name.trim() : "";
    normalize(work());
    notify("structure");
    return null;
  }

  function selectWaypoint(id) {
    selectedId = id && find(id) ? id : null;
    notify("structure");
  }

  function setDestination() {
    const r = work();
    if (!r || r.waypoints.length < 2) return false;
    r.waypoints[r.waypoints.length - 1].type = "DESTINATION";
    normalize(r);
    notify("structure");
    return true;
  }

  function setName(name) {
    const r = work();
    if (!r) return;
    if (name && name.trim()) r.name = name.trim();
    notify("rename");
  }

  function finishRoute() {
    if (!draft || draft.waypoints.length < 2) return null;
    draft.status = "PLANNED";
    const done = draft;
    selectedId = null;
    routes.push(done);
    routeSeq += 1;
    selectedRouteId = done.route_id;
    draft = null;
    notify("structure");
    return done;
  }

  function cancelRoute() {
    selectedId = null;
    draft = null;
    notify("structure");
  }

  // Select a finished route (or null to deselect). Ignored while drafting.
  function selectRoute(id) {
    if (draft) return;
    selectedRouteId = routes.some((r) => r.route_id === id) ? id : null;
    selectedId = null;
    notify("structure");
  }

  // Remove a finished route entirely; other routes are untouched.
  function deleteRoute(id) {
    const before = routes.length;
    routes = routes.filter((r) => r.route_id !== id);
    if (routes.length === before) return false;
    if (selectedRouteId === id) { selectedRouteId = null; selectedId = null; }
    notify("structure");
    return true;
  }

  // Persistence helpers (the backend stores the raw objects; drafts are never saved).
  function exportAll() {
    return JSON.parse(JSON.stringify(routes));
  }

  function load(list) {
    routes = (list || [])
      .filter((r) => r && r.route_id && Array.isArray(r.waypoints) && r.waypoints.length >= 2)
      .map((r) => {
        r.status = "PLANNED";
        r.waypoints.forEach((w) => { if (w.named === undefined) w.named = !!w.name; });
        normalize(r);
        return r;
      });
    // keep default names unique: continue after the highest "Expedition Route NN"
    routeSeq = routes.reduce((m, r) => Math.max(m, parseInt((/Expedition Route (\d+)/.exec(r.name) || [])[1] || 0, 10)), routes.length);
    notify("structure");
  }

  // Plain-object snapshot for future consumers (no internal flags).
  function toJSON(route) {
    return {
      route_id: route.route_id,
      name: route.name,
      status: route.status,
      waypoints: route.waypoints.map((w) => ({
        waypoint_id: w.waypoint_id,
        route_id: route.route_id,
        sequence: w.sequence,
        name: w.name,
        type: w.type,
        latitude: w.latitude,
        longitude: w.longitude
      }))
    };
  }

  export const AppRoutes = {
    onChange: onChange,
    startRoute: startRoute,
    addWaypoint: addWaypoint,
    renameWaypoint: renameWaypoint,
    moveWaypoint: moveWaypoint,
    deleteWaypoint: deleteWaypoint,
    undo: undo,
    setDestination: setDestination,
    updateWaypoint: updateWaypoint,
    parseCoordinates: parseCoordinates,
    selectWaypoint: selectWaypoint,
    getSelectedId: () => selectedId,
    setName: setName,
    finishRoute: finishRoute,
    cancelRoute: cancelRoute,
    isCreating: () => !!draft,
    getDraft: () => draft,
    getWorking: work,
    getSelectedRouteId: () => selectedRouteId,
    selectRoute: selectRoute,
    deleteRoute: deleteRoute,
    exportAll: exportAll,
    load: load,
    getAll: () => routes.concat(draft ? [draft] : []),
    toJSON: toJSON
  };

