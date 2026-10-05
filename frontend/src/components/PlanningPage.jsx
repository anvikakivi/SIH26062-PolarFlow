import { useEffect, useRef, useState } from "react";
import { AppRoutes } from "../lib/routes.js";
import { AppLocations } from "../lib/waypoints.js";
import { AppPlans } from "../lib/plans.js";
import { loadPlanningCatalog } from "../lib/resourceCatalog.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => (iso ? Number(iso.slice(8, 10)) + " " + MONTHS[Number(iso.slice(5, 7)) - 1] + " " + iso.slice(0, 4) : "\u2014");
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const BLANK = { expedition: { name: "", id: "", start_date: "", end_date: "" }, arrivals: {}, resources: [], personnel: [], assets: [] };
let rowSeq = 0;

// Timeline rows come straight from the map-created route (never re-entered here).
// Labels follow the route role: Start / Stop 1..n / Destination; the name column shows
// only names the operator gave on the map.
function timelineOf(route) {
  let stop = 0;
  return route.waypoints.map((w) => ({
    waypoint_id: w.waypoint_id, sequence: w.sequence, type: w.type,
    label: w.type === "START" ? "Start" : w.type === "DESTINATION" ? "Destination" : "Stop " + ++stop,
    name: w.named ? w.name : "", latitude: w.latitude, longitude: w.longitude
  }));
}

const place = (r) => (r ? (r.name || r.label) + " (" + r.latitude.toFixed(3) + ", " + r.longitude.toFixed(3) + ")" : "\u2014");

