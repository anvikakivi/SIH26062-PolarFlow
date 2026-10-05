import { AppRoutes } from './routes.js';
/*
 * telemetry.js
 * ---------------------------------------------------------------
 * Telemetry receiver + tracked-entity state (in memory only; logging
 * and persistence are handled elsewhere later). No Leaflet, no DOM.
 *
 * Location message (from ANY source: simulator now, real feeds later):
 *   { entity_id, timestamp (ISO 8601), latitude, longitude (WGS84),
 *     accuracy_m, source }
 *
 * Tracked entity:
 *   { entity_id, name, type, latitude, longitude, timestamp,
 *     accuracy_m, source }   (position fields null until first fix)
 *
 * entity_id is the unique identity; name is display-only.
 * ---------------------------------------------------------------
 */


  const entities = {}; // entity_id -> entity state
  let listeners = [];

  function registerEntity(def) {
    if (!def || !def.entity_id) throw new Error("entity_id is required");
    if (entities[def.entity_id]) throw new Error("Duplicate entity_id: " + def.entity_id);
    entities[def.entity_id] = {
      entity_id: def.entity_id,
      name: def.name || def.entity_id,
      type: def.type || "UNKNOWN",
      latitude: null,
      longitude: null,
      timestamp: null,
      accuracy_m: null,
      source: null
    };
    return entities[def.entity_id];
  }

  // Returns an error string, or null when the message is valid.
  function validate(msg) {
    if (!msg || typeof msg !== "object") return "Message must be an object.";
    if (typeof msg.entity_id !== "string" || !msg.entity_id) return "entity_id is required.";
    if (typeof msg.timestamp !== "string" || isNaN(Date.parse(msg.timestamp))) return "timestamp must be an ISO 8601 string.";
    const c = AppRoutes.parseCoordinates(msg.latitude, msg.longitude); // shared WGS84 validation
    if (c.error) return c.error;
    if (typeof msg.latitude !== "number" || typeof msg.longitude !== "number") return "latitude/longitude must be numbers.";
    if (msg.accuracy_m !== undefined && (typeof msg.accuracy_m !== "number" || !(msg.accuracy_m >= 0))) return "accuracy_m must be a number >= 0.";
    return null;
  }

  // The single entry point for location messages.
  function receive(msg) {
    const err = validate(msg);
    if (err) { console.warn("Telemetry rejected:", err, msg); return { ok: false, error: err }; }
    const ent = entities[msg.entity_id];
    if (!ent) {
      const e = "Unknown entity_id: " + msg.entity_id;
      console.warn("Telemetry rejected:", e);
      return { ok: false, error: e };
    }
    ent.latitude = msg.latitude;
    ent.longitude = msg.longitude;
    ent.timestamp = msg.timestamp;
    ent.accuracy_m = msg.accuracy_m === undefined ? null : msg.accuracy_m;
    ent.source = msg.source || null;
    listeners.forEach((fn) => fn(ent));
    return { ok: true };
  }

  export const AppTelemetry = {
    registerEntity: registerEntity,
    receive: receive,
    onUpdate: (fn) => {
      listeners.push(fn);
      return () => { listeners = listeners.filter((f) => f !== fn); };
    },
    getEntity: (id) => entities[id] || null,
    getEntities: () => Object.keys(entities).map((k) => entities[k])
  };

