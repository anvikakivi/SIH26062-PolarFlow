import { AppData } from './api.js';
/*
 * waypoints.js
 * ---------------------------------------------------------------
 * Holds the in-memory list of user-created waypoints and station
 * markers as a single combined "locations" model, and enforces the
 * editable/protected distinction structurally (not just in the UI):
 * every location object carries `type` ("station" | "waypoint") and
 * `editable` (bool). Any function that mutates a location checks
 * `editable` before doing anything, regardless of what the UI shows.
 * ---------------------------------------------------------------
 */


  const COLORS = {
    green: "#2e9d57",
    blue: "#2f6fd0",
    red: "#d0362f",
    orange: "#e07b1f",
    purple: "#7d4bc0"
  };
  const DEFAULT_COLOR = "orange";
  function normColor(c) {
    return COLORS[c] ? c : DEFAULT_COLOR;
  }
  function colorHex(c) {
    return COLORS[normColor(c)];
  }

  let locations = []; // stations + waypoints combined
  let listeners = [];

  function notify() {
    listeners.forEach((fn) => fn(locations));
  }

  function onChange(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter((f) => f !== fn); };
  }

  function init(stations, waypoints) {
    const stationLocs = stations.map((s) => ({
      id: s.id,
      name: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      type: "station",
      editable: false
    }));
    const waypointLocs = waypoints.map((w) => ({
      id: w.id,
      name: w.name,
      latitude: w.latitude,
      longitude: w.longitude,
      color: normColor(w.color),
      type: "waypoint",
      editable: true
    }));
    locations = stationLocs.concat(waypointLocs);
    notify();
  }

  function getAll() {
    return locations.slice();
  }

  function getById(id) {
    return locations.find((l) => l.id === id) || null;
  }

  function addWaypoint(lat, lon, name, color) {
    const wp = {
      id: "wp-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      name: name && name.trim() ? name.trim() : "Unnamed Waypoint",
      latitude: lat,
      longitude: lon,
      color: normColor(color),
      type: "waypoint",
      editable: true
    };
    locations.push(wp);
    notify();
    persist();
    return wp;
  }

  function renameWaypoint(id, newName, color) {
    const loc = getById(id);
    if (!loc || !loc.editable) {
      console.warn("Refused to rename a non-editable location:", id);
      return false;
    }
    loc.name = newName && newName.trim() ? newName.trim() : loc.name;
    if (color) loc.color = normColor(color);
    notify();
    persist();
    return true;
  }

  function deleteWaypoint(id) {
    const loc = getById(id);
    if (!loc || !loc.editable) {
      console.warn("Refused to delete a non-editable location:", id);
      return false;
    }
    locations = locations.filter((l) => l.id !== id);
    notify();
    persist();
    return true;
  }

  function persist() {
    const userWaypoints = locations
      .filter((l) => l.type === "waypoint")
      .map((l) => ({
        id: l.id,
        name: l.name,
        latitude: l.latitude,
        longitude: l.longitude,
        color: l.color
      }));
    AppData.saveWaypoints(userWaypoints);
  }

  export const AppLocations = {
    init: init,
    getAll: getAll,
    getById: getById,
    addWaypoint: addWaypoint,
    renameWaypoint: renameWaypoint,
    deleteWaypoint: deleteWaypoint,
    onChange: onChange,
    COLORS: COLORS,
    colorHex: colorHex
  };

