import { useEffect, useState } from "react";
import { AppData } from "../lib/api.js";

const COLOR = { FEASIBLE: "#1f7a45", "NOT FEASIBLE": "#a13a2b", "CANNOT DETERMINE": "#8a6d00", "INSUFFICIENT DATA": "#8a6d00", "AT RISK": "#b36b00" };
const Status = ({ v }) => <b style={{ color: COLOR[v] || "#a13a2b" }}>{v}</b>;
const dash = (v) => (v === null || v === undefined ? "\u2014" : v);

function Table({ title, cols, rows }) {
  return (
    <section className="plan-section">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="plan-note">None.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table className="plan-table">
            <thead><tr>{cols.map((c) => <th key={c[0]}>{c[0]}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>{cols.map((c) => <td key={c[0]}>{c[2] ? c[2](r) : dash(r[c[1]])}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function SimulationPage({ onBack }) {
  const [cargo, setCargo] = useState([]);
  const [cargoId, setCargoId] = useState("");
  const [days, setDays] = useState("3");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { AppData.loadSimCargo().then(setCargo).catch((e) => setError(e.message)); }, []);
  const body = () => ({ cargo_id: cargoId, delay_days: Number(days) });
  const valid = cargoId && Number.isInteger(Number(days)) && Number(days) >= 1;

  async function run() {
    setBusy(true); setError("");
    try { setResult(await AppData.runCargoDelay(body())); } catch (e) { setResult(null); setError(e.message); }
    setBusy(false);
  }
  const sel = cargo.find((c) => c.cargo_id === cargoId);

  return (
    <div className="plan-page">
      <div className="plan-head">
        <h1>Simulation</h1>
        <button type="button" className="btn btn-secondary plan-back" onClick={onBack}>Back to Map</button>
      </div>

      <section className="plan-section">
        <h2>Event: Cargo Delay</h2>
        <div className="plan-grid">
          <label>Cargo
            <select className="text-input" value={cargoId} onChange={(e) => setCargoId(e.target.value)}>
              <option value="">Select…</option>
              {cargo.map((c) => <option key={c.cargo_id} value={c.cargo_id}>{c.cargo_id} – {c.quantity} {c.unit} {c.item_name} → {c.destination}</option>)}
            </select>
          </label>
          <label>Delay (days)
            <input type="number" min="1" step="1" className="text-input" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
        </div>
        {sel && <p className="plan-note">Expected arrival {sel.expected_arrival} ({sel.status}). What-if only: real data is never modified.</p>}
        <div className="plan-actions">
          <button type="button" className="btn" disabled={!valid || busy} onClick={run}>{busy ? "Running…" : "Run Simulation"}</button>
          {result && <button type="button" className="btn btn-secondary" onClick={() => AppData.exportCargoDelay(body()).catch((e) => setError(e.message))}>Export to Excel</button>}
        </div>
        {error && <ul className="plan-errors"><li>{error}</li></ul>}
      </section>

      {result && (<>
        <section className="plan-section">
          <h2>Overall Result</h2>
          <table className="plan-table plan-summary"><tbody>
            <tr><th>Overall Result</th><td><Status v={result.overall_status} /></td></tr>
            <tr><th>Reason</th><td>{result.overall_reason}</td></tr>
            <tr><th>Recommended Action</th><td><b>{result.recommended_action}</b></td></tr>
            <tr><th>Cargo</th><td>{result.scenario.cargo_id}: {result.scenario.quantity} {result.scenario.unit} {result.scenario.item} to {result.scenario.destination}; {result.scenario.original_arrival} → {result.scenario.delayed_arrival} (+{result.scenario.delay_days} d)</td></tr>
          </tbody></table>
          {result.notes.map((n) => <p key={n} className="plan-note">{n}</p>)}
        </section>
        <Table title="Resource Impact" rows={result.resource_impacts} cols={[
          ["Resource", "resource"], ["Location", "location"], ["Original Arrival", "original_arrival"], ["Delayed Arrival", "delayed_arrival"],
          ["Rate/day", "consumption_rate"], ["First Risk", "first_risk_date"], ["Minimum", "minimum_projected"], ["Required", "required_level"],
          ["Deficit", "deficit"], ["Days Affected", "days_affected"], ["Status", "status", (r) => <Status v={r.status} />], ["Reason", "reason"]]} />
        <Table title="Expedition Impact" rows={result.expedition_impacts} cols={[
          ["Expedition", "expedition", (r) => r.expedition + " (" + r.expedition_id + ")"], ["Resource", "resource"],
          ["Status", "status", (r) => <Status v={r.status} />], ["Reason", "reason"], ["Recommended", "recommended_action"]]} />
        <Table title="Alternatives" rows={result.alternatives} cols={[
          ["Source", "source"], ["Resource", "resource"], ["Available", "available"], ["Required", "required"],
          ["Feasible", "feasible", (r) => <Status v={r.feasible} />], ["Reason", "reason"]]} />
        <Table title="Simulation Timeline" rows={result.timeline} cols={[
          ["Date", "date"], ["Resource", "resource"], ["Location", "location"], ["Opening", "opening"], ["Consumed", "consumed"], ["Incoming", "incoming"],
          ["Exp. Draw", "expedition_draw"], ["Available", "available"], ["Required", "required"], ["Status", "status"]]} />
      </>)}
    </div>
  );
}
