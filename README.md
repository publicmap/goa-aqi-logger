# Goa AQI Logger

Archives live air quality sensor data published on the [AQI Online dashboard](https://www.aqionline.in/dashboard) for a network of monitoring devices around Goa.

**Live Dashboard**: [(view)](https://publicmap.github.io/goa-aqi-logger/) — MapLibre map of current AQI per sensor, click a point for readings + history.

**Data**
- Latest snapshot (one point per device): [`output/geojson/aqi-latest.geojson`](output/geojson/aqi-latest.geojson)
- Full time series, one CSV per day: [`output/csv/`](output/csv/)
- Device/file index: [`output/manifest.json`](output/manifest.json)

## Details

A GitHub Actions workflow runs every hour and:
1. Fetches the device list + latest reading for every sensor from `backend.aqionline.in/api/devices`
2. Writes `output/geojson/aqi-latest.geojson` — a snapshot with the latest reading per device
3. Fetches each device's recent timeseries (`backend.aqionline.in/api/users/devices/getdata`) and appends only genuinely new readings to a daily CSV under `output/csv/` (deduplicated using `output/state/last-timestamps.json`)
4. Updates `output/manifest.json`, which the dashboard uses to know which devices and CSV files exist

### Development

```bash
npm install     # no external dependencies today, but keeps this future-proof
npm test        # checks the API is reachable
npm start       # fetch latest data + append to today's CSV log
```

To seed history beyond the last hour for a fresh checkout, run once with a longer interval (the backend supports interval strings like `1h`, `24h`, `28d`):

```bash
AQI_INTERVAL=28d npm start
```

### Viewing the dashboard locally

```bash
python3 -m http.server 8080
# open http://localhost:8080/index.html
```

## Data format

**`output/geojson/aqi-latest.geojson`** — one `Point` feature per device, properties include every sensor field from the device's `realtime` reading (`aqi`, `pm25`, `pm10`, `pm1`, `co`, `co2`, `no2`, `o3`, `so2`, `temp`, `hum`, plus `<field>_unit`), `device_id`, `online`, and `time` (timestamp of the latest reading).

**`output/csv/aqi-YYYYMMDD.csv`** (bucketed by IST calendar day) — columns: `time, device_id, latitude, longitude, aqi, co, co2, hum, no2, o3, pm1, pm10, pm25, so2, temp`. One row per device per ~10 minute reading.
