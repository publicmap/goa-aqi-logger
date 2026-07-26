/**
 * Quick connectivity check against the aqionline.in backend, used by the
 * CI workflow to confirm the API is reachable before running the logger.
 */

const DEVICES_URL = 'https://backend.aqionline.in/api/devices?page=1&limit=1';

const headers = {
  Accept: '*/*',
  Origin: 'https://www.aqionline.in',
  Referer: 'https://www.aqionline.in/',
  'User-Agent': 'Mozilla/5.0 (compatible; goa-aqi-logger/1.0; +https://github.com/publicmap/goa-aqi-logger)'
};

async function main() {
  console.log(`Testing ${DEVICES_URL}`);
  const response = await fetch(DEVICES_URL, { headers });
  if (!response.ok) {
    throw new Error(`Devices endpoint returned ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  const devices = json?.data || [];
  if (!devices.length) {
    throw new Error('Devices endpoint returned no devices');
  }
  console.log(`OK: received ${devices.length} device(s). Example: ${devices[0].device_id}`);
}

main().catch(error => {
  console.error('Connectivity test FAILED:', error.message);
  process.exit(1);
});
