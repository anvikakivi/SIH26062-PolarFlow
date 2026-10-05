"""
Deterministic Cargo Delay simulation engine (no randomness, no ML).

  load_state()          real DB (read-only) -> plain dicts
  run_cargo_delay()     deep copy = temporary state -> delay applied only there
  project()             Resource Projection: daily opening/consumed/incoming/available/required
  evaluate_*/alternatives()   Impact Evaluation
  result dict           Result Builder (same dict feeds the API, React and Excel)
"""
import copy
import json
import os
from datetime import date, datetime, timedelta

from .. import db

MAX_HORIZON_DAYS = 366
# worst -> best, used for the overall result
SEVERITY = ["CANNOT PROCEED AS PLANNED", "RESOURCE INSUFFICIENT", "DELAY REQUIRED",
            "ALTERNATIVE RESOURCE REQUIRED", "AT RISK", "INSUFFICIENT DATA", "FEASIBLE"]


class SimulationError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _d(v):
    return v if isinstance(v, date) and not isinstance(v, datetime) else date.fromisoformat(str(v)[:10])


def _n(x):
    return round(float(x), 2)


# ---------------------------------------------------------------- state ----
def load_state(conn, as_of):
    have = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    missing = {"cargo", "stock_reserves", "expedition_requirements"} - have
    if missing:
        raise SimulationError("Simulation tables missing (%s). Run: python -m backend.simulation.demo_seed" % ", ".join(sorted(missing)), 500)
    locs = {r["location_id"]: r["name"] for r in conn.execute("SELECT location_id, name FROM locations")}
    stocks = {r["stock_id"]: dict(r) for r in conn.execute("SELECT * FROM consumable_stock")}
    reserves = {r["stock_id"]: r["min_reserve"] for r in conn.execute("SELECT * FROM stock_reserves")}
    logs = {}
    for r in conn.execute("SELECT stock_id, quantity_used, timestamp FROM consumption_logs"):
        d = _d(r["timestamp"])
        if d <= as_of:
            logs.setdefault(r["stock_id"], []).append((d, r["quantity_used"]))
    cargo = {}
    for r in conn.execute("SELECT * FROM cargo"):
        c = dict(r)
        c["arrival"] = _d(c["expected_arrival"])
        cargo[c["cargo_id"]] = c
    exps = []
    for r in conn.execute("SELECT * FROM expedition_requirements"):
        exps.append({"expedition_id": r["expedition_id"], "name": r["expedition_name"] or r["expedition_id"],
                     "start": _d(r["start_date"]), "end": _d(r["end_date"]), "location_id": r["location_id"],
                     "item_name": r["item_name"], "qty": r["quantity_required"], "source": "db"})
    exps += _plan_requirements({(e["expedition_id"], e["location_id"], e["item_name"]) for e in exps})
    return {"as_of": as_of, "locs": locs, "stocks": stocks, "reserves": reserves, "logs": logs, "cargo": cargo, "expeditions": exps}


def _plan_requirements(known):
    """Existing expedition plans (data/plans.json): resource name/quantity/source station + plan dates."""
    path = os.path.join(db.DATA_DIR, "plans.json")
    out = []
    if not os.path.exists(path):
        return out
    try:
        plans = json.load(open(path))
    except ValueError:
        return out
    for p in plans:
        ex = p.get("expedition", {})
        if not (ex.get("start_date") and ex.get("end_date")):
            continue
        for r in p.get("resources", []):
            key = (ex.get("id"), r.get("source_station_id"), r.get("name"))
            if key in known or not r.get("quantity"):
                continue
            out.append({"expedition_id": ex.get("id"), "name": ex.get("name") or ex.get("id"), "start": _d(ex["start_date"]),
                        "end": _d(ex["end_date"]), "location_id": r["source_station_id"], "item_name": r["name"],
                        "qty": float(r["quantity"]), "source": "plans.json"})
    return out


# ----------------------------------------------------------- projection ----
def consumption_rate(logs, as_of):
    """units/day = total logged use / days from first to last log (inclusive). None if < 2 log days."""
    days = sorted({d for d, _ in logs})
    if len(days) < 2:
        return None
    return sum(q for _, q in logs) / ((days[-1] - days[0]).days + 1)


