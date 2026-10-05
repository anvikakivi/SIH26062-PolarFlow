import { useEffect, useState } from "react";

// Minimal view navigation (no router library needed): #/plan/<routeId> = planning page,
// anything else = the map. Browser/webview back works through the hashchange event.
const parse = () => {
  if (window.location.hash === "#/simulation") return { page: "simulation" };
  const m = /^#\/plan\/(.+)$/.exec(window.location.hash);
  return m ? { page: "plan", routeId: decodeURIComponent(m[1]) } : { page: "map" };
};

export function useHashRoute() {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const f = () => setR(parse());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return r;
}

export const goPlanning = (routeId) => { window.location.hash = "#/plan/" + encodeURIComponent(routeId); };
export const goMap = () => { window.location.hash = "#/"; };
export const goSimulation = () => { window.location.hash = "#/simulation"; };
