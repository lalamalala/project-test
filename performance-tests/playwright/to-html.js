'use strict';

/* eslint-disable no-console */
const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const RESULTS_DIR   = path.resolve(__dirname, '../reports/playwright');
const JUNIT_FILE    = path.join(RESULTS_DIR, 'results.xml');
const METRICS_FILE  = path.join(RESULTS_DIR, 'metrics.json');
const HTML_FILE     = path.join(RESULTS_DIR, 'summary.html');
const CSS_FILE      = path.join(RESULTS_DIR, 'pw-style.css');
const PREV_FILE     = path.join(RESULTS_DIR, 'prev.json');

if (!fs.existsSync(JUNIT_FILE)) {
    console.warn('No Playwright JUnit results found — skipping HTML summary.');
    process.exit(0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function xmlAttr(str, name) {
    const m = str.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : '';
}
function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt(v) {
    if (v === null || v === undefined) return '—';
    const n = Number(v);
    return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`;
}
function sevClass(v, good, warn) {
    if (v === null || v === undefined) return 'na';
    return v < good ? 'good' : v < warn ? 'warn' : 'crit';
}

// Web Vitals + UX severity thresholds  [good, needsImprovement]
const SEV = {
    ttfb:        [200,  800],
    domComplete: [1500, 3500],
    pageLoad:    [2000, 5000],
    lcp:         [2500, 4000],
    transition:  [1000, 2500],
    actionMs:    [500,  1500],
};

// ---------------------------------------------------------------------------
// Parse JUnit XML
// ---------------------------------------------------------------------------
const xml      = fs.readFileSync(JUNIT_FILE, 'utf8');
const tsMatch  = xml.match(/<testsuites[^>]*>/);
const tsAttrs  = tsMatch ? tsMatch[0] : '';
const total    = parseInt(xmlAttr(tsAttrs, 'tests'))    || 0;
const failures = parseInt(xmlAttr(tsAttrs, 'failures')) || 0;
const errors   = parseInt(xmlAttr(tsAttrs, 'errors'))   || 0;
const totalMs  = Math.round(parseFloat(xmlAttr(tsAttrs, 'time') || '0') * 1000);
const passed   = total - failures - errors;

const junitCases = [];
const caseRe = /<testcase([^>]*)>([\s\S]*?)<\/testcase>|<testcase([^>]*)\/>/g;
let m;
while ((m = caseRe.exec(xml)) !== null) {
    const a = m[1] || m[3];
    const b = m[2] || '';
    junitCases.push({
        name:    xmlAttr(a, 'name'),
        time:    parseFloat(xmlAttr(a, 'time') || '0'),
        failed:  b.includes('<failure'),
        failMsg: b.includes('<failure')
            ? (b.match(/<failure[^>]*message="([^"]*)"/) || ['', ''])[1]
            : null,
    });
}

// ---------------------------------------------------------------------------
// Load detailed metrics (written by user-flow.spec.js afterAll)
// ---------------------------------------------------------------------------
let detailedTests = null;
let thresholds    = null;
try {
    const d = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
    detailedTests = d.tests      || null;
    thresholds    = d.thresholds || null;
} catch (_) {}

// ---------------------------------------------------------------------------
// Load previous build data for delta
// ---------------------------------------------------------------------------
let prevData = null;
try { prevData = JSON.parse(fs.readFileSync(PREV_FILE, 'utf8')); } catch (_) {}

// ---------------------------------------------------------------------------
// Cell builders
// ---------------------------------------------------------------------------
function metricCell(v, good, warn) {
    if (v === null || v === undefined) return '<td class="na">—</td>';
    const cls = sevClass(v, good, warn);
    return `<td class="m ${cls}">${fmt(v)}</td>`;
}

function deltaCell(cur, prev) {
    if (cur === null || cur === undefined) return '<td class="na">—</td>';
    if (prev === null || prev === undefined) return '<td class="na">—</td>';
    const d = Math.round(cur - prev);
    if (Math.abs(d) < 15) return '<td class="neutral">&#9644;&nbsp;~0</td>';
    const cls = d < 0 ? 'better' : 'worse';
    const arr = d < 0 ? '&#9660;' : '&#9650;';
    const sign = d > 0 ? '+' : '';
    return `<td class="${cls}">${arr}&nbsp;${sign}${fmt(Math.abs(d))}</td>`;
}

// ---------------------------------------------------------------------------
// Table rows
// ---------------------------------------------------------------------------
function buildRows() {
    if (detailedTests && detailedTests.length > 0) {
        return detailedTests.map((t, i) => {
            const prev  = prevData && prevData.tests && prevData.tests[i] ? prevData.tests[i] : {};
            const junit = junitCases[i] || {};
            const fail  = t.passed === false;
            const detailText = fail && (t.failMsg || junit.failMsg)
                ? esc((t.failMsg || junit.failMsg || '').slice(0, 250))
                : '—';
            return `
    <tr class="${fail ? 'row-fail' : 'row-pass'}">
      <td class="name">${esc(t.name)}<br><span class="url">${esc(t.url || '')}</span></td>
      <td class="${fail ? 'fail' : 'pass'} icon">${fail ? '&#10007;' : '&#10003;'}</td>
      <td class="dur">${junit.time ? junit.time.toFixed(2) + 's' : '—'}</td>
      ${metricCell(t.ttfb,         SEV.ttfb[0],        SEV.ttfb[1])}
      ${deltaCell( t.ttfb,         prev.ttfb)}
      ${metricCell(t.domComplete,  SEV.domComplete[0],  SEV.domComplete[1])}
      ${metricCell(t.pageLoad,     SEV.pageLoad[0],     SEV.pageLoad[1])}
      ${deltaCell( t.pageLoad,     prev.pageLoad)}
      ${metricCell(t.lcp,          SEV.lcp[0],          SEV.lcp[1])}
      ${deltaCell( t.lcp,          prev.lcp)}
      ${metricCell(t.transition,   SEV.transition[0],   SEV.transition[1])}
      ${metricCell(t.actionMs,     SEV.actionMs[0],     SEV.actionMs[1])}
      <td class="${fail ? 'fail-msg' : 'na'}">${detailText}</td>
    </tr>`;
        }).join('');
    }
    return junitCases.map((c, i) => {
        const prev = prevData && prevData.tests && prevData.tests[i] ? prevData.tests[i] : {};
        return `
    <tr class="${c.failed ? 'row-fail' : 'row-pass'}">
      <td class="name">${esc(c.name)}</td>
      <td class="${c.failed ? 'fail' : 'pass'} icon">${c.failed ? '&#10007;' : '&#10003;'}</td>
      <td class="dur">${c.time.toFixed(2)}s</td>
      <td colspan="10" class="${c.failed ? 'fail-msg' : 'na'}">${esc((c.failMsg || '').slice(0, 250) || '—')}</td>
    </tr>`;
    }).join('');
}

// ---------------------------------------------------------------------------
// Thresholds reference table
// ---------------------------------------------------------------------------
function buildThresholdsTable() {
    if (!thresholds) return '';
    const labels = { pageLoad: 'Page Load / Transition', ttfb: 'TTFB (server time)', lcp: 'LCP', login: 'Login action' };
    const wv     = { pageLoad: '&lt; 3000ms', ttfb: '&lt; 200ms', lcp: '&lt; 2500ms', login: '—' };
    const rows   = Object.entries(thresholds).map(([k, v]) =>
        `<tr><td>${labels[k] || k}</td><td class="thr-v">${fmt(v)}</td><td class="wv-v">${wv[k] || '—'}</td></tr>`
    ).join('');
    return `
<div class="card thr-card">
  <h2>&#127919;&nbsp;Thresholds &amp; Web Vitals Reference</h2>
  <table class="thr-table">
    <thead><tr><th>Metric</th><th>CI Threshold (this run)</th><th>Google &ldquo;Good&rdquo;</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="thr-note">Metric cells are coloured by Google Core Web Vitals:
    <span class="leg good">&#9632; Good</span>
    <span class="leg warn">&#9632; Needs Improvement</span>
    <span class="leg crit">&#9632; Poor</span>
  </p>
</div>`;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------
function buildRecommendations() {
    if (!detailedTests) return '';

    const recs = [];

    for (const t of detailedTests) {
        if (t.lcp !== null && t.lcp !== undefined) {
            if (t.lcp >= 4000) {
                recs.push({ sev: 'crit', metric: 'LCP', test: t.name, val: fmt(t.lcp),
                    body: `LCP is <strong>${fmt(t.lcp)}</strong> — rated <em>Poor</em> by Google Core Web Vitals (&ge;4000ms). In CI this often reflects a cold-start (no cached assets). For real users: <ul><li>Preload the hero element with <code>&lt;link rel="preload" as="image"&gt;</code>.</li><li>Serve images in WebP/AVIF format via a CDN close to users.</li><li>Remove render-blocking &lt;script&gt; or &lt;link&gt; tags placed above the fold.</li></ul>` });
            } else if (t.lcp >= 2500) {
                recs.push({ sev: 'warn', metric: 'LCP', test: t.name, val: fmt(t.lcp),
                    body: `LCP is <strong>${fmt(t.lcp)}</strong> — in the <em>Needs Improvement</em> zone (2500–4000ms per Google). Consider preloading the LCP element and ensuring it is fetched with high priority (<code>fetchpriority="high"</code>).` });
            }
        }
        if (t.ttfb !== null && t.ttfb !== undefined) {
            if (t.ttfb >= 800) {
                recs.push({ sev: 'crit', metric: 'TTFB', test: t.name, val: fmt(t.ttfb),
                    body: `Server response time is <strong>${fmt(t.ttfb)}</strong> — exceeds the 800ms critical threshold. Check: <ul><li>Slow database queries or ORM N+1 problems.</li><li>Missing HTTP cache headers (<code>Cache-Control</code>, <code>ETag</code>).</li><li>No CDN or edge cache in front of the origin server.</li></ul>` });
            } else if (t.ttfb >= 200) {
                recs.push({ sev: 'info', metric: 'TTFB', test: t.name, val: fmt(t.ttfb),
                    body: `TTFB is <strong>${fmt(t.ttfb)}</strong> — acceptable but above the Google "Good" limit of 200ms. A CDN or application-level response cache (Redis, Varnish) could reduce this below 200ms.` });
            }
        }
        if (t.domComplete !== null && t.domComplete !== undefined && t.domComplete >= 3500) {
            recs.push({ sev: t.domComplete >= 5000 ? 'crit' : 'warn', metric: 'DOM Complete', test: t.name, val: fmt(t.domComplete),
                body: `DOM processing took <strong>${fmt(t.domComplete)}</strong>. Likely caused by heavy or render-blocking JavaScript: <ul><li>Add <code>defer</code> or <code>async</code> to non-critical scripts.</li><li>Code-split large JS bundles (dynamic <code>import()</code>).</li><li>Remove unused CSS and JS with tree-shaking.</li></ul>` });
        }
        if (t.pageLoad !== null && t.pageLoad !== undefined && t.pageLoad >= 5000) {
            recs.push({ sev: t.pageLoad >= 8000 ? 'crit' : 'warn', metric: 'Page Load', test: t.name, val: fmt(t.pageLoad),
                body: `Full page load is <strong>${fmt(t.pageLoad)}</strong>. Common causes: <ul><li>Large uncompressed assets — enable Brotli/gzip compression on the server.</li><li>Too many HTTP requests — bundle assets, use HTTP/2 server push.</li><li>Third-party scripts (analytics, chat, A/B testing) blocking the <code>load</code> event.</li></ul>` });
        }
        if (t.transition !== null && t.transition !== undefined && t.transition >= 2500) {
            recs.push({ sev: 'warn', metric: 'Navigation', test: t.name, val: fmt(t.transition),
                body: `Page transition from / to /admin took <strong>${fmt(t.transition)}</strong>. Check for: <ul><li>API calls triggered on route change that block rendering.</li><li>Heavy component initialisation in the router lifecycle.</li><li>Consider skeleton screens or optimistic UI to improve perceived speed.</li></ul>` });
        }
        if (t.actionMs !== null && t.actionMs !== undefined && t.actionMs >= 1500) {
            recs.push({ sev: 'warn', metric: 'Login Action', test: t.name, val: fmt(t.actionMs),
                body: `Login form submission took <strong>${fmt(t.actionMs)}</strong>. Check: <ul><li>Authentication endpoint latency (token generation, session store writes).</li><li>Redirect chain after successful login (multiple 301/302 hops).</li><li>Rate-limiting or CAPTCHA verification adding delay.</li></ul>` });
        }
    }

    if (recs.length === 0) {
        return `
<div class="card rec-card">
  <h2>&#127881;&nbsp;Recommendations</h2>
  <p class="all-good">&#10003;&nbsp;All measured metrics are within acceptable thresholds. No action required for this build.</p>
</div>`;
    }

    const order = { crit: 0, warn: 1, info: 2 };
    recs.sort((a, b) => (order[a.sev] || 2) - (order[b.sev] || 2));
    const icons = { crit: '&#128308;', warn: '&#128993;', info: '&#8505;&#65039;' };

    const items = recs.map(r => `
<div class="rec-item rec-${r.sev}">
  <div class="rec-header">${icons[r.sev] || '&#9679;'} <strong>${esc(r.metric)}</strong> &mdash; ${esc(r.test)} <span class="rec-val">(measured: ${r.val})</span></div>
  <div class="rec-body">${r.body}</div>
</div>`).join('');

    return `
<div class="card rec-card">
  <h2>&#128270;&nbsp;Recommendations</h2>
  ${items}
</div>`;
}

// ---------------------------------------------------------------------------
// Page metadata
// ---------------------------------------------------------------------------
const buildInfo  = process.env.BUILD_NUMBER ? `Build #${process.env.BUILD_NUMBER}` : null;
const date       = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const hasDetail  = !!(detailedTests && detailedTests.length > 0);
const overallCls = failures + errors > 0 ? 'badge-fail' : 'badge-pass';
const overallTxt = failures + errors > 0
    ? `&#10007;&nbsp;${failures + errors} FAILED`
    : `&#10003;&nbsp;ALL PASSED`;
const prevNote   = prevData
    ? `&#128257;&nbsp;Delta compared to: <strong>${prevData.buildInfo || prevData.date}</strong>`
    : `&#128197;&nbsp;No previous build data &mdash; delta columns will populate from the next run`;

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------
const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  background: #f0f2f5; color: #222; padding: 2rem 2.4rem; font-size: 14px;
}
h1 { font-size: 1.7rem; font-weight: 800; color: #1a1a2e; margin-bottom: .35rem; }
h2 { font-size: 1.1rem; font-weight: 700; color: #333; margin-bottom: 1rem; }
.meta { font-size: .83rem; color: #555; margin-bottom: .4rem; }
.chip { background: #e8f0fe; color: #1a73e8; padding: 2px 10px; border-radius: 20px; font-weight: 700; margin-left: .6rem; }
.prev-note { font-size: .81rem; color: #777; font-style: italic; margin-bottom: 1.1rem; }
.badge { display: inline-block; padding: 5px 20px; border-radius: 20px; font-weight: 800; font-size: .95rem; margin-bottom: .7rem; }
.badge-pass { background: #e6faf0; color: #0a6b3a; border: 1px solid #0cce6b; }
.badge-fail { background: #fff0ef; color: #a81a0e; border: 1px solid #ff4e42; }
.stats { font-size: .83rem; color: #666; margin-bottom: 1.6rem; }
.card { background: #fff; border-radius: 12px; padding: 1.4rem 1.6rem; box-shadow: 0 2px 12px rgba(0,0,0,.08); margin-bottom: 1.6rem; overflow-x: auto; }
table.main-table { border-collapse: collapse; width: 100%; min-width: 960px; }
th { background: #f5f6f8; font-size: .72rem; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: .05em; padding: .45rem .7rem; border: 1px solid #e2e4e8; text-align: center; white-space: nowrap; }
th.col-name { text-align: left; min-width: 220px; }
th.col-group { background: #eef0f4; }
td { padding: .5rem .7rem; border: 1px solid #e2e4e8; font-size: .88rem; vertical-align: middle; }
td.name { font-weight: 600; color: #222; }
span.url { font-size: .75rem; color: #888; font-weight: 400; display: block; margin-top: 2px; }
td.pass { color: #0a6b3a; font-weight: 900; text-align: center; font-size: 1.1rem; }
td.fail { color: #a81a0e; font-weight: 900; text-align: center; font-size: 1.1rem; }
td.dur  { text-align: center; color: #555; font-weight: 600; }
td.fail-msg { font-size: .76rem; color: #a81a0e; max-width: 320px; word-break: break-word; }
td.na   { color: #ccc; text-align: center; font-size: .8rem; }
td.neutral { color: #aaa; text-align: center; font-size: .8rem; }
td.better  { color: #0a6b3a; font-weight: 700; text-align: center; font-size: .82rem; }
td.worse   { color: #a81a0e; font-weight: 700; text-align: center; font-size: .82rem; }
td.icon    { text-align: center; }
td.m { text-align: center; font-weight: 700; font-size: .85rem; }
td.good { background: #f0faf4; color: #0a6b3a; }
td.warn { background: #fffbf0; color: #8a5500; }
td.crit { background: #fff5f5; color: #a81a0e; }
tr.row-pass:hover td, tr.row-fail:hover td { filter: brightness(.97); }
.legend { font-size: .78rem; margin-bottom: .9rem; color: #555; }
.leg { margin-right: .9rem; }
.leg.good { color: #0a6b3a; }
.leg.warn { color: #8a5500; }
.leg.crit { color: #a81a0e; }
.thr-card h2 { margin-bottom: .9rem; }
table.thr-table { border-collapse: collapse; }
table.thr-table th, table.thr-table td { padding: .45rem .9rem; border: 1px solid #e2e4e8; font-size: .87rem; }
table.thr-table th { background: #f5f6f8; text-align: left; font-weight: 700; font-size: .75rem; color: #666; text-transform: uppercase; }
td.thr-v { font-weight: 700; color: #1a73e8; text-align: center; }
td.wv-v  { color: #0a6b3a; font-weight: 700; text-align: center; }
.thr-note { font-size: .78rem; color: #777; margin-top: .9rem; font-style: italic; }
.rec-card h2 { margin-bottom: .9rem; }
.rec-item { border-radius: 8px; padding: .9rem 1.1rem; margin-bottom: .9rem; border-left: 4px solid #ccc; }
.rec-crit { background: #fff5f5; border-color: #e53935; }
.rec-warn { background: #fffbf0; border-color: #f9a825; }
.rec-info { background: #e8f4fd; border-color: #1a73e8; }
.rec-header { font-weight: 700; font-size: .9rem; margin-bottom: .45rem; color: #222; }
.rec-val    { font-size: .8rem; font-weight: 400; color: #666; }
.rec-body   { font-size: .85rem; color: #333; line-height: 1.55; }
.rec-body ul { margin: .4rem 0 0 1.2rem; }
.rec-body li { margin-bottom: .2rem; }
.rec-body code { background: #f0f2f5; padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: .82rem; }
.all-good { color: #0a6b3a; font-weight: 600; font-size: .9rem; }
`.trim();

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
const theadRow = hasDetail ? `
    <tr>
      <th class="col-name" rowspan="2">Test</th>
      <th rowspan="2">Result</th>
      <th rowspan="2">Duration</th>
      <th colspan="2" class="col-group">TTFB</th>
      <th rowspan="2">DOM</th>
      <th colspan="2" class="col-group">Page Load</th>
      <th colspan="2" class="col-group">LCP</th>
      <th rowspan="2">Transition</th>
      <th rowspan="2">Action</th>
      <th rowspan="2">Details</th>
    </tr>
    <tr>
      <th>Value</th><th>&Delta; prev</th>
      <th>Value</th><th>&Delta; prev</th>
      <th>Value</th><th>&Delta; prev</th>
    </tr>` : `
    <tr>
      <th class="col-name">Test</th><th>Result</th><th>Duration</th><th colspan="10">Details</th>
    </tr>`;

const legendBlock = hasDetail ? `
<div class="legend">
  Metric colour:
  <span class="leg good">&#9632; Good</span>
  <span class="leg warn">&#9632; Needs Improvement</span>
  <span class="leg crit">&#9632; Poor</span>
  &nbsp;(Google Core Web Vitals thresholds)
</div>` : '';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Playwright Performance Results</title>
<link rel="stylesheet" href="pw-style.css">
</head>
<body>
<h1>&#127775;&nbsp;Playwright Page Performance</h1>
<div class="meta">Generated: ${date}${buildInfo ? `<span class="chip">${buildInfo}</span>` : ''}</div>
<div class="prev-note">${prevNote}</div>
<div class="badge ${overallCls}">${overallTxt}</div>
<div class="stats">${total} tests &nbsp;&middot;&nbsp; ${passed} passed &nbsp;&middot;&nbsp; ${failures + errors} failed &nbsp;&middot;&nbsp; total ${(totalMs / 1000).toFixed(1)}s</div>

${buildThresholdsTable()}

<div class="card">
  ${legendBlock}
  <table class="main-table">
    <thead>${theadRow}</thead>
    <tbody>${buildRows()}</tbody>
  </table>
</div>

${buildRecommendations()}

</body>
</html>`;

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.writeFileSync(CSS_FILE,  CSS,  'utf8');
fs.writeFileSync(HTML_FILE, HTML, 'utf8');

const saveTests = detailedTests
    ? detailedTests.map(t => ({
        name: t.name, ttfb: t.ttfb, domComplete: t.domComplete,
        pageLoad: t.pageLoad, lcp: t.lcp, transition: t.transition, actionMs: t.actionMs,
    }))
    : junitCases.map(c => ({ name: c.name }));

fs.writeFileSync(PREV_FILE, JSON.stringify({
    buildInfo: buildInfo ? `${buildInfo} (${date})` : date,
    date,
    tests: saveTests,
}, null, 2), 'utf8');

console.log(`Playwright summary written to ${HTML_FILE}`);
