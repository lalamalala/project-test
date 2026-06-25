/**
 * lighthouse-to-junit.js
 *
 * Reads all lh-<page>.report.json files produced by the Lighthouse CLI and:
 *   1. Writes lighthouse-junit.xml              â€“ JUnit for Jenkins trend charts
 *   2. Writes lighthouse-report/summary.html    â€“ rich static report (CSS from file)
 *   3. Writes lighthouse-report/lh-style.css    â€“ external CSS (Jenkins CSP safe)
 *   4. Writes lighthouse-scores-prev.json       â€“ saved for next build delta
 *
 * Jenkins CSP blocks inline <style> blocks but allows linked CSS files
 * served from the same origin (style-src 'self'). Putting both HTML and CSS
 * in lighthouse-report/ and using publishHTML reportDir:'lighthouse-report'
 * makes the stylesheet accessible at the same origin.
 *
 * Usage:
 *   node scripts/lighthouse-to-junit.js [threshold]
 *   threshold â€“ minimum acceptable score 0-100 (default: 80)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const threshold    = parseInt(process.argv[2] || '80', 10);
const BUILD_NUM    = process.env.BUILD_NUMBER || null;
const HISTORY_FILE = 'lighthouse-scores-prev.json';
const REPORT_DIR   = 'lighthouse-report';

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

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function scoreClass(s) { return s >= 90 ? 'good' : s >= 50 ? 'avg' : 'bad'; }

function deltaHtml(score, prev) {
    if (prev === null || prev === undefined) return '';
    const d = score - prev;
    if (d > 0) return `<span class="delta up">&#9650;${d}</span>`;
    if (d < 0) return `<span class="delta dn">&#9660;${Math.abs(d)}</span>`;
    return `<span class="delta eq">&#9644;</span>`;
}

function cleanDesc(desc) {
    if (!desc) return '';
    let s = desc.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // strip markdown links
    const dot = s.indexOf('.');
    if (dot > 0 && dot < 220) s = s.slice(0, dot + 1);
    return s.trim().slice(0, 220);
}

/** Return top failing audits for a category, sorted by impact (weight Ã— failure). */
function getFailedAudits(lhData, catId, max) {
    const cat = lhData.categories[catId];
    if (!cat) return [];
    const SKIP = new Set(['notApplicable', 'manual', 'informational']);
    return cat.auditRefs
        .map(ref => {
            const a = lhData.audits[ref.id];
            if (!a || SKIP.has(a.scoreDisplayMode)) return null;
            if (a.score === null || a.score === 1) return null;
            return {
                title:        a.title || ref.id,
                desc:         cleanDesc(a.description),
                displayValue: a.displayValue || '',
                score:        a.score,
                impact:       (ref.weight || 0) * (1 - (a.score || 0)),
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.impact - a.impact)
        .slice(0, max || 6);
}

// â”€â”€ Find report files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const FILE_RE   = /^lh-(.+)\.report\.json$/;
// Sort by position in PAGE_LABELS so pages always appear in the defined order
// (main → admin-login). Files not in PAGE_LABELS go to the end alphabetically.
const PAGE_ORDER = Object.fromEntries(Object.keys(PAGE_LABELS).map((k, i) => [k, i]));
const files = fs.readdirSync('.')
    .filter(f => FILE_RE.test(f))
    .sort((a, b) => {
        const na = a.match(FILE_RE)[1], nb = b.match(FILE_RE)[1];
        return (PAGE_ORDER[na] ?? 99) - (PAGE_ORDER[nb] ?? 99) || a.localeCompare(b);
    });

if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR);

if (files.length === 0) {
    console.warn('No lh-*.report.json files found â€“ writing empty outputs.');
    fs.writeFileSync('lighthouse-junit.xml',
        '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites/>\n', 'utf8');
    fs.writeFileSync(path.join(REPORT_DIR, 'summary.html'),
        '<!DOCTYPE html><html><body><p>No Lighthouse reports found.</p></body></html>', 'utf8');
    process.exit(0);
}

// â”€â”€ Load previous scores for delta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let prevData = null;
try {
    prevData = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    console.log(`[Lighthouse] Previous scores loaded (${prevData.buildInfo || prevData.timestamp})`);
} catch (_) {
    console.log('[Lighthouse] No previous scores â€“ first run or clean workspace.');
}

// â”€â”€ Collect scores and audit recommendations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        const failed = getFailedAudits(lhData, cat.id);
        return { catId: cat.id, label: cat.label, score, prev, failed };
    });

    allPages.push({ pageName, label, url, results });

    const scoreStr = results.map(r => `${r.label}: ${r.score}`).join(' | ');
    console.log(`[Lighthouse] ${label} â†’ ${scoreStr}`);
}

