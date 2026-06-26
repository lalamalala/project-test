'use strict';

const fs   = require('fs');
const path = require('path');

const BUILD_NUM  = process.env.BUILD_NUMBER || null;
const PREV_FILE  = 'k6-trend-prev.json';
const REPORT_DIR = 'k6-trend-report';

const TYPES = [
    { id: 'smoke', label: 'Smoke Test' },
    { id: 'load',  label: 'Load Test'  },
];

const METRICS = [
    { key: 'avg_ms',      label: 'Avg Response',  fmt: fmtMs,  dir: -1 },
    { key: 'p95_ms',      label: 'P95 Response',  fmt: fmtMs,  dir: -1 },
    { key: 'max_ms',      label: 'Max Response',  fmt: fmtMs,  dir: -1 },
    { key: 'err_rate',    label: 'Error Rate',    fmt: fmtPct, dir: -1 },
    { key: 'iterations',  label: 'Iterations',    fmt: fmtNum, dir:  0 },
    { key: 'vus_max',     label: 'VUs (max)',     fmt: fmtNum, dir:  0 },
    { key: 'duration_ms', label: 'Test Duration', fmt: fmtDur, dir:  0 },
];

// dir: -1 = lower is better (green when decrease), +1 = higher is better, 0 = neutral

function fmtMs(v)  { return v + ' ms'; }
function fmtPct(v) { return (v * 100).toFixed(2) + '%'; }
function fmtNum(v) { return String(v); }
function fmtDur(v) {
    const s = Math.round(v / 1000);
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

function fmtDelta(key, d) {
    if (key === 'err_rate')    return (d > 0 ? '+' : '') + (d * 100).toFixed(2) + '%';
    if (key === 'duration_ms') return (d > 0 ? '+' : '') + Math.round(d / 1000) + 's';
    if (key.endsWith('_ms'))   return (d > 0 ? '+' : '') + Math.round(d) + ' ms';
    return (d > 0 ? '+' : '') + Math.round(d);
}

if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR);

let prevData = null;
try { prevData = JSON.parse(fs.readFileSync(PREV_FILE, 'utf8')); } catch (_) {}

const current = {};
for (const { id } of TYPES) {
    const f = `k6-metrics-${id}.json`;
    if (fs.existsSync(f)) current[id] = JSON.parse(fs.readFileSync(f, 'utf8'));
}

if (Object.keys(current).length === 0) {
    console.warn('No k6-metrics-*.json files found — skipping trend report.');
    process.exit(0);
}

