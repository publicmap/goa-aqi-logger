/**
 * AQI Online Data Logger
 *
 * Fetches the device list + latest readings from aqionline.in's backend API,
 * writes a GeoJSON snapshot (one point per device, latest reading), and
 * appends a CSV time series log (one row per device per timestamp) so the
 * full history can be reconstructed for analysis.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

const DEVICES_URL = 'https://backend.aqionline.in/api/devices';
const DEVICE_DATA_URL = 'https://backend.aqionline.in/api/users/devices/getdata';
const DEVICES_PAGE_LIMIT = 50;

// Interval requested from the per-device timeseries endpoint on each run.
// '1h' returns ~10 minute resolution readings, which comfortably covers the
// gap since the last hourly run (with overlap so a missed run isn't lossy).
const TIMESERIES_INTERVAL = process.env.AQI_INTERVAL || '1h';
// Concurrency for per-device timeseries fetches, to be gentle on the API.
const CONCURRENCY = 5;

const SENSOR_FIELDS = ['aqi', 'co', 'co2', 'hum', 'no2', 'o3', 'pm1', 'pm10', 'pm25', 'so2', 'temp'];

const GEOJSON_OUTPUT_DIR = path.join(ROOT_DIR, 'output/geojson');
const CSV_OUTPUT_DIR = path.join(ROOT_DIR, 'output/csv');
const STATE_DIR = path.join(ROOT_DIR, 'output/state');
const GEOJSON_FILE = path.join(GEOJSON_OUTPUT_DIR, 'aqi-latest.geojson');
const MANIFEST_FILE = path.join(ROOT_DIR, 'output/manifest.json');
const STATE_FILE = path.join(STATE_DIR, 'last-timestamps.json');

for (const dir of [GEOJSON_OUTPUT_DIR, CSV_OUTPUT_DIR, STATE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Goa is IST (UTC+5:30). CSV logs are bucketed by IST calendar day so a
// day's file lines up with local sunrise-to-sunrise readings.
function toISTDayString(date) {
  const ist = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  const iso = ist.toISOString();
  return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10);
}

function escapeCsvField(field) {
  if (field === null || field === undefined) return '';
  const stringField = String(field);
  if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
    return `"${stringField.replace(/"/g, '""')}"`;
  }
  return stringField;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: '*/*',
      Origin: 'https://www.aqionline.in',
      Referer: 'https://www.aqionline.in/',
      'User-Agent': 'Mozilla/5.0 (compatible; goa-aqi-logger/1.0; +https://github.com/publicmap/goa-aqi-logger)'
    },
    ...options
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status} ${response.statusText}): ${url}`);
  }
  return response.json();
}

async function fetchAllDevices() {
  const devices = [];
  let page = 1;
  while (true) {
    const url = `${DEVICES_URL}?page=${page}&limit=${DEVICES_PAGE_LIMIT}`;
    const json = await fetchJson(url);
    const batch = json?.data || [];
    devices.push(...batch);
    if (batch.length < DEVICES_PAGE_LIMIT) break;
    page += 1;
  }
  return devices;
}

async function fetchDeviceTimeseries(deviceId) {
  const url = `${DEVICE_DATA_URL}?device_id=${encodeURIComponent(deviceId)}&interval=${TIMESERIES_INTERVAL}`;
  try {
    const rows = await fetchJson(url);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    log(`WARNING: failed to fetch timeseries for ${deviceId}: ${error.message}`);
    return [];
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Convert a device's `realtime` array (one entry per sensor field) into a
// flat { field: value, field_unit: unit } object, plus the reading time.
function flattenRealtime(realtime = []) {
  const flat = {};
  let latestTime = null;
  for (const reading of realtime) {
    if (!reading || !reading._field) continue;
    flat[reading._field] = reading._value;
    if (reading.unit) flat[`${reading._field}_unit`] = reading.unit;
    if (reading._time && (!latestTime || reading._time > latestTime)) {
      latestTime = reading._time;
    }
  }
  return { flat, latestTime };
}

function buildGeoJson(devices) {
  const features = devices
    .filter(device => typeof device.longitude === 'number' && typeof device.latitude === 'number')
    .map(device => {
      const { flat, latestTime } = flattenRealtime(device.realtime);
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [device.longitude, device.latitude]
        },
        properties: {
          device_id: device.device_id,
          online: !!device.online,
          isPublic: !!device.isPublic,
          time: latestTime,
          ...flat
        }
      };
    });

  return {
    type: 'FeatureCollection',
    metadata: {
      source: 'https://www.aqionline.in/dashboard',
      timestamp: new Date().toISOString(),
      count: features.length
    },
    features
  };
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const CSV_HEADER = ['time', 'device_id', 'latitude', 'longitude', ...SENSOR_FIELDS];

function appendRowsToDayFiles(rowsByDay) {
  const touchedFiles = [];
  for (const [day, rows] of Object.entries(rowsByDay)) {
    const filePath = path.join(CSV_OUTPUT_DIR, `aqi-${day}.csv`);
    const isNewFile = !fs.existsSync(filePath);
    if (isNewFile) {
      fs.writeFileSync(filePath, CSV_HEADER.join(',') + '\n');
    }
    const lines = rows.map(row => CSV_HEADER.map(field => escapeCsvField(row[field])).join(','));
    fs.appendFileSync(filePath, lines.join('\n') + '\n');
    touchedFiles.push(path.basename(filePath));
  }
  return touchedFiles;
}

function updateManifest(devices, csvDayFiles) {
  const existingCsvFiles = fs.readdirSync(CSV_OUTPUT_DIR).filter(f => f.endsWith('.csv')).sort();
  const manifest = {
    updatedAt: new Date().toISOString(),
    source: 'https://www.aqionline.in/dashboard',
    devices: devices.map(device => ({
      device_id: device.device_id,
      latitude: device.latitude,
      longitude: device.longitude,
      sensors: device.sensors || [],
      online: !!device.online
    })),
    csvFiles: existingCsvFiles
  };
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function fetchAndLogAqiData() {
  log('Fetching device list...');
  const devices = await fetchAllDevices();
  log(`Found ${devices.length} devices`);

  log('Writing latest-reading GeoJSON snapshot...');
  const geojson = buildGeoJson(devices);
  fs.writeFileSync(GEOJSON_FILE, JSON.stringify(geojson, null, 2));
  log(`Wrote ${geojson.features.length} features to ${path.relative(ROOT_DIR, GEOJSON_FILE)}`);

  log(`Fetching per-device timeseries (interval=${TIMESERIES_INTERVAL})...`);
  const state = loadState();
  const rowsByDay = {};
  let totalNewRows = 0;

  await mapWithConcurrency(devices, CONCURRENCY, async (device) => {
    const timeseries = await fetchDeviceTimeseries(device.device_id);
    const lastSeen = state[device.device_id];
    let newestTime = lastSeen || null;

    for (const point of timeseries) {
      if (!point.time) continue;
      if (lastSeen && point.time <= lastSeen) continue;

      const day = toISTDayString(new Date(point.time));
      if (!rowsByDay[day]) rowsByDay[day] = [];

      const row = {
        time: point.time,
        device_id: device.device_id,
        latitude: device.latitude,
        longitude: device.longitude
      };
      for (const field of SENSOR_FIELDS) {
        row[field] = point[field] !== undefined ? Number(point[field]) : '';
      }
      rowsByDay[day].push(row);
      totalNewRows += 1;

      if (!newestTime || point.time > newestTime) newestTime = point.time;
    }

    if (newestTime) state[device.device_id] = newestTime;
  });

  log(`Collected ${totalNewRows} new readings across ${Object.keys(rowsByDay).length} day(s)`);
  const touchedFiles = appendRowsToDayFiles(rowsByDay);
  saveState(state);

  const manifest = updateManifest(devices, touchedFiles);
  log(`Manifest updated with ${manifest.devices.length} devices and ${manifest.csvFiles.length} CSV file(s)`);

  return { deviceCount: devices.length, newRows: totalNewRows, touchedFiles };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchAndLogAqiData().catch(error => {
    console.error('ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
}
