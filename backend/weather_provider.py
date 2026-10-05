"""
Forecast provider (the ONLY file that knows about Open-Meteo).

Contract used by weather.py:   provider.fetch(points) -> {(lat, lon): series}
where `series` is a normalised dict of equal-length hourly lists:
    time (ISO, GMT), wind_speed_kmh, wind_direction_deg, wind_gust_kmh,
    temperature_c, precipitation_mm, snowfall_cm
To switch to ECMWF Open Data or another operational provider, write a class
with the same `name`, `model` and `fetch()` and assign it in weather.py.
"""
import json
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "https://api.open-meteo.com/v1/ecmwf"
MODEL = "ecmwf_ifs025"  # ECMWF IFS open-data, 0.25 deg grid
CHUNK = 40               # locations per HTTP request
TIMEOUT_S = 20

# provider variable -> normalised key
VARIABLES = {
    "wind_speed_10m": "wind_speed_kmh",
    "wind_direction_10m": "wind_direction_deg",
    "wind_gusts_10m": "wind_gust_kmh",
    "temperature_2m": "temperature_c",
    "precipitation": "precipitation_mm",
    "snowfall": "snowfall_cm",
}


class OpenMeteoECMWF:
    name = "Open-Meteo"
    model = "ECMWF IFS 0.25\u00b0"

    def _request(self, points, variables):
        params = {
            "latitude": ",".join(str(p[0]) for p in points),
            "longitude": ",".join(str(p[1]) for p in points),
            "hourly": ",".join(variables),
            "models": MODEL,
            "forecast_days": 4,
            "timezone": "GMT",
            "wind_speed_unit": "kmh",
        }
        url = BASE_URL + "?" + urllib.parse.urlencode(params, safe=",")
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as r:
            data = json.loads(r.read().decode("utf-8"))
        return data if isinstance(data, list) else [data]

    def fetch(self, points):
        out = {}
        for i in range(0, len(points), CHUNK):
            chunk = points[i:i + CHUNK]
            try:
                results = self._request(chunk, list(VARIABLES))
            except urllib.error.HTTPError as e:
                if e.code != 400:
                    raise
                # A variable may be unsupported for this model: retry without snowfall.
                core = [v for v in VARIABLES if v != "snowfall"]
                results = self._request(chunk, core)
            for pt, res in zip(chunk, results):
                hourly = res.get("hourly", {})
                series = {"time": hourly.get("time", [])}
                for src, dst in VARIABLES.items():
                    # With a single model the key is plain; be tolerant of a model suffix.
                    vals = hourly.get(src, hourly.get(src + "_" + MODEL))
                    series[dst] = vals if vals is not None else [None] * len(series["time"])
                out[pt] = series
        return out
