// One-time helper: reverse-geocodes every station in the latest snapshot via
// Nominatim and writes data/stations.csv (device_id -> human-readable name).
// Existing rows are kept, so hand-edited names survive a re-run and only new
// stations are looked up.
//
//   npm run build:stations
//
// Nominatim usage policy: max 1 request/second, identifying User-Agent.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseCsv, toCsvLine } from './csv.js';

const GEOJSON_PATH = 'output/geojson/aqi-latest.geojson';
const STATIONS_PATH = 'data/stations.csv';
const HEADER = ['device_id', 'name', 'neighbourhood', 'town', 'district', 'latitude', 'longitude'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reverseGeocode(lat, lon) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.search = new URLSearchParams({ format: 'jsonv2', lat, lon, zoom: '17', addressdetails: '1', 'accept-language': 'en' });
  const res = await fetch(url, { headers: { 'User-Agent': 'aqi-station-namer/1.0' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status} for ${lat},${lon}`);
  return res.json();
}

function pickParts(address = {}) {
  const neighbourhood = address.neighbourhood || address.suburb || address.quarter || address.hamlet || address.residential || '';
  const town = address.city || address.town || address.village || address.municipality || '';
  const district = address.state_district || address.county || '';
  return { neighbourhood, town, district };
}

function buildName({ neighbourhood, town, district }) {
  const parts = [];
  for (const p of [neighbourhood, town, district]) {
    if (p && !parts.some((q) => q.toLowerCase() === p.toLowerCase())) parts.push(p);
  }
  return parts.join(', ');
}

async function main() {
  const geojson = JSON.parse(await readFile(GEOJSON_PATH, 'utf8'));

  const existing = new Map();
  if (existsSync(STATIONS_PATH)) {
    for (const row of parseCsv(await readFile(STATIONS_PATH, 'utf8'))) existing.set(row.device_id, row);
  }

  const rows = [];
  for (const f of geojson.features) {
    const id = f.properties.device_id;
    if (existing.has(id)) {
      rows.push(existing.get(id));
      continue;
    }
    const [lon, lat] = f.geometry.coordinates;
    const result = await reverseGeocode(lat, lon);
    const parts = pickParts(result.address);
    const row = { device_id: id, name: buildName(parts) || id, ...parts, latitude: lat, longitude: lon };
    console.log(`${id}  ${row.name}`);
    rows.push(row);
    await sleep(1100);
  }

  // Disambiguate stations that resolved to the same name.
  const counts = new Map();
  rows.forEach((r) => counts.set(r.name, (counts.get(r.name) || 0) + 1));
  rows.forEach((r) => {
    if (counts.get(r.name) > 1 && !r.name.endsWith(')')) r.name = `${r.name} (${r.device_id.slice(-3)})`;
  });

  rows.sort((a, b) => a.device_id.localeCompare(b.device_id));
  await mkdir('data', { recursive: true });
  const csv = [HEADER.join(','), ...rows.map((r) => toCsvLine(HEADER.map((h) => r[h])))].join('\n') + '\n';
  await writeFile(STATIONS_PATH, csv);
  console.log(`Wrote ${rows.length} stations to ${STATIONS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