// â”€â”€ Generate JUnit XML â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ CSS (external file â€“ served from same origin, allowed by Jenkins CSP) â”€â”€â”€â”€â”€

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  background: #f0f2f5; color: #222; padding: 1.8rem;
}
h1 { font-size: 1.7rem; font-weight: 800; color: #1a1a2e; margin-bottom: .4rem; }

.meta {
  display: flex; flex-wrap: wrap; gap: .5rem 1.4rem;
  font-size: .85rem; color: #555; margin-bottom: 1.6rem; align-items: center;
}
.chip {
  background: #e8f0fe; color: #1a73e8;
  padding: 3px 10px; border-radius: 20px; font-weight: 700;
}
.prev-line { color: #777; font-style: italic; }

/* â”€â”€ Page card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
.card {
  background: #fff; border-radius: 12px; padding: 1.4rem 1.6rem;
  margin-bottom: 1.2rem; box-shadow: 0 2px 10px rgba(0,0,0,.08);
}
.card-pass { border-left: 5px solid #0cce6b; }
.card-fail { border-left: 5px solid #ff4e42; }

.card-top {
  display: flex; justify-content: space-between;
  align-items: flex-start; margin-bottom: 1.2rem;
}
.page-title { font-size: 1.1rem; font-weight: 700; color: #1a1a2e; }
.page-url   { display: block; font-size: .78rem; color: #999; margin-top: 3px; }

.badge { padding: 4px 14px; border-radius: 20px; font-size: .78rem; font-weight: 800; letter-spacing: .06em; }
.badge-pass { background: #e6faf0; color: #0a6b3a; border: 1px solid #0cce6b; }
.badge-fail { background: #fff0ef; color: #a81a0e; border: 1px solid #ff4e42; }

/* â”€â”€ Score circles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
.circles {
  display: flex; flex-wrap: wrap; gap: 1.4rem;
  padding-bottom: 1.4rem; border-bottom: 1px solid #f0f0f0; margin-bottom: 1.4rem;
}
.score-wrap { text-align: center; min-width: 100px; }
.circle {
  width: 90px; height: 90px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.85rem; font-weight: 900; margin: 0 auto; border: 5px solid;
}
.good { border-color: #0cce6b; color: #0a6b3a; background: #f0fdf6; }
.avg  { border-color: #ffa400; color: #7a4d00; background: #fffbf0; }
.bad  { border-color: #ff4e42; color: #a81a0e; background: #fff5f5; }

.delta-row { margin-top: 5px; font-size: .85rem; font-weight: 700; min-height: 1.2em; text-align: center; }
.up { color: #0a6b3a; }
.dn { color: #a81a0e; }
.eq { color: #aaa; }
.prev { font-size: .73rem; color: #bbb; margin-top: 1px; text-align: center; }
.cat  {
  font-size: .74rem; font-weight: 700; color: #555; margin-top: 6px;
  text-transform: uppercase; letter-spacing: .05em; text-align: center;
}

/* â”€â”€ Recommendations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
.recs-title {
  font-size: .95rem; font-weight: 700; color: #444; margin-bottom: .8rem;
}
.rec-cat-title {
  font-size: .8rem; font-weight: 700; color: #555;
  text-transform: uppercase; letter-spacing: .05em;
  margin: .9rem 0 .4rem; padding-bottom: .2rem; border-bottom: 1px solid #f0f0f0;
}
.rec-cat-title:first-child { margin-top: 0; }

.rec-item {
  display: flex; gap: .6rem; padding: .6rem .8rem;
  margin-bottom: .35rem; border-radius: 6px; align-items: flex-start;
}
.rec-fail { background: #fff8f8; border-left: 3px solid #ff4e42; }
.rec-warn { background: #fffdf4; border-left: 3px solid #ffa400; }

.rec-icon  { font-size: 1rem; flex-shrink: 0; margin-top: 1px; }
.rec-title { font-size: .88rem; font-weight: 600; color: #222; }
.rec-savings { font-size: .82rem; color: #1a73e8; font-weight: 700; margin-left: .5rem; }
.rec-desc  { font-size: .8rem; color: #777; margin-top: 3px; line-height: 1.4; }

.no-recs { font-size: .85rem; color: #aaa; font-style: italic; padding: .3rem 0; }


/* -- Collapsible recommendations (CSS checkbox trick, no JS) -------------- */
.rec-toggle { display: none; }
.rec-body   { display: none; }
.rec-toggle:checked + .recs-header + .rec-body { display: block; }
.recs-header {
  display: flex; align-items: center; gap: .5rem;
  cursor: pointer; user-select: none;
  font-size: .95rem; font-weight: 700; color: #444;
  padding: .5rem .7rem; border-radius: 6px; margin-bottom: 0;
  background: #f7f8fa; border: 1px solid #e5e7eb;
}
.recs-header:hover { background: #eef0f5; }
.toggle-arrow { margin-left: auto; font-size: .8rem; color: #aaa; }
.rec-body { padding-top: .6rem; }

/* -- Summary table --------------------------------------------------------- */
.summary-wrap {
  background: #fff; border-radius: 12px; padding: 1.2rem 1.6rem;
  margin-bottom: 1.4rem; box-shadow: 0 2px 10px rgba(0,0,0,.08);
}
.summary-wrap h2 { font-size: 1rem; font-weight: 700; color: #444; margin-bottom: .8rem; }
.summary-table { border-collapse: collapse; width: 100%; }
.summary-table th {
  background: #f5f6f8; font-size: .78rem; font-weight: 700;
  color: #666; text-transform: uppercase; letter-spacing: .05em;
  padding: .55rem .9rem; border: 1px solid #e8e8e8; text-align: center;
}
.summary-table th.col-page { text-align: left; min-width: 160px; }
.summary-table td { padding: .55rem .9rem; border: 1px solid #e8e8e8; text-align: center; font-weight: 700; font-size: .92rem; }
.summary-table td.pg { text-align: left; font-weight: 600; color: #333; }
.summary-table td.good { color: #0a6b3a; background: #f0fdf6; }
.summary-table td.avg  { color: #7a4d00; background: #fffbf0; }
.summary-table td.bad  { color: #a81a0e; background: #fff5f5; }
.summary-table td.st-pass { color: #0a6b3a; }
.summary-table td.st-fail { color: #a81a0e; }
.summary-table small { font-size: .72rem; font-weight: 400; opacity: .85; }
/* â”€â”€ Legend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
.legend {
  margin-top: 1.4rem; background: #fff; border-radius: 10px;
  padding: .9rem 1.4rem; box-shadow: 0 1px 5px rgba(0,0,0,.06);
  display: flex; flex-wrap: wrap; gap: .5rem 2rem; font-size: .82rem; color: #555;
}
.legend-note { color: #888; }
.dot { display: inline-block; width: 11px; height: 11px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
.dot-g { background: #0cce6b; }
.dot-o { background: #ffa400; }
.dot-r { background: #ff4e42; }
`.trim();

// â”€â”€ Build HTML â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const date = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

const cards = allPages.map(({ pageName, label, url, results }) => {
    const pass     = results.every(r => r.score >= threshold);
    const cardCls  = pass ? 'card-pass' : 'card-fail';
    const badgeCls = pass ? 'badge-pass' : 'badge-fail';
    const badgeTxt = pass ? 'PASS' : 'FAIL';

    // Score circles
    const circles = results.map(({ label: catLabel, score, prev }) => {
        const sc  = scoreClass(score);
        const dh  = deltaHtml(score, prev);
        const prevLine = (prev !== null && prev !== undefined)
            ? `<div class="prev">was&nbsp;${prev}</div>` : '';
        return `
        <div class="score-wrap">
          <div class="circle ${sc}">${score}</div>
          <div class="delta-row">${dh || '&nbsp;'}</div>
          ${prevLine}
          <div class="cat">${catLabel}</div>
        </div>`;
    }).join('');

    // Recommendation items per category
    const recGroups = results
        .filter(r => r.failed.length > 0)
        .map(({ label: catLabel, score, failed }) => {
            const items = failed.map(a => {
                const isFail = a.score !== null && a.score < 0.5;
                const recCls = isFail ? 'rec-fail' : 'rec-warn';
                const icon   = isFail ? '&#10007;' : '&#9888;';
                const savings = a.displayValue
                    ? `<span class="rec-savings">${a.displayValue}</span>` : '';
                const descLine = a.desc
                    ? `<div class="rec-desc">${a.desc}</div>` : '';
                return `
              <div class="rec-item ${recCls}">
                <span class="rec-icon">${icon}</span>
                <div>
                  <div class="rec-title">${a.title}${savings}</div>
                  ${descLine}
                </div>
              </div>`;
            }).join('');
            return `<div class="rec-cat-title">${catLabel} &mdash; score ${score}/100</div>${items}`;
        }).join('');

    const totalIssues = results.reduce((n, r) => n + r.failed.length, 0);
    const recsLabel   = totalIssues > 0
        ? `&#128270;&nbsp;Recommendations&nbsp;<span style="font-weight:400;font-size:.8rem;color:#888">(${totalIssues} issue${totalIssues > 1 ? 's' : ''})</span>`
        : `&#10003;&nbsp;All audits passed`;
    const recsSection = recGroups
        ? `<input type="checkbox" id="recs-${pageName}" class="rec-toggle">
    <label for="recs-${pageName}" class="recs-header">
      ${recsLabel}<span class="toggle-arrow">&#9660;</span>
    </label>
    <div class="rec-body">
      ${recGroups}
    </div>`
        : `<p class="no-recs">&#10003;&nbsp;All audits passed &mdash; no recommendations.</p>`;

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
    ${recsSection}
  </div>`;
}).join('\n');

const prevLine = prevData
    ? `&#128257;&nbsp;Compared to: <strong>${prevData.buildInfo || prevData.timestamp}</strong>`
    : `&#128310;&nbsp;No previous build data &mdash; delta will appear from next run`;

// Summary table rows
const summaryRows = allPages.map(({ label, results }) => {
    const pass = results.every(r => r.score >= threshold);
    const cells = results.map(({ score, prev }) => {
        const sc = scoreClass(score);
        const dh = deltaHtml(score, prev);
        return `<td class="${sc}">${score}${dh ? `<br><small>${dh}</small>` : ''}</td>`;
    }).join('');
    const stCls = pass ? 'st-pass' : 'st-fail';
    const stTxt = pass ? '&#10003; PASS' : '&#10007; FAIL';
    return `<tr><td class="pg">${label}</td>${cells}<td class="${stCls}">${stTxt}</td></tr>`;
}).join('\n');

const summaryTable = `
<div class="summary-wrap">
  <h2>&#128203;&nbsp;All Pages at a Glance</h2>
  <table class="summary-table">
    <thead><tr>
      <th class="col-page">Page</th>
      <th>Performance</th><th>Accessibility</th><th>Best Practices</th><th>SEO</th>
      <th>Status</th>
    </tr></thead>
    <tbody>
      ${summaryRows}
    </tbody>
  </table>
</div>`;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Lighthouse Audit Summary</title>
<link rel="stylesheet" href="lh-style.css">
</head>
<body>
<h1>&#127874; Lighthouse Audit Summary</h1>
<div class="meta">
  <span>Generated: ${date}</span>
  <span class="chip">Threshold: ${threshold}/100</span>
  <span class="prev-line">${prevLine}</span>
</div>
${summaryTable}
${cards}
<div class="legend">
  <span><span class="dot dot-g"></span>Good &ge;&nbsp;90</span>
  <span><span class="dot dot-o"></span>Needs improvement 50&ndash;89</span>
  <span><span class="dot dot-r"></span>Poor &lt;&nbsp;50</span>
  <span class="legend-note">&#9650;&nbsp;improved &nbsp;&#9660;&nbsp;declined &nbsp;&#9644;&nbsp;no change vs previous build</span>
</div>
</body>
</html>`;

// â”€â”€ Write output files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

fs.writeFileSync(path.join(REPORT_DIR, 'lh-style.css'), CSS,  'utf8');
fs.writeFileSync(path.join(REPORT_DIR, 'summary.html'), HTML, 'utf8');

// Save current scores for next build comparison
const currentScores = {};
for (const { pageName, results } of allPages) {
    currentScores[pageName] = {};
    for (const { label, score } of results) {
        currentScores[pageName][label] = score;
    }
}
const buildInfo = BUILD_NUM ? `Build #${BUILD_NUM} (${date})` : date;
fs.writeFileSync(HISTORY_FILE,
    JSON.stringify({ buildInfo, timestamp: date, scores: currentScores }, null, 2), 'utf8');

console.log(`\nOutputs written (${allPages.length} page(s), threshold: ${threshold}/100):`);
console.log('  lighthouse-junit.xml');
console.log(`  ${REPORT_DIR}/summary.html`);
console.log(`  ${REPORT_DIR}/lh-style.css`);
