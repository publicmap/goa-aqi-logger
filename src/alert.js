// Sends an ntfy.sh push alert when any online station reports AQI above the
// unhealthy threshold. Reads the snapshot written by fetch-aqi.js, so run it
// after `npm start`.
//
//   NTFY_TOPIC=goa-aqi node src/alert.js      # send if threshold exceeded
//   DRY_RUN=1 node src/alert.js               # print the message, don't send

import { readFile } from 'node:fs/promises';
import { parseCsv } from './csv.js';

const GEOJSON_PATH = 'output/geojson/aqi-latest.geojson';
const STATIONS_PATH = 'data/stations.csv';
const THRESHOLD = 150;
const NTFY_SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'goa-aqi';
const DRY_RUN = Boolean(process.env.DRY_RUN);

// EPA AQI categories, matching the breakpoints used on the dashboard.
const CATEGORIES = [
  { min: 301, label: 'Hazardous', priority: 5, tags: 'skull' },
  { min: 201, label: 'Very Unhealthy', priority: 5, tags: 'rotating_light' },
  { min: 151, label: 'Unhealthy', priority: 4, tags: 'warning' },
  { min: 101, label: 'Unhealthy for Sensitive Groups', priority: 3, tags: 'mask' },
  { min: 51, label: 'Moderate', priority: 3, tags: 'cloud' },
  { min: 0, label: 'Good', priority: 2, tags: 'white_check_mark' },
];

export function categoryFor(aqi) {
  return CATEGORIES.find((c) => aqi >= c.min);
}

function formatIST(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }) + ' IST';
}

// Returns null when no alert is needed, otherwise { title, message, category }.
export function buildAlert(geojson, stationNames = new Map()) {
  // Offline stations keep their last reading forever (some date back years),
  // so only live stations count toward the advisory.
  const readings = geojson.features
    .map((f) => f.properties)
    .filter((p) => p.online && typeof p.aqi === 'number' && Number.isFinite(p.aqi));

  const unhealthy = readings.filter((p) => p.aqi > THRESHOLD).sort((a, b) => b.aqi - a.aqi);
  if (unhealthy.length === 0) return null;

  const maxAqi = Math.max(...readings.map((p) => p.aqi));
  const category = categoryFor(maxAqi);
  const timestamp = formatIST(geojson.metadata?.timestamp ?? Date.now());

  return {
    title: `Goa AQI: ${category.label}`,
    message:
      `Goa AQI: ${category.label}. ${unhealthy.length}/${readings.length} stations ` +
      `reporting unhealthy air quality (AQI>${THRESHOLD}) at ${timestamp}.\n\n` +
      unhealthy
        .map((p) => `• ${stationNames.get(p.device_id) || p.device_id}: AQI ${Math.round(p.aqi)} (${categoryFor(p.aqi).label})`)
        .join('\n'),
    category,
  };
}

async function main() {
  const geojson = JSON.parse(await readFile(GEOJSON_PATH, 'utf8'));
  const stationNames = new Map();
  try {
    for (const row of parseCsv(await readFile(STATIONS_PATH, 'utf8'))) stationNames.set(row.device_id, row.name);
  } catch {
    console.warn(`${STATIONS_PATH} not found; using device ids.`);
  }
  const alert = buildAlert(geojson, stationNames);

  if (!alert) {
    console.log(`No station above AQI ${THRESHOLD}; no alert sent.`);
    return;
  }

  console.log(alert.title + '\n' + alert.message);
  if (DRY_RUN) {
    console.log('DRY_RUN set; not sending.');
    return;
  }

  const res = await fetch(`${NTFY_SERVER}/${NTFY_TOPIC}`, {
    method: 'POST',
    body: alert.message,
    headers: {
      Title: alert.title,
      Priority: String(alert.category.priority),
      Tags: alert.category.tags,
      Click: 'https://publicmap.github.io/goa-aqi-logger/',
    },
  });
  if (!res.ok) {
    throw new Error(`ntfy responded ${res.status}: ${await res.text()}`);
  }
  console.log(`Alert sent to ${NTFY_SERVER}/${NTFY_TOPIC}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
