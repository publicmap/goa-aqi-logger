// Minimal RFC 4180-ish CSV helpers for data/stations.csv, whose names contain
// commas (unlike the sensor CSVs, which the dashboard parses with split(',')).

export function toCsvLine(values) {
  return values
    .map((v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines.shift());
  return lines.map((l) => {
    const vals = parseCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, vals[i] ?? '']));
  });
}