def _exps_for(sim, st):
    return [e for e in sim["expeditions"] if e["location_id"] == st["location_id"] and e["item_name"] == st["item_name"]]


def horizon_end(sim, sid):
    st = sim["stocks"][sid]
    ends = [sim["as_of"]] + [e["end"] for e in _exps_for(sim, st)]
    ends += [c["arrival"] for c in sim["cargo"].values() if c["destination_location_id"] == st["location_id"] and c["item_name"] == st["item_name"]]
    return min(max(ends), sim["as_of"] + timedelta(days=MAX_HORIZON_DAYS))


def project(sim, sid, end, outflows=None):
    """Daily projection. Level may go negative = unmet demand (kept so deficits can be measured)."""
    st = sim["stocks"][sid]
    rate = consumption_rate(sim["logs"].get(sid, []), sim["as_of"])
    if rate is None:
        return None
    reserve = sim["reserves"].get(sid)
    exps = _exps_for(sim, st)
    incoming = {}
    for c in sim["cargo"].values():
        if c["destination_location_id"] == st["location_id"] and c["item_name"] == st["item_name"] and c["status"] != "ARRIVED" and c["arrival"] >= sim["as_of"]:
            incoming[c["arrival"]] = incoming.get(c["arrival"], 0) + c["quantity"]
    rows, level, d = [], float(st["quantity_on_hand"]), sim["as_of"]
    while d <= end:
        inc = incoming.get(d, 0)
        avail = level - rate + inc
        req = (reserve or 0) + sum(e["qty"] for e in exps if e["start"] >= d)
        draw = sum(e["qty"] for e in exps if e["start"] == d) + (outflows or {}).get(d, 0)
        rows.append({"date": d, "opening": level, "consumed": rate, "incoming": inc, "draw": draw,
                     "available": avail, "required": req,
                     "status": "DEPLETED" if avail < 0 else "BELOW REQUIRED" if avail < req else "OK"})
        level = avail - draw
        d += timedelta(days=1)
    return rows


# ------------------------------------------------------- evaluation -------
def _alternatives(sim, sid, exp, need_date, deficit, end):
    st = sim["stocks"][sid]
    out = []
    for oid, o in sorted(sim["stocks"].items()):
        if oid == sid or o["item_name"] != st["item_name"]:
            continue
        base = {"source_stock_id": oid, "source_location_id": o["location_id"], "source": sim["locs"].get(o["location_id"], o["location_id"]),
                "resource": o["item_name"], "unit": o["unit_of_measure"], "expedition_id": exp["expedition_id"],
                "required": _n(deficit), "available": None}
        rows = project(sim, oid, end, {need_date: deficit})
        if rows is None:
            out.append({**base, "feasible": "CANNOT DETERMINE", "reason": "No usable consumption history at %s, so its future level cannot be projected." % base["source"]})
            continue
        if sim["reserves"].get(oid) is None:
            out.append({**base, "feasible": "CANNOT DETERMINE", "reason": "No required reserve defined at %s, so viability after a transfer cannot be judged." % base["source"]})
            continue
        r0 = next(r for r in rows if r["date"] == need_date)
        surplus = r0["available"] - r0["required"]
        base["available"] = _n(max(surplus, 0))
        bad = next((r for r in rows if r["date"] >= need_date and r["status"] != "OK"), None)
        if surplus < deficit:
            out.append({**base, "feasible": "NOT FEASIBLE", "reason": "%s projects %s %s on %s with %s required (reserve incl.); only %s %s is spare, %s %s needed." % (
                base["source"], _n(r0["available"]), base["unit"], need_date, _n(r0["required"]), base["available"], base["unit"], _n(deficit), base["unit"])})
        elif bad:
            out.append({**base, "feasible": "NOT FEASIBLE", "reason": "Transferring %s %s leaves %s below its required level from %s." % (_n(deficit), base["unit"], base["source"], bad["date"])})
        else:
            out.append({**base, "feasible": "FEASIBLE", "reason": "%s keeps its required level after transferring %s %s (spare %s %s on %s). Quantity only: distance, transport and timing are not evaluated (no data)." % (
                base["source"], _n(deficit), base["unit"], base["available"], base["unit"], need_date)})
    return out


