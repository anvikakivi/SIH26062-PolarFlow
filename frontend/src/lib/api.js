/*
 * api.js - single point of contact with the FastAPI backend (replaces the
 * old pywebview bridge in data.js). Same function names as before.
 */
async function json(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(url + " -> " + res.status);
  return res.json();
}
const send = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

export const AppData = {
  loadStations: () => json("/api/stations"),
  loadWaypoints: () => json("/api/waypoints").catch(() => []),
  saveWaypoints: (waypoints) => json("/api/waypoints", send("PUT", waypoints)),
  loadLandGeoJSON: () => json("/api/land"),
  loadRoutes: () => json("/api/routes").catch(() => []),
  saveRoutes: (routes) => json("/api/routes", send("PUT", routes)),
  loadPlans: () => json("/api/plans").catch(() => []),
  savePlans: (plans) => json("/api/plans", send("PUT", plans)),
  loadWeather: (points) =>
    json("/api/weather" + (points && points.length ? "?points=" + encodeURIComponent(points.map((p) => p.join(",")).join(";")) : "")),
  loadSimCargo: () => json("/api/simulation/cargo"),
  runCargoDelay: async (body) => {
    const res = await fetch("/api/simulation/cargo-delay", send("POST", body));
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).detail) || "Simulation failed (" + res.status + ")");
    return res.json();
  },
  exportCargoDelay: async (body) => {
    const res = await fetch("/api/simulation/cargo-delay/export", send("POST", body));
    if (!res.ok) throw new Error("Export failed (" + res.status + ")");
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: "cargo_delay_" + body.cargo_id + "_" + body.delay_days + "d.xlsx" });
    a.click();
    URL.revokeObjectURL(url);
  },
  appendTelemetry: (record) => json("/api/telemetry", send("POST", record))
};
