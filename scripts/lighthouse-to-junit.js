/**
 * lighthouse-to-junit.js
 *
 * Reads all lh-<page>.report.json files produced by the Lighthouse CLI and:
 *   1. Writes lighthouse-junit.xml  – JUnit format for Jenkins trend charts
 *   2. Writes lighthouse-summary.html – static, no-JS summary (Jenkins CSP safe)
 *   3. Writes lighthouse-scores-prev.json – saved for next build comparison
 *
 * Usage:
 *   node scripts/lighthouse-to-junit.js [threshold]
 *   threshold – minimum acceptable score 0-100 (default: 80)
 */

'use strict';

const fs = require('fs');

const threshold  = parseInt(process.argv[2] || '80', 10);
const BUILD_NUM  = process.env.BUILD_NUMBER || null;
const HISTORY_FILE = 'lighthouse-scores-prev.json';

const PAGE_LABELS = {
    'main':        'Main Page',
    'admin-login': 'Admin Login Page',
};

const CATEGORIES = [
    { id: 'performance',    label: 'Performance'    },
    { id: 'accessibility',  label: 'Accessibility'  },
    { id: 'best-practices', label: 'Best Practices' },
    { id: 'seo',            label: 'SEO'            },
];

// ── Find report files ─────────────────────────────────────────────────────────
const FILE_RE = /^lh-(.+)\.report\.json$/;
const files   = fs.readdirSync('.').filter(f => FILE_RE.test(f)).sort();

if (files.length === 0) {
    console.warn('No lh-*.report.json files found – writing empty outputs.');
    fs.writeFileSync('lighthouse-junit.xml',
        '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites/>\n', 'utf8');
    fs.writeFileSync('lighthouse-summary.html',
        '<!DOCTYPE html><html><body><p>No Lighthouse reports found.</p></body></html>', 'utf8');
    process.exit(0);
}

// ── Load previous scores for delta comparison ─────────────────────────────────
let prevData = null;
try {
    prevData = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    console.log(`[Lighthouse] Previous scores loaded (${prevData.buildInfo || prevData.timestamp})`);
} catch (_) {
    console.log('[Lighthouse] No previous scores – first run or clean workspace.');
}

// ── Collect scores ────────────────────────────────────────────────────────────
const allPages = [];

for (const file of files) {
    const pageName = file.match(FILE_RE)[1];
    const label    = PAGE_LABELS[pageName] || pageName;

    let lhData;
    try {
        lhData = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error(`Failed to parse ${file}: ${e.message}`);
        process.exit(1);
    }

    const cats    = lhData.categories;
    const url     = lhData.finalUrl || lhData.requestedUrl || '';
    const results = CATEGORIES.map(cat => {
        const raw   = cats[cat.id];
        const score = raw ? Math.round(raw.score * 100) : 0;
        const prev  = (prevData && prevData.scores && prevData.scores[pageName])
                      ? (prevData.scores[pageName][cat.label] ?? null)
                      : null;
        return { catId: cat.id, label: cat.label, score, prev };
    });

    allPages.push({ pageName, label, url, results });

    const scoreStr = results.map(r => `${r.label}: ${r.score}`).join(' | ');
    console.log(`[Lighthouse] ${label} → ${scoreStr}`);
}

// ── Generate JUnit XML ────────────────────────────────────────────────────────
let suitesXml = '';
for (const { pageName, label, results } of allPages) {
    const failures = results.filter(r => r.score < threshold).length;
    let casesXml   = '';
    for (const { label: catLabel, score } of results) {
        const time = (score / 100).toFixed(2);
        if (score < threshold) {
            casesXml +=
                `    <testcase name="${catLabel}" classname="lighthouse.${pageName}" time="${time}">\n` +
                `      <failure message="Score ${score}/100 is below threshold ${threshold}/100">` +
                `Score ${score}/100 is below the minimum threshold of ${threshold}/100` +
                `</failure>\n    </testcase>\n`;
        } else {
            casesXml +=
                `    <testcase name="${catLabel}" classname="lighthouse.${pageName}" time="${time}"/>\n`;
        }
    }
    suitesXml +=
        `  <testsuite name="Lighthouse: ${label}" tests="${results.length}" failures="${failures}">\n` +
        casesXml +
        `  </testsuite>\n`;
}