def _evaluate_expedition(sim, sid, e, rows, end, cargo, orig, delayed):
    st = sim["stocks"][sid]
    loc, item, unit = sim["locs"].get(st["location_id"], st["location_id"]), st["item_name"], st["unit_of_measure"]
    by_date = {r["date"]: r for r in rows}
    res = {"expedition_id": e["expedition_id"], "expedition": e["name"], "resource": item, "location": loc,
           "start_date": e["start"], "end_date": e["end"], "required_quantity": _n(e["qty"])}
    alts, today = [], sim["as_of"]
    if e["end"] < today:
        return {**res, "status": "FEASIBLE", "reason": "Expedition ended before the simulation date.", "recommended_action": "Continue as planned"}, alts
    sd = e["start"] if e["start"] >= today else None
    short = 0
    if sd:
        r = by_date[sd]
        short = max(0, r["required"] - r["available"])
    if sd and short > 0:
        rec = next((x for x in rows if x["date"] >= sd and
                    x["available"] + (e["qty"] if x["date"] > sd else 0) >=
                    (sim["reserves"].get(sid) or 0) + sum(o["qty"] for o in _exps_for(sim, st) if o is e or o["start"] >= x["date"])), None)
        alts = _alternatives(sim, sid, e, sd, short, end)
        head = "%s at %s falls %s %s short of the required level on %s (projected %s, required %s)." % (
            item, loc, _n(short), unit, sd, _n(by_date[sd]["available"]), _n(by_date[sd]["required"]))
        head += " Cargo %s arrives %s instead of %s." % (cargo["cargo_id"], delayed, orig)
        if rec:
            status = "DELAY REQUIRED" if rec["date"] <= e["end"] else "CANNOT PROCEED AS PLANNED"
            reason = head + " Level is sufficient again on %s%s." % (rec["date"], "" if status == "DELAY REQUIRED" else ", after the planned end date " + str(e["end"]) + ", so the expedition cannot proceed as planned")
        else:
            status, reason = "RESOURCE INSUFFICIENT", head + " Level does not recover within the projection horizon."
        feas = [a for a in alts if a["feasible"] == "FEASIBLE"]
        if feas:
            status = "ALTERNATIVE RESOURCE REQUIRED"
            reason += " Transfer from %s is feasible." % feas[0]["source"]
            action = "Request transfer from " + feas[0]["source"]
        elif status == "DELAY REQUIRED":
            action = "Delay expedition to " + str(rec["date"])
        elif any(a["feasible"] == "CANNOT DETERMINE" for a in alts) or not alts:
            action = "Cannot determine mitigation"
        else:
            action = "Arrange alternative resupply"
        return {**res, "status": status, "reason": reason, "recommended_action": action}, alts
    start_after = e["start"] if sd else today - timedelta(days=1)
    bad = [r for r in rows if start_after < r["date"] <= e["end"] and r["status"] != "OK"]
    if bad:
        b = bad[0]
        reason = "%s at %s drops below its required level on %s (projected %s, required %s) during the expedition; cargo %s arrives %s." % (
            item, loc, b["date"], _n(b["available"]), _n(b["required"]), cargo["cargo_id"], delayed)
        alts = _alternatives(sim, sid, e, b["date"], b["required"] - b["available"], end)
        feas = [a for a in alts if a["feasible"] == "FEASIBLE"]
        action = "Request transfer from " + feas[0]["source"] if feas else \
            "Cannot determine mitigation" if (not alts or any(a["feasible"] == "CANNOT DETERMINE" for a in alts)) else "Arrange alternative resupply"
        return {**res, "status": "AT RISK", "reason": reason, "recommended_action": action}, alts
    return {**res, "status": "FEASIBLE", "reason": "%s at %s stays at or above the required level for the whole expedition window with cargo %s arriving %s." % (item, loc, cargo["cargo_id"], delayed),
            "recommended_action": "Continue as planned"}, alts


