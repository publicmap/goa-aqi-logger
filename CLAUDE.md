# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scrapes live AQI sensor data from `backend.aqionline.in` (the API behind https://www.aqionline.in/dashboard) for a network of Goa air quality monitors, and archives it as GeoJSON (latest snapshot) + CSV (full time series). A GitHub Actions workflow runs the logger hourly. `index.html` is a static MapLibre + Chart.js dashboard served via GitHub Pages that reads the generated `output/` files directly.

## Key Scripts

```bash
npm test    # src/test-connectivity.js — checks the devices endpoint is reachable
npm start   # src/fetch-aqi.js — fetch + write output/geojson and output/csv
AQI_INTERVAL=28d npm start   # seed longer history (backend accepts interval strings like 1h, 24h, 28d)
```

## Architecture

### Data pipeline (`src/fetch-aqi.js`)

1. `fetchAllDevices()` pages through `GET /api/devices?page=N&limit=50` (50 is the API's max page size — a higher limit 400s)
2. Each device's `realtime` array (one entry per sensor field) is flattened into GeoJSON point properties and written to `output/geojson/aqi-latest.geojson` (overwritten every run — always "latest reading only")
3. For each device, `GET /api/users/devices/getdata?device_id=X&interval=1h` returns ~10-minute-resolution readings for the last hour. Rows newer than `output/state/last-timestamps.json[device_id]` are appended to `output/csv/aqi-<IST-YYYYMMDD>.csv` — this is how dedup across hourly runs works; a missed run is still safe because `interval=1h` overlaps the previous run's window.
4. `output/manifest.json` lists devices + all CSV filenames so the static dashboard doesn't need directory listing (GitHub Pages can't do that).

### Dashboard (`index.html`)

- MapLibre GL (OpenFreeMap `liberty` style, no API key needed) renders `output/geojson/aqi-latest.geojson`, circles colored by the standard EPA AQI breakpoints (0/51/101/151/201/301).
- Clicking a point opens a side panel: current readings grid, then one small Chart.js line chart per sensor field (small multiples, not overlaid — the fields have very different scales, e.g. CO2 in ppm vs PM2.5 in µg/m³, so a single shared axis would be misleading).
- History is loaded once per panel-open by reading `output/manifest.json` for the list of daily CSV files, fetching up to `MAX_RANGE_DAYS` (30, +1 buffer day) of them, and filtering client-side by `device_id`. There's no CSV library dependency — the parser is a plain `split(',')` because none of the fields in this dataset ever contain a comma.
- A 1D/1W/1M range selector (`RANGE_OPTIONS`) re-filters that already-fetched superset in memory (`filterRowsByRange`) rather than refetching, so switching ranges is instant. The CSV download button always exports whatever range is currently selected.
- Each chart draws a translucent min/max reference band and a dashed "current live reading" line via a hand-rolled Chart.js plugin (`minMaxBandPlugin`) — no annotation-plugin dependency was added, consistent with the no-CSV-library approach above.
- Hovering or clicking a chart shows a synced crosshair (`crosshairPlugin`) at the same timestamp across every field's chart for that device, and swaps the reading-tiles grid to that timestamp's values (`renderReadingsGrid`/`applyInspect`) so all params at one moment can be compared directly. Clicking pins the inspection until dismissed (via the "back to live" control) or another point is clicked — the primary interaction on touch devices, where there's no hover.

### Git / hosting

- Single branch (`main`) — no separate data branch. The hourly workflow commits directly to `output/` on `main` with `[skip ci]`.
- GitHub Pages should be enabled serving from `main` / `(root)` so `index.html` can `fetch()` `output/...` with relative paths.

## API Details

**Devices list**: `GET https://backend.aqionline.in/api/devices?page=1&limit=50` → `{ data: [{ device_id, latitude, longitude, sensors, factors, isPublic, online, realtime: [{ _time, _value, _field, unit }] }] }`

**Per-device timeseries**: `GET https://backend.aqionline.in/api/users/devices/getdata?device_id=<id>&interval=1h` → array of `{ time, aqi, co, co2, hum, no2, o3, pm1, pm10, pm25, so2, temp }` (values as numeric strings). `interval` also accepts things like `28d` for longer backfills.

Both endpoints expect `Origin: https://www.aqionline.in` / `Referer: https://www.aqionline.in/` headers (see `src/fetch-aqi.js`'s `fetchJson`).
