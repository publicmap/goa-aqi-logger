/**
 * Unit test for toSensorValue: readings the API omits or reports as blank must
 * land in the CSV as empty cells, never as 0 or NaN, while real numbers
 * (including a genuine 0) must survive unchanged.
 */

import assert from 'node:assert/strict';
import { toSensorValue } from './fetch-aqi.js';

const cases = [
  // Genuine readings stay numeric.
  ['0', 0],
  ['0.0', 0],
  [0, 0],
  ['42', 42],
  ['12.75', 12.75],
  ['.5', 0.5],
  ['-3.2', -3.2],
  ['+7', 7],
  ['1.2e3', 1200],
  ['2E-2', 0.02],
  [' 18.4 ', 18.4],
  [-40, -40],

  // Missing or unusable readings become empty cells.
  [undefined, ''],
  [null, ''],
  ['', ''],
  ['   ', ''],
  [false, ''],
  [true, ''],
  ['null', ''],
  ['N/A', ''],
  ['--', ''],
  ['12abc', ''],
  ['NaN', ''],
  ['Infinity', ''],
  [NaN, ''],
  [Infinity, ''],
  [{}, ''],
  [[], ''],
  [['5'], '']
];

let failures = 0;
for (const [input, expected] of cases) {
  const actual = toSensorValue(input);
  try {
    assert.deepEqual(actual, expected);
  } catch {
    failures += 1;
    console.error(`FAIL: toSensorValue(${JSON.stringify(input) ?? String(input)}) => ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

if (failures) {
  console.error(`Sensor value test FAILED: ${failures}/${cases.length} case(s)`);
  process.exit(1);
}
console.log(`OK: ${cases.length} sensor value case(s) passed`);
