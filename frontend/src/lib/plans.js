/*
 * plans.js - expedition plans (one per route). Saved locally through the FastAPI
 * file store (data/plans.json); NOT connected to the final database yet.
 */
import { AppData } from "./api.js";

let plans = [];          // saved plans
const drafts = {};       // unsaved form state per route (survives "Back to Map")

export const AppPlans = {
  load: (list) => { plans = Array.isArray(list) ? list : []; },
  getSaved: (routeId) => plans.find((p) => p.route_id === routeId) || null,
  getDraft: (routeId) => drafts[routeId] || null,
  setDraft: (routeId, state) => { drafts[routeId] = state; },
  save: async (plan) => {
    const next = plans.filter((p) => p.route_id !== plan.route_id).concat([plan]);
    await AppData.savePlans(next);
    plans = next;
    delete drafts[plan.route_id];
  },
  // Drop plans whose route no longer exists.
  prune: (routeIds) => {
    const keep = plans.filter((p) => routeIds.includes(p.route_id));
    if (keep.length === plans.length) return;
    plans = keep;
    AppData.savePlans(keep).catch((e) => console.warn("Plan save failed:", e));
  }
};
