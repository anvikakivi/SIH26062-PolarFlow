# Antarctic Operational Planning Map (React app)

React -> FastAPI -> data files, shown in a native desktop window (pywebview).

    frontend/   React UI (Vite). Map = React-Leaflet + Leaflet + Proj4 + Proj4Leaflet, EPSG:3031
      src/lib/        framework-free logic: projection, routes, waypoints, telemetry, simulator,
                      mapLayers (Leaflet layers/grid/controls), api (calls the backend)
      src/components/ React panel + map components
    backend/app.py   FastAPI: /api/stations, /api/waypoints, /api/land, /api/telemetry
    data/            unchanged: antarctica_land.geojson (SCAR ADD), stations.json, waypoints.json,
                     telemetry_log.csv (created on first telemetry update)
    main.py          starts the backend on 127.0.0.1 and opens the app window

## Run
    pip install -r requirements.txt
    python main.py                      # uses the prebuilt frontend/dist

## Rebuild the UI after changing frontend code
    cd frontend && npm install && npm run build

## Develop in a browser (hot reload)
    uvicorn backend.app:app --port 8000
    cd frontend && npm run dev          # http://localhost:5173

## Weather layer
Toggle "Weather layer" in the panel. Flow: Open-Meteo (ECMWF IFS 0.25 deg) -> `backend/weather_provider.py`
-> `backend/weather.py` (cache, thresholds) -> `GET /api/weather` -> React overlay.
- Swap provider: implement the same `fetch()` as `OpenMeteoECMWF` and assign `provider` in `backend/weather.py`.
- Thresholds: `data/weather_config.json` (operational ASSUMPTIONS, not official limits; edit freely).
- Simulation input: `AppWeather.getEnvironmentalInputs(route)` in `frontend/src/lib/weather.js`.