function typeCard(id, label) {
    const cur  = current[id];
    const prev = prevData?.metrics?.[id];
    if (!cur) {
        return `<div class="type-card"><h2>${label}</h2><p class="no-data">No data for this build.</p></div>`;
    }

    const rows = METRICS.map(({ key, label: ml, fmt, dir }) => {
        const curVal  = cur[key];
        const prevVal = prev?.[key];
        const hasPrev = prevVal !== undefined && prevVal !== null;
        const d       = hasPrev ? curVal - prevVal : null;

        let prevCell  = '<td class="neutral">—</td>';
        let deltaCell = '<td class="neutral">—</td>';

        if (hasPrev) {
            prevCell = `<td>${fmt(prevVal)}</td>`;
            if (d === 0) {
                deltaCell = '<td class="neutral">&#9644; no change</td>';
            } else {
                const dStr  = fmtDelta(key, d);
                const arrow = d > 0 ? '&#9650;' : '&#9660;';
                let cls;
                if (dir === 0)  cls = 'neutral';
                else if (dir === -1) cls = d < 0 ? 'better' : 'worse';
                else              cls = d > 0 ? 'better' : 'worse';
                deltaCell = `<td class="${cls}">${arrow} ${dStr}</td>`;
            }
        }

        return `<tr>
          <td class="metric">${ml}</td>
          <td class="cur">${fmt(curVal)}</td>
          ${prevCell}
          ${deltaCell}
        </tr>`;
    }).join('\n');

    const prevLabel = prevData ? (prevData.buildInfo || prevData.timestamp) : null;
    const cmpNote   = prevLabel
        ? `<p class="cmp-note">&#128257;&nbsp;Compared to: <strong>${prevLabel}</strong></p>`
        : `<p class="cmp-note no-prev">&#128310;&nbsp;No previous build data — delta appears from next run</p>`;

    return `
<div class="type-card">
  <h2>${label}</h2>
  ${cmpNote}
  <table class="metrics-table">
    <thead><tr>
      <th class="col-metric">Metric</th>
      <th>Current</th>
      <th>Previous</th>
      <th>Delta</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

const date  = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const cards = TYPES.map(({ id, label }) => typeCard(id, label)).join('\n');

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  background: #f0f2f5; color: #222; padding: 1.8rem;
}
h1 { font-size: 1.7rem; font-weight: 800; color: #1a1a2e; margin-bottom: .4rem; }
.meta { font-size: .85rem; color: #555; margin-bottom: 1.6rem; }
.chip { background: #e8f0fe; color: #1a73e8; padding: 3px 10px; border-radius: 20px; font-weight: 700; margin-left: .8rem; }

.type-card {
  background: #fff; border-radius: 12px; padding: 1.4rem 1.6rem;
  margin-bottom: 1.4rem; box-shadow: 0 2px 10px rgba(0,0,0,.08);
  border-left: 5px solid #1a73e8;
}
.type-card h2 { font-size: 1.1rem; font-weight: 700; margin-bottom: .5rem; color: #1a1a2e; }
.cmp-note { font-size: .82rem; color: #777; margin-bottom: .9rem; font-style: italic; }
.cmp-note.no-prev { color: #aaa; }
.no-data { color: #aaa; font-style: italic; padding: .5rem 0; }

.metrics-table { border-collapse: collapse; width: 100%; }
.metrics-table th {
  background: #f5f6f8; font-size: .78rem; font-weight: 700; color: #666;
  text-transform: uppercase; letter-spacing: .05em;
  padding: .5rem .9rem; border: 1px solid #e8e8e8; text-align: center;
}
.metrics-table th.col-metric { text-align: left; min-width: 140px; }
.metrics-table td {
  padding: .5rem .9rem; border: 1px solid #e8e8e8;
  text-align: center; font-size: .92rem;
}
.metrics-table td.metric  { text-align: left; font-weight: 600; color: #333; }
.metrics-table td.cur     { font-weight: 800; color: #1a1a2e; }
.metrics-table td.neutral { color: #aaa; font-size: .82rem; }
.better { color: #0a6b3a; font-weight: 700; }
.worse  { color: #a81a0e; font-weight: 700; }
.legend {
  margin-top: 1rem; font-size: .8rem; color: #888;
  background: #fff; border-radius: 8px; padding: .7rem 1.2rem;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
`.trim();

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>k6 Performance Trend</title>
<link rel="stylesheet" href="k6-trend.css">
</head>
<body>
<h1>&#128200;&nbsp;k6 Performance Trend</h1>
<div class="meta">
  Generated: ${date}${BUILD_NUM ? `<span class="chip">Build #${BUILD_NUM}</span>` : ''}
</div>
${cards}
<div class="legend">
  &#9650; / &#9660; = change vs previous build &nbsp;&mdash;&nbsp;
  <span class="better">green = improvement</span> &nbsp;
  <span class="worse">red = regression</span> &nbsp;
  <span class="neutral">gray = neutral metric</span>
</div>
</body>
</html>`;

fs.writeFileSync(path.join(REPORT_DIR, 'k6-trend.css'), CSS, 'utf8');
fs.writeFileSync(path.join(REPORT_DIR, 'trend.html'), HTML, 'utf8');

const buildInfo = BUILD_NUM ? `Build #${BUILD_NUM} (${date})` : date;
fs.writeFileSync(PREV_FILE,
    JSON.stringify({ buildInfo, timestamp: date, metrics: current }, null, 2), 'utf8');

console.log(`k6 trend report written to ${REPORT_DIR}/trend.html`);
