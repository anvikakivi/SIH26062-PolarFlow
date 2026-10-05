import { useEffect } from "react";
import { MapContainer, useMap } from "react-leaflet";
import { AppCRS } from "../lib/projection.js";
import { AppMap } from "../lib/mapLayers.js";

// Runs the existing map logic (controls, grid, land layer, region fitting)
// against the map instance React-Leaflet created.
function MapBridge({ onReady }) {
  const map = useMap();
  useEffect(() => {
    let cancelled = false;
    AppMap.attach(map);
    AppMap.addGraticule();
    AppMap.loadLandLayer().then(() => !cancelled && onReady(map));
    return () => { cancelled = true; };
  }, [map]);
  return null;
}

export default function MapView({ onReady }) {
  return (
    <MapContainer
      id="map"
      crs={AppCRS.antarctic}
      center={[-90, 0]}
      zoom={0}
      maxZoom={15}
      zoomSnap={0.25}
      worldCopyJump={false}
      attributionControl={false}
    >
      <MapBridge onReady={onReady} />
    </MapContainer>
  );
}
