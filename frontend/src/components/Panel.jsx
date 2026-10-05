import { useState } from "react";
import { AppLocations } from "../lib/waypoints.js";

/* Small building blocks shared by every panel view (and future modules). */

export function InfoRow({ label, children }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{children}</span>
    </div>
  );
}

export function ColorPicker({ value, onChange }) {
  return (
    <div className="color-picker">
      {Object.keys(AppLocations.COLORS).map((key) => (
        <button
          key={key}
          type="button"
          title={key.charAt(0).toUpperCase() + key.slice(1)}
          className={"swatch" + (key === value ? " selected" : "")}
          style={{ background: AppLocations.COLORS[key] }}
          onClick={() => onChange(key)}
        />
      ))}
    </div>
  );
}

// [name], latitude, longitude, submit, inline error.
// onSubmit(lat, lon, name) returns an error string, or null on success.
export function CoordForm({ title, lat = "", lon = "", submitText, onSubmit, nameOpts, children }) {
  const [la, setLa] = useState(lat);
  const [lo, setLo] = useState(lon);
  const [nm, setNm] = useState(nameOpts ? nameOpts.name : "");
  const [err, setErr] = useState("");
  const submit = () => setErr(onSubmit(la, lo, nm) || "");
  const enter = (e) => { if (e.key === "Enter") submit(); };
  return (
    <div className="coord-form">
      <div className="field-label">{title}</div>
      {nameOpts && (
        <input type="text" className="text-input" value={nm} placeholder={nameOpts.placeholder}
          onChange={(e) => setNm(e.target.value)} />
      )}
      <div className="coord-inputs">
        <input type="text" className="text-input" value={la} placeholder="Latitude -70.74992"
          title="Latitude (WGS84, decimal degrees)" onChange={(e) => setLa(e.target.value)} onKeyDown={enter} />
        <input type="text" className="text-input" value={lo} placeholder="Longitude 14.22372"
          title="Longitude (WGS84, decimal degrees)" onChange={(e) => setLo(e.target.value)} onKeyDown={enter} />
      </div>
      <div className="form-error">{err}</div>
      <button type="button" className="btn" onClick={submit}>{submitText}</button>
      {children}
    </div>
  );
}

export function Confirm({ text, confirmLabel, onConfirm, onCancel }) {
  return (
    <>
      <h3>Confirm</h3>
      <p className="panel-hint confirm-text">{text}</p>
      <div className="confirm-row">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </>
  );
}

/* ---- Location views (click on map / click on marker) ---- */

export function Hint() {
  return <p className="panel-hint">Click the map to select a location, or click an existing marker.</p>;
}

export function ClickedLocation({ lat, lon, onCreate, children }) {
  return (
    <>
      <h3>Selected Location</h3>
      <InfoRow label="Latitude">{lat.toFixed(6)}</InfoRow>
      <InfoRow label="Longitude">{lon.toFixed(6)}</InfoRow>
      {children}
      <button type="button" className="btn" onClick={onCreate}>Create Waypoint</button>
    </>
  );
}

export function CreateForm({ lat, lon, onCreate }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("orange");
  const go = () => onCreate(lat, lon, name, color);
  return (
    <>
      <h3>Create Waypoint</h3>
      <InfoRow label="Latitude">{lat.toFixed(6)}</InfoRow>
      <InfoRow label="Longitude">{lon.toFixed(6)}</InfoRow>
      <label className="field-label">Waypoint Name</label>
      <input type="text" className="text-input" autoFocus placeholder="e.g. Camp Alpha" value={name}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <label className="field-label">Color</label>
      <ColorPicker value={color} onChange={setColor} />
      <button type="button" className="btn" onClick={go}>Confirm</button>
    </>
  );
}

export function LocationInfo({ loc, onEdit, onDelete }) {
  return (
    <>
      <h3>{loc.type === "station" ? "Station" : "Waypoint"}</h3>
      {loc.type === "station" && <span className="badge">OFFICIAL / PROTECTED</span>}
      <InfoRow label="Name">{loc.name}</InfoRow>
      {loc.type === "waypoint" && (
        <InfoRow label="Color">
          <span className="swatch selected" style={{ background: AppLocations.colorHex(loc.color) }} />
        </InfoRow>
      )}
      <InfoRow label="Latitude">{loc.latitude.toFixed(6)}</InfoRow>
      <InfoRow label="Longitude">{loc.longitude.toFixed(6)}</InfoRow>
      {loc.editable && (
        <>
          <button type="button" className="btn" onClick={onEdit}>Edit Waypoint</button>
          <button type="button" className="btn btn-danger" onClick={() => onDelete(loc.id)}>Delete Waypoint</button>
        </>
      )}
    </>
  );
}

export function EditForm({ loc, onRename }) {
  const [name, setName] = useState(loc.name);
  const [color, setColor] = useState(loc.color || "orange");
  const go = () => onRename(loc.id, name, color);
  return (
    <>
      <h3>Edit Waypoint</h3>
      <input type="text" className="text-input" autoFocus value={name}
        onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()} />
      <label className="field-label">Color</label>
      <ColorPicker value={color} onChange={setColor} />
      <button type="button" className="btn" onClick={go}>Confirm</button>
    </>
  );
}
