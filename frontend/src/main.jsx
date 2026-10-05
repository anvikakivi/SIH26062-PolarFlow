import React from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App.jsx";

// No <StrictMode>: the Leaflet map and store subscriptions are created once.
createRoot(document.getElementById("root")).render(<App />);