fs.writeFileSync('lighthouse-junit.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suitesXml}</testsuites>\n`, 'utf8');

// ── Generate rich static HTML summary ────────────────────────────────────────
function cls(s)  { return s >= 90 ? 'good' : s >= 50 ? 'avg' : 'bad'; }
function clsHex(s) { return s >= 90 ? '#0cce6b' : s >= 50 ? '#ffa400' : '#ff4e42'; }
function clsBg(s)  { return s >= 90 ? '#f0fdf6' : s >= 50 ? '#fffbf0' : '#fff5f5'; }
function clsFg(s)  { return s >= 90 ? '#0a6b3a' : s >= 50 ? '#7a4d00' : '#a81a0e'; }

function deltaHtml(score, prev) {
    if (prev === null || prev === undefined) return '';
    const d = score - prev;
    if (d > 0) return `<span class="delta up">&#9650;${d}</span>`;
    if (d < 0) return `<span class="delta dn">&#9660;${Math.abs(d)}</span>`;
    return `<span class="delta eq">&#9644;</span>`;
}

const date = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

const cards = allPages.map(({ pageName, label, url, results }) => {
    const pass    = results.every(r => r.score >= threshold);
    const badgeCls = pass ? 'badge-pass' : 'badge-fail';
    const badgeTxt = pass ? 'PASS' : 'FAIL';
    const cardCls  = pass ? 'card-pass' : 'card-fail';

    const circles = results.map(({ label: catLabel, score, prev }) => {
        const dh = deltaHtml(score, prev);
        const prevLine = (prev !== null && prev !== undefined)
            ? `<div class="prev">was&nbsp;${prev}</div>` : '';
        return `
        <div class="score-wrap">
          <div class="circle" style="border-color:${clsHex(score)};background:${clsBg(score)};color:${clsFg(score)}">${score}</div>
          <div class="delta-row">${dh || '&nbsp;'}</div>
          ${prevLine}
          <div class="cat">${catLabel}</div>
        </div>`;
    }).join('');

    return `
  <div class="card ${cardCls}">
    <div class="card-top">
      <div>
        <span class="page-title">${label}</span>
        ${url ? `<span class="page-url">${url}</span>` : ''}
      </div>
      <span class="badge ${badgeCls}">${badgeTxt}</span>
    </div>
    <div class="circles">${circles}
    </div>
  </div>`;
}).join('\n');

const prevLine = prevData
    ? `&#128257;&nbsp;Compared to: <strong>${prevData.buildInfo || prevData.timestamp}</strong>`
    : `&#128310;&nbsp;No previous build data &mdash; comparison will appear from next run`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Lighthouse Audit Summary</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
       background: #f0f2f5; color: #222; padding: 1.8rem; }
h1   { font-size: 1.7rem; font-weight: 800; color: #1a1a2e; margin-bottom: .4rem; }

.meta { display: flex; flex-wrap: wrap; gap: .6rem 1.4rem;
        font-size: .85rem; color: #555; margin-bottom: 1.6rem; align-items: center; }
.chip { background: #e8f0fe; color: #1a73e8; padding: 3px 10px;
        border-radius: 20px; font-weight: 700; }
.prev-line { color: #777; font-style: italic; }

.card { background: #fff; border-radius: 12px; padding: 1.4rem 1.6rem;
        margin-bottom: 1.1rem; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
.card-pass { border-left: 5px solid #0cce6b; }
.card-fail { border-left: 5px solid #ff4e42; }

.card-top { display: flex; justify-content: space-between;
            align-items: flex-start; margin-bottom: 1.1rem; }
.page-title { font-size: 1.05rem; font-weight: 700; color: #1a1a2e; }
.page-url   { display: block; font-size: .78rem; color: #999; margin-top: 3px; }

.badge { padding: 4px 14px; border-radius: 20px; font-size: .78rem;
         font-weight: 800; letter-spacing: .06em; }
.badge-pass { background: #e6faf0; color: #0a6b3a; border: 1px solid #0cce6b; }
.badge-fail { background: #fff0ef; color: #a81a0e; border: 1px solid #ff4e42; }

.circles { display: flex; flex-wrap: wrap; gap: 1.2rem; }
.score-wrap { text-align: center; min-width: 100px; }

.circle { width: 90px; height: 90px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.85rem; font-weight: 900; margin: 0 auto;
          border: 5px solid; }

.delta-row { margin-top: 5px; font-size: .85rem; font-weight: 700; min-height: 1.2em; }
.delta.up { color: #0a6b3a; }
.delta.dn { color: #a81a0e; }
.delta.eq { color: #aaa; }

.prev { font-size: .73rem; color: #bbb; margin-top: 1px; }
.cat  { font-size: .74rem; font-weight: 700; color: #666; margin-top: 6px;
        text-transform: uppercase; letter-spacing: .05em; }

.legend { margin-top: 1.4rem; background: #fff; border-radius: 10px;
          padding: .9rem 1.4rem; box-shadow: 0 1px 5px rgba(0,0,0,.06);
          display: flex; flex-wrap: wrap; gap: .5rem 2rem;
          font-size: .82rem; color: #555; }
.dot { display: inline-block; width: 11px; height: 11px; border-radius: 50%;
       margin-right: 5px; vertical-align: middle; }
</style>
</head>
<body>
<h1>&#127874; Lighthouse Audit Summary</h1>
<div class="meta">
  <span>Generated: ${date}</span>
  <span class="chip">Threshold: ${threshold}/100</span>
  <span class="prev-line">${prevLine}</span>
</div>
${cards}
<div class="legend">
  <span><span class="dot" style="background:#0cce6b"></span>Good &ge;&nbsp;90</span>
  <span><span class="dot" style="background:#ffa400"></span>Needs improvement 50&ndash;89</span>
  <span><span class="dot" style="background:#ff4e42"></span>Poor &lt;&nbsp;50</span>
  <span style="color:#888">&#9650;&nbsp;improved &nbsp;&#9660;&nbsp;declined &nbsp;&#9644;&nbsp;no change vs previous build</span>
</div>
</body>
</html>`;

fs.writeFileSync('lighthouse-summary.html', html, 'utf8');

// ── Save current scores for next build ───────────────────────────────────────
const currentScores = {};
for (const { pageName, results } of allPages) {
    currentScores[pageName] = {};
    for (const { label, score } of results) {
        currentScores[pageName][label] = score;
    }
}
const buildInfo = BUILD_NUM ? `Build #${BUILD_NUM} (${date})` : date;
fs.writeFileSync(HISTORY_FILE, JSON.stringify({ buildInfo, timestamp: date, scores: currentScores }, null, 2), 'utf8');

console.log(`\nOutputs written (${allPages.length} page(s), threshold: ${threshold}/100):`);
console.log('  lighthouse-junit.xml');
console.log('  lighthouse-summary.html');
console.log(`  ${HISTORY_FILE}  ← saved for next build delta`);