# --------------------------------------------------------------- run -------
def run_cargo_delay(conn, cargo_id, delay_days, as_of=None):
    as_of = as_of or date.today()
    if not isinstance(delay_days, int) or delay_days < 1:
        raise SimulationError("delay_days must be a whole number >= 1")
    if not isinstance(cargo_id, str) or not cargo_id.strip():
        raise SimulationError("cargo_id is required")
    cargo_id = cargo_id.strip()
    base = load_state(conn, as_of)
    cargo = base["cargo"].get(cargo_id)
    if not cargo:
        raise SimulationError("Cargo %s not found" % cargo_id, 404)
    if cargo["status"] == "ARRIVED":
        raise SimulationError("Cargo %s has already arrived" % cargo_id)
    sim = copy.deepcopy(base)                       # temporary simulation state
    orig = cargo["arrival"]
    delayed = orig + timedelta(days=delay_days)
    sim["cargo"][cargo_id]["arrival"] = delayed     # the only change; the DB is never written
    cargo = sim["cargo"][cargo_id]

    res_imp, exp_imp, alts, timeline, notes = [], [], [], [], []
    stock_ids = sorted(s for s, v in sim["stocks"].items() if v["location_id"] == cargo["destination_location_id"] and v["item_name"] == cargo["item_name"])
    loc_name = sim["locs"].get(cargo["destination_location_id"], cargo["destination_location_id"])
    if not stock_ids:
        notes.append("No consumable_stock row for %s at %s: nothing to project." % (cargo["item_name"], loc_name))
    for sid in stock_ids:
        st = sim["stocks"][sid]
        unit = st["unit_of_measure"]
        end = horizon_end(sim, sid)
        d_rows, b_rows = project(sim, sid, end), project(base, sid, end)
        common = {"resource": st["item_name"], "location": loc_name, "unit": unit, "original_arrival": orig, "delayed_arrival": delayed}
        if d_rows is None:
            res_imp.append({**common, "consumption_rate": None, "first_risk_date": None, "minimum_projected": None, "required_level": None,
                            "deficit": None, "days_affected": None, "status": "INSUFFICIENT DATA",
                            "reason": "Fewer than 2 consumption log days for %s at %s; no consumption rate can be derived." % (st["item_name"], loc_name)})
            for e in _exps_for(sim, st):
                exp_imp.append({"expedition_id": e["expedition_id"], "expedition": e["name"], "resource": st["item_name"], "location": loc_name,
                                "start_date": e["start"], "end_date": e["end"], "required_quantity": _n(e["qty"]), "status": "INSUFFICIENT DATA",
                                "reason": "No consumption rate for %s at %s." % (st["item_name"], loc_name), "recommended_action": "Cannot determine mitigation"})
            continue
        base_ok = {r["date"] for r in b_rows if r["status"] == "OK"}
        hit = [r for r in d_rows if r["status"] != "OK" and r["date"] in base_ok]
        for r in d_rows:
            timeline.append({"date": r["date"], "resource": st["item_name"], "location": loc_name, "opening": _n(r["opening"]), "consumed": _n(r["consumed"]),
                             "incoming": _n(r["incoming"]), "expedition_draw": _n(r["draw"]), "available": _n(r["available"]), "required": _n(r["required"]), "status": r["status"]})
        if hit:
            worst = max(hit, key=lambda r: r["required"] - r["available"])
            lo = min(hit, key=lambda r: r["available"])
            res_imp.append({**common, "consumption_rate": _n(d_rows[0]["consumed"]), "first_risk_date": hit[0]["date"], "minimum_projected": _n(lo["available"]),
                            "required_level": _n(worst["required"]), "deficit": _n(worst["required"] - worst["available"]), "days_affected": len(hit), "status": "AT RISK",
                            "reason": "%s at %s falls below the required level (%s) on %s (projected %s %s). Cargo %s arrives %s instead of %s, so the level stays below required for %d day(s) that were fine without the delay." % (
                                st["item_name"], loc_name, _n(hit[0]["required"]), hit[0]["date"], _n(hit[0]["available"]), unit, cargo_id, delayed, orig, len(hit))})
        for e in _exps_for(sim, st):
            ei, ea = _evaluate_expedition(sim, sid, e, d_rows, end, cargo, orig, delayed)
            bi, _ = _evaluate_expedition(base, sid, e, b_rows, end, base["cargo"][cargo_id], orig, orig)
            ei["baseline_status"] = bi["status"]
            ei["caused_by_delay"] = not (ei["status"] == bi["status"] and ei["status"] != "FEASIBLE")
            if not ei["caused_by_delay"]:
                ei["reason"] += " This outcome is the same without the delay (baseline: %s), so it is not caused by the delay." % bi["status"]
            exp_imp.append(ei)
            if ei["caused_by_delay"]:
                alts += ea
    # an expedition-level shortage makes the resource row's status the worst linked expedition status
    for ri in res_imp:
        linked = [e["status"] for e in exp_imp if e["resource"] == ri["resource"] and e["location"] == ri["location"]]
        worst = min(linked, key=SEVERITY.index) if linked else None
        if worst and ri["status"] == "AT RISK" and SEVERITY.index(worst) < SEVERITY.index("AT RISK"):
            ri["status"] = worst
    return _build_result(sim, cargo, orig, delayed, delay_days, res_imp, exp_imp, alts, timeline, notes)


