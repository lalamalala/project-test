'use strict';

const fs   = require('fs');
const path = require('path');

const RESULTS_DIR = path.resolve(__dirname, '../reports/playwright');
const JUNIT_FILE  = path.join(RESULTS_DIR, 'results.xml');
const HTML_FILE   = path.join(RESULTS_DIR, 'summary.html');
const CSS_FILE    = path.join(RESULTS_DIR, 'pw-style.css');

if (!fs.existsSync(JUNIT_FILE)) {
    console.warn('No Playwright JUnit results found — skipping HTML summary.');
    process.exit(0);
}

const xml = fs.readFileSync(JUNIT_FILE, 'utf8');

function attr(str, name) {
    const m = str.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : '';
}
function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Parse top-level <testsuites>
const tsMatch  = xml.match(/<testsuites[^>]*>/);
const tsAttrs  = tsMatch ? tsMatch[0] : '';
const total    = parseInt(attr(tsAttrs, 'tests'))    || 0;
const failures = parseInt(attr(tsAttrs, 'failures')) || 0;
const errors   = parseInt(attr(tsAttrs, 'errors'))   || 0;
const totalMs  = Math.round(parseFloat(attr(tsAttrs, 'time') || '0') * 1000);
const passed   = total - failures - errors;

// Parse individual <testcase> entries
const cases = [];
const caseRe = /<testcase([^>]*)>([\s\S]*?)<\/testcase>|<testcase([^>]*)\/>/g;
let m;
while ((m = caseRe.exec(xml)) !== null) {
    const attrs   = m[1] || m[3];
    const body    = m[2] || '';
    const name    = attr(attrs, 'name');
    const time    = parseFloat(attr(attrs, 'time') || '0');
    const failMsg = body.includes('<failure')
        ? (body.match(/<failure[^>]*message="([^"]*)"/) || ['', ''])[1]
        : null;
    cases.push({ name, time, failed: failMsg !== null, failMsg });
}

// Prev data for delta
const PREV_FILE = path.join(RESULTS_DIR, 'prev.json');
let prevData = null;
try { prevData = JSON.parse(fs.readFileSync(PREV_FILE, 'utf8')); } catch (_) {}

function deltaCell(cur, prev) {
    if (prev === undefined || prev === null) return '<td class="neutral">—</td>';
    const d = cur - prev;
    if (Math.abs(d) < 0.05) return '<td class="neutral">&#9644;</td>';
    const sign = d > 0 ? '+' : '';
    const cls  = d < 0 ? 'better' : 'worse';
    const arr  = d < 0 ? '&#9660;' : '&#9650;';
    return `<td class="${cls}">${arr} ${sign}${d.toFixed(2)}s</td>`;
}

const rows = cases.map((c, i) => {
    const cls      = c.failed ? 'fail' : 'pass';
    const icon     = c.failed ? '&#10007;' : '&#10003;';
    const prevTime = prevData?.cases?.[i]?.time;
    const failCell = c.failed
        ? `<td class="fail-msg">${esc(c.failMsg || 'Failed')}</td>`
        : '<td class="pass-note">—</td>';
    return `<tr>
      <td class="name">${esc(c.name)}</td>
      <td class="${cls}">${icon}</td>
      <td class="dur">${c.time.toFixed(2)}s</td>
      ${deltaCell(c.time, prevTime)}
      ${failCell}
    </tr>`;
}).join('\n');

const buildInfo = process.env.BUILD_NUMBER
    ? `Build #${process.env.BUILD_NUMBER}` : null;
const date = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

const prevNote = prevData
    ? `&#128257;&nbsp;Compared to: <strong>${prevData.buildInfo || prevData.date}</strong>`
    : `&#128310;&nbsp;No previous build data — delta will appear from next run`;

const overallCls = failures + errors > 0 ? 'badge-fail' : 'badge-pass';
const overallTxt = failures + errors > 0
    ? `&#10007; ${failures + errors} FAILED`
    : `&#10003; ALL PASSED`;

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  background: #f0f2f5; color: #222; padding: 1.8rem;
}
h1 { font-size: 1.7rem; font-weight: 800; color: #1a1a2e; margin-bottom: .4rem; }
.meta { font-size: .85rem; color: #555; margin-bottom: .6rem; }
.prev-note { font-size: .82rem; color: #777; font-style: italic; margin-bottom: 1.2rem; }
.chip { background: #e8f0fe; color: #1a73e8; padding: 3px 10px; border-radius: 20px; font-weight: 700; margin-left: .8rem; }
.badge { display: inline-block; padding: 5px 18px; border-radius: 20px; font-weight: 800; font-size: .95rem; margin-bottom: 1.1rem; }
.badge-pass { background: #e6faf0; color: #0a6b3a; border: 1px solid #0cce6b; }
.badge-fail { background: #fff0ef; color: #a81a0e; border: 1px solid #ff4e42; }
.stats { font-size: .85rem; color: #666; margin-bottom: 1.2rem; }
.card { background: #fff; border-radius: 12px; padding: 1.4rem 1.6rem; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
table { border-collapse: collapse; width: 100%; }
th {
  background: #f5f6f8; font-size: .78rem; font-weight: 700; color: #666;
  text-transform: uppercase; letter-spacing: .05em;
  padding: .5rem .9rem; border: 1px solid #e8e8e8; text-align: center;
}
th.col-name { text-align: left; min-width: 260px; }
td { padding: .55rem .9rem; border: 1px solid #e8e8e8; font-size: .9rem; }
td.name { font-weight: 600; color: #333; }
td.pass { color: #0a6b3a; font-weight: 800; text-align: center; font-size: 1.1rem; }
td.fail { color: #a81a0e; font-weight: 800; text-align: center; font-size: 1.1rem; }
td.dur  { text-align: center; color: #555; font-weight: 700; }
td.fail-msg { font-size: .78rem; color: #a81a0e; max-width: 380px; word-break: break-word; }
td.pass-note { color: #ccc; text-align: center; }
td.neutral { color: #aaa; text-align: center; font-size: .82rem; }
td.better  { color: #0a6b3a; font-weight: 700; text-align: center; }
td.worse   { color: #a81a0e; font-weight: 700; text-align: center; }
`.trim();

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Playwright Performance Results</title>
<link rel="stylesheet" href="pw-style.css">
</head>
<body>
<h1>&#127775;&nbsp;Playwright Page Performance</h1>
<div class="meta">
  Generated: ${date}${buildInfo ? `<span class="chip">${buildInfo}</span>` : ''}
</div>
<div class="prev-note">${prevNote}</div>
<div class="badge ${overallCls}">${overallTxt}</div>
<div class="stats">${total} tests &nbsp;&middot;&nbsp; ${passed} passed &nbsp;&middot;&nbsp; ${failures} failed &nbsp;&middot;&nbsp; total ${(totalMs / 1000).toFixed(1)}s</div>
<div class="card">
  <table>
    <thead><tr>
      <th class="col-name">Test</th>
      <th>Result</th>
      <th>Duration</th>
      <th>vs Previous</th>
      <th>Details</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
</body>
</html>`;

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.writeFileSync(CSS_FILE, CSS, 'utf8');
fs.writeFileSync(HTML_FILE, HTML, 'utf8');

// Save current for next build delta
const buildInfoFull = buildInfo ? `${buildInfo} (${date})` : date;
fs.writeFileSync(PREV_FILE, JSON.stringify({
    buildInfo: buildInfoFull,
    date,
    cases: cases.map(c => ({ name: c.name, time: c.time })),
}, null, 2), 'utf8');

console.log(`Playwright summary written to ${HTML_FILE}`);