export default function PlanningPage({ routeId, onBack }) {
  const route = AppRoutes.getAll().find((r) => r.route_id === routeId && r.status === "PLANNED");
  const [catalog, setCatalog] = useState(null);
  const [form, setForm] = useState(() => AppPlans.getDraft(routeId) || (AppPlans.getSaved(routeId) && fromSaved(AppPlans.getSaved(routeId))) || BLANK);
  const [errors, setErrors] = useState([]);
  const [msg, setMsg] = useState("");
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => { loadPlanningCatalog().then(setCatalog); }, []);
  useEffect(() => () => AppPlans.setDraft(routeId, formRef.current), [routeId]); // keep edits when going back to the map
  useEffect(() => { window.scrollTo(0, 0); }, []);

  if (!route) {
    return (
      <div className="plan-page">
        <div className="plan-head"><h1>Expedition Planning</h1><button type="button" className="btn btn-secondary plan-back" onClick={onBack}>Back to Map</button></div>
        <p className="plan-note">This route no longer exists.</p>
      </div>
    );
  }

  const timeline = timelineOf(route);
  const stops = timeline.filter((t) => t.type === "STOP").length;
  const start = timeline[0], dest = timeline.find((t) => t.type === "DESTINATION");
  const stations = AppLocations.getAll().filter((l) => l.type === "station");
  const ex = form.expedition;
  const duration = ex.start_date && ex.end_date && ex.end_date >= ex.start_date ? dayDiff(ex.start_date, ex.end_date) : null;

  const set = (patch) => { setForm({ ...form, ...patch }); setMsg(""); };
  const setEx = (k, v) => set({ expedition: { ...ex, [k]: v } });
  const setRow = (rid, patch) => set({ resources: form.resources.map((r) => (r.row_id === rid ? { ...r, ...patch } : r)) });
  const toggle = (key, id) => set({ [key]: form[key].includes(id) ? form[key].filter((x) => x !== id) : form[key].concat([id]) });
  const resOf = (id) => catalog && catalog.resources.find((r) => r.resource_id === id);
  const nameOf = (list, id) => (list.find((x) => x.id === id) || {}).name || id;

  function validate() {
    const e = [];
    if (!ex.name.trim()) e.push("Expedition Name is required.");
    if (!ex.id.trim()) e.push("Expedition ID is required.");
    if (!ex.start_date) e.push("Start Date is required.");
    if (!ex.end_date) e.push("Expected End Date is required.");
    if (ex.start_date && ex.end_date && ex.end_date < ex.start_date) e.push("Expected End Date is before the Start Date.");
    let prev = "";
    timeline.forEach((t) => {
      const d = form.arrivals[t.waypoint_id];
      if (!d) return;
      if (ex.start_date && d < ex.start_date) e.push(t.label + ": arrival is before the expedition Start Date.");
      if (ex.end_date && d > ex.end_date) e.push(t.label + ": arrival is after the Expected End Date.");
      if (prev && d < prev) e.push(t.label + ": arrival is earlier than the previous stop.");
      prev = d;
    });
    form.resources.forEach((r, i) => {
      if (!r.resource_id || !(Number(r.quantity) > 0) || !r.source_station_id) e.push("Resource row " + (i + 1) + ": choose a resource, a quantity above 0 and a source station.");
    });
    return e;
  }

  async function save() {
    const e = validate();
    setErrors(e);
    if (e.length) { setMsg(""); return; }
    const plan = {
      plan_id: "plan-" + route.route_id, route_id: route.route_id, status: "SAVED_LOCAL", saved_at: new Date().toISOString(),
      expedition: { ...ex, name: ex.name.trim(), id: ex.id.trim(), duration_days: duration },
      route: { name: route.name, start: place(start), destination: dest ? place(dest) : null, stops },
      timeline: timeline.map((t) => ({ ...t, expected_arrival: form.arrivals[t.waypoint_id] || null })),
      resources: form.resources.map((r) => {
        const res = resOf(r.resource_id), st = stations.find((s) => s.id === r.source_station_id);
        return { resource_id: r.resource_id, name: res.name, quantity: Number(r.quantity), unit: res.unit, source_station_id: r.source_station_id, source_station: st ? st.name : r.source_station_id };
      }),
      personnel: form.personnel.map((id) => ({ id, name: nameOf(catalog.personnel, id) })),
      assets: form.assets.map((id) => ({ id, name: nameOf(catalog.assets, id) }))
    };
    try {
      await AppPlans.save(plan);
      setMsg("Plan saved locally (data/plans.json). It is not connected to the central database yet.");
    } catch (err) {
      setMsg("");
      setErrors(["Could not save the plan: " + err.message]);
    }
  }

  return (
    <div className="plan-page">
      <div className="plan-head">
        <h1>Expedition Planning</h1>
        <button type="button" className="btn btn-secondary plan-back" onClick={onBack}>Back to Map</button>
      </div>

      <div className="plan-route">
        <div><span>Route</span>{route.name}<small>{route.route_id}</small></div>
        <div><span>Start</span>{place(start)}</div>
        <div><span>Destination</span>{dest ? place(dest) : "not set"}</div>
        <div><span>Number of Stops</span>{stops}</div>
      </div>

      <section className="plan-section">
        <h2>1. Expedition Details</h2>
        <div className="plan-grid">
          <label>Expedition Name<input className="text-input" value={ex.name} onChange={(e) => setEx("name", e.target.value)} /></label>
          <label>Expedition ID<input className="text-input" value={ex.id} placeholder="e.g. EXP-2026-01" onChange={(e) => setEx("id", e.target.value)} /></label>
          <label>Start Date<input type="date" className="text-input" value={ex.start_date} onChange={(e) => setEx("start_date", e.target.value)} /></label>
          <label>Expected End Date<input type="date" className="text-input" value={ex.end_date} onChange={(e) => setEx("end_date", e.target.value)} /></label>
        </div>
        <p className="plan-duration">Duration: <b>{duration === null ? "\u2014" : duration + (duration === 1 ? " day" : " days")}</b> <small>(from the dates entered above)</small></p>
      </section>

      <section className="plan-section">
        <h2>2. Route / Stop Timeline</h2>
        <table className="plan-table">
          <thead><tr><th>Stop</th><th>Name / Label</th><th>Location (WGS84)</th><th>Expected Date of Arrival</th></tr></thead>
          <tbody>
            {timeline.map((t) => (
              <tr key={t.waypoint_id}>
                <td>{t.label}</td>
                <td>{t.name || <span className="plan-dim">unnamed</span>}</td>
                <td>{t.latitude.toFixed(5)}, {t.longitude.toFixed(5)}</td>
                <td><input type="date" className="text-input" value={form.arrivals[t.waypoint_id] || ""}
                  onChange={(e) => set({ arrivals: { ...form.arrivals, [t.waypoint_id]: e.target.value } })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="plan-note">Stops come from the route drawn on the map. To change them, go back to the map.</p>
      </section>

      <section className="plan-section">
        <h2>3. Resources</h2>
        <p className="plan-note">Resource options are temporary static placeholder data (no inventory database yet).</p>
        {form.resources.length > 0 && (
          <table className="plan-table">
            <thead><tr><th>Resource</th><th>Required Quantity</th><th>Unit</th><th>Source Station</th><th /></tr></thead>
            <tbody>
              {form.resources.map((r) => (
                <tr key={r.row_id}>
                  <td>
                    <select className="text-input" value={r.resource_id} onChange={(e) => setRow(r.row_id, { resource_id: e.target.value })}>
                      <option value="">Select…</option>
                      {catalog && catalog.resources.map((c) => <option key={c.resource_id} value={c.resource_id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td><input type="number" min="0" className="text-input" value={r.quantity} onChange={(e) => setRow(r.row_id, { quantity: e.target.value })} /></td>
                  <td>{resOf(r.resource_id) ? resOf(r.resource_id).unit : "\u2014"}</td>
                  <td>
                    <select className="text-input" value={r.source_station_id} onChange={(e) => setRow(r.row_id, { source_station_id: e.target.value })}>
                      <option value="">Select…</option>
                      {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td><button type="button" className="wp-del" title="Remove" onClick={() => set({ resources: form.resources.filter((x) => x.row_id !== r.row_id) })}>{"\u00d7"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="btn btn-secondary plan-add"
          onClick={() => set({ resources: form.resources.concat([{ row_id: "row-" + ++rowSeq, resource_id: "", quantity: "", source_station_id: "" }]) })}>Add Resource</button>
      </section>

      <section className="plan-section">
        <h2>4. Personnel / Assets</h2>
        <p className="plan-note">Placeholder options for now; full personnel and asset management comes later.</p>
        <div className="plan-two">
          <div>
            <div className="field-label">Personnel / Team</div>
            {catalog && catalog.personnel.map((p) => (
              <label key={p.id} className="plan-check"><input type="checkbox" checked={form.personnel.includes(p.id)} onChange={() => toggle("personnel", p.id)} />{p.name} <small>{p.id}</small></label>
            ))}
          </div>
          <div>
            <div className="field-label">Vehicle / Asset</div>
            {catalog && catalog.assets.map((a) => (
              <label key={a.id} className="plan-check"><input type="checkbox" checked={form.assets.includes(a.id)} onChange={() => toggle("assets", a.id)} />{a.name} <small>{a.id}</small></label>
            ))}
          </div>
        </div>
      </section>

      <section className="plan-section">
        <h2>5. Planning Summary</h2>
        <table className="plan-table plan-summary">
          <tbody>
            <tr><th>Expedition</th><td>{ex.name || "\u2014"}{ex.id && " (" + ex.id + ")"}</td></tr>
            <tr><th>Start Date</th><td>{fmtDate(ex.start_date)}</td></tr>
            <tr><th>End Date</th><td>{fmtDate(ex.end_date)}</td></tr>
            <tr><th>Duration</th><td>{duration === null ? "\u2014" : duration + " days"}</td></tr>
            <tr><th>Start</th><td>{place(start)}</td></tr>
            <tr><th>Stops</th><td>{timeline.filter((t) => t.type === "STOP").map((t) => t.label + (t.name ? " \u2013 " + t.name : "") + " (" + fmtDate(form.arrivals[t.waypoint_id]) + ")").join("; ") || "\u2014"}</td></tr>
            <tr><th>Destination</th><td>{dest ? place(dest) + " (" + fmtDate(form.arrivals[dest.waypoint_id]) + ")" : "not set"}</td></tr>
            <tr><th>Selected Resources</th><td>{form.resources.filter((r) => resOf(r.resource_id)).map((r) => resOf(r.resource_id).name + " " + (r.quantity || "?") + " " + resOf(r.resource_id).unit + " from " + ((stations.find((s) => s.id === r.source_station_id) || {}).name || "?")).join("; ") || "\u2014"}</td></tr>
            <tr><th>Personnel</th><td>{catalog && form.personnel.length ? form.personnel.map((id) => nameOf(catalog.personnel, id)).join(", ") : "\u2014"}</td></tr>
            <tr><th>Assets</th><td>{catalog && form.assets.length ? form.assets.map((id) => nameOf(catalog.assets, id)).join(", ") : "\u2014"}</td></tr>
          </tbody>
        </table>
        {errors.length > 0 && <ul className="plan-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {msg && <p className="plan-saved">{msg}</p>}
        <div className="plan-actions">
          <button type="button" className="btn" onClick={save}>Save Expedition Plan</button>
          <button type="button" className="btn btn-secondary" onClick={onBack}>Back to Map</button>
        </div>
      </section>
    </div>
  );
}

// Rebuild form state from a saved plan.
function fromSaved(plan) {
  return {
    expedition: { name: plan.expedition.name, id: plan.expedition.id, start_date: plan.expedition.start_date, end_date: plan.expedition.end_date },
    arrivals: Object.fromEntries(plan.timeline.filter((t) => t.expected_arrival).map((t) => [t.waypoint_id, t.expected_arrival])),
    resources: plan.resources.map((r) => ({ row_id: "row-" + ++rowSeq, resource_id: r.resource_id, quantity: String(r.quantity), source_station_id: r.source_station_id })),
    personnel: plan.personnel.map((p) => p.id),
    assets: plan.assets.map((a) => a.id)
  };
}