def _build_result(sim, cargo, orig, delayed, delay_days, res_imp, exp_imp, alts, timeline, notes):
    caused = [e for e in exp_imp if e.get("caused_by_delay", True)]
    statuses = [e["status"] for e in caused]
    if statuses:
        overall = min(statuses, key=SEVERITY.index)
    elif exp_imp:
        overall = "FEASIBLE"  # every expedition outcome is identical with and without the delay
    elif any(r["status"] == "INSUFFICIENT DATA" for r in res_imp):
        overall = "INSUFFICIENT DATA"
    elif res_imp:
        overall = "AT RISK"
    else:
        overall = "FEASIBLE"
    worst = next((e for e in caused if e["status"] == overall), None)
    if worst:
        action = worst["recommended_action"]
        reason = "%s (%s): %s" % (worst["expedition"], worst["status"], worst["reason"])
    elif exp_imp and not caused:
        action = "Continue as planned"
        reason = "The delay of cargo %s adds no impact: expedition outcomes are the same without it." % cargo["cargo_id"]
    elif res_imp:
        action = "Cannot determine mitigation" if overall == "INSUFFICIENT DATA" else "Arrange alternative resupply"
        reason = res_imp[0]["reason"]
    else:
        action = "Continue as planned"
        reason = "Delaying cargo %s by %d day(s) causes no projected shortage." % (cargo["cargo_id"], delay_days)
    loc = sim["locs"].get(cargo["destination_location_id"], cargo["destination_location_id"])
    return {
        "scenario": {"event": "CARGO_DELAY", "cargo_id": cargo["cargo_id"], "item": cargo["item_name"], "quantity": cargo["quantity"], "unit": cargo["unit_of_measure"],
                     "destination": loc, "original_arrival": orig, "delayed_arrival": delayed, "delay_days": delay_days, "simulation_date": sim["as_of"]},
        "overall_status": overall, "overall_reason": reason, "recommended_action": action,
        "resource_impacts": res_imp, "expedition_impacts": exp_imp, "alternatives": alts, "timeline": timeline,
        "notes": notes + ["Real database unchanged: the delay exists only in the temporary simulation state."],
    }


def list_cargo(conn):
    locs = {r["location_id"]: r["name"] for r in conn.execute("SELECT location_id, name FROM locations")}
    return [{"cargo_id": r["cargo_id"], "item_name": r["item_name"], "quantity": r["quantity"], "unit": r["unit_of_measure"],
             "destination": locs.get(r["destination_location_id"], r["destination_location_id"]), "expected_arrival": r["expected_arrival"], "status": r["status"]}
            for r in conn.execute("SELECT * FROM cargo WHERE status != 'ARRIVED' ORDER BY expected_arrival")]
