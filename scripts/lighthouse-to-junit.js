/**
 * lighthouse-to-junit.js
 *
 * Reads all lh-<page>.report.json files produced by the Lighthouse CLI
 * and converts them to a JUnit XML report (lighthouse-junit.xml).
 *
 * Each Lighthouse category (Performance, Accessibility, Best Practices, SEO)
 * becomes a <testcase>. The `time` attribute holds score / 100 so that the
 * Jenkins Performance Plugin can build score-trend charts across builds.
 *
 * Usage:
 *   node scripts/lighthouse-to-junit.js [threshold]
 *
 *   threshold – minimum acceptable score 0-100 (default: 80)
 *
 * Expected input files (created by Lighthouse CLI with --output json):
 *   lh-main.report.json
 *   lh-admin-login.report.json
 */

'use strict';

const fs = require('fs');

const threshold = parseInt(process.argv[2] || '80', 10);

// Human-readable labels for page names used in --output-path
const PAGE_LABELS = {
    'main':        'Main Page',
    'admin-login': 'Admin Login Page',
};

// Lighthouse categories to extract (key = Lighthouse category id)
const CATEGORIES = [
    { id: 'performance',    label: 'Performance'    },
    { id: 'accessibility',  label: 'Accessibility'  },
    { id: 'best-practices', label: 'Best Practices' },
    { id: 'seo',            label: 'SEO'            },
];

// ── Find all Lighthouse JSON report files in cwd ──────────────────────────────
const FILE_RE = /^lh-(.+)\.report\.json$/;
const files = fs.readdirSync('.').filter(f => FILE_RE.test(f)).sort();

if (files.length === 0) {
    console.warn('No lh-*.report.json files found – writing empty outputs.');
    fs.writeFileSync('lighthouse-junit.xml',
        '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites/>\n', 'utf8');
    fs.writeFileSync('lighthouse-summary.html',
        '<!DOCTYPE html><html><body><p>No Lighthouse reports found.</p></body></html>', 'utf8');
    process.exit(0);
}

// ── Collect scores for every page ─────────────────────────────────────────────
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
    const results = CATEGORIES.map(cat => {
        const raw   = cats[cat.id];
        const score = raw ? Math.round(raw.score * 100) : 0;
        return { label: cat.label, score };
    });

    allPages.push({ pageName, label, results });

    const scoreStr = results.map(r => `${r.label}: ${r.score}`).join(' | ');
    console.log(`[Lighthouse] ${label} → ${scoreStr}`);
}

// ── Generate JUnit XML ─────────────────────────────────────────────────────────
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

// ── Generate static HTML summary (no JavaScript – works inside Jenkins CSP) ────
function scoreClass(s) { return s >= 90 ? 'good' : s >= 50 ? 'avg' : 'bad'; }

const date = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

const tableRows = allPages.map(({ label, results }) => {
    const cells = results.map(({ score }) =>
        `<td class="${scoreClass(score)}">${score}</td>`
    ).join('');
    return `    <tr><td class="name">${label}</td>${cells}</tr>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Lighthouse Audit Summary</title>
<style>
  body  { font-family: Arial, sans-serif; margin: 2rem; color: #333; }
  h1    { font-size: 1.4rem; margin-bottom: .25rem; }
  p     { color: #666; font-size: .9rem; margin-top: 0; }
  table { border-collapse: collapse; margin-top: 1.2rem; }
  th, td { border: 1px solid #ccc; padding: 10px 20px;
           text-align: center; min-width: 130px; }
  th    { background: #f0f0f0; font-weight: 600; }
  td.name { text-align: left; font-weight: 600; background: #fafafa; min-width: 180px; }
  .good { background: #c8f5c8; color: #1a7a1a; font-weight: 700; }
  .avg  { background: #fff3c8; color: #7a5a00; font-weight: 700; }
  .bad  { background: #ffd0cc; color: #7a1a1a; font-weight: 700; }
  .legend { margin-top: 1.5rem; font-size: .85rem; color: #555; }
  .dot  { display: inline-block; width: 12px; height: 12px;
          border-radius: 2px; margin-right: 4px; vertical-align: middle; }
</style>
</head>
<body>
<h1>Lighthouse Audit Summary</h1>
<p>Generated: ${date} &nbsp;|&nbsp; Pass threshold: ${threshold} / 100</p>
<table>
  <tr>
    <th>Page</th>
    <th>Performance</th>
    <th>Accessibility</th>
    <th>Best Practices</th>
    <th>SEO</th>
  </tr>
${tableRows}
</table>
<div class="legend">
  <span class="dot" style="background:#c8f5c8"></span>Good (&ge; 90)&nbsp;&nbsp;
  <span class="dot" style="background:#fff3c8"></span>Needs improvement (50 &ndash; 89)&nbsp;&nbsp;
  <span class="dot" style="background:#ffd0cc"></span>Poor (&lt; 50)
</div>
</body>
</html>`;

fs.writeFileSync('lighthouse-summary.html', html, 'utf8');

console.log(`\nOutputs written (${allPages.length} page(s), threshold: ${threshold}/100):`);
console.log('  lighthouse-junit.xml');
console.log('  lighthouse-summary.html');

const threshold = parseInt(process.argv[2] || '80', 10);

// Human-readable labels for page names used in --output-path
const PAGE_LABELS = {
    'main':        'Main Page',
    'admin-login': 'Admin Login Page',
};

// Lighthouse categories to extract (key = Lighthouse category id)
const CATEGORIES = [
    { id: 'performance',    label: 'Performance'    },
    { id: 'accessibility',  label: 'Accessibility'  },
    { id: 'best-practices', label: 'Best Practices' },
    { id: 'seo',            label: 'SEO'            },
];

// ── Find all Lighthouse JSON report files in cwd ──────────────────────────────
const FILE_RE = /^lh-(.+)\.report\.json$/;
const files = fs.readdirSync('.')
    .filter(f => FILE_RE.test(f))
    .sort();

if (files.length === 0) {
    console.warn('No lh-*.report.json files found – writing empty lighthouse-junit.xml.');
    fs.writeFileSync('lighthouse-junit.xml',
        '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites/>\n', 'utf8');
    process.exit(0);
}

// ── Build JUnit XML ────────────────────────────────────────────────────────────
let suitesXml = '';

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

    const cats = lhData.categories;

    // Collect scores
    const results = CATEGORIES.map(cat => {
        const raw   = cats[cat.id];
        const score = raw ? Math.round(raw.score * 100) : 0;
        return { label: cat.label, score };
    });

    const failures = results.filter(r => r.score < threshold).length;

    // Print summary to console for Jenkins log readability
    const scoreStr = results.map(r => `${r.label}: ${r.score}`).join(' | ');
    console.log(`[Lighthouse] ${label} → ${scoreStr}`);

    // Build <testsuite>
    let casesXml = '';
    for (const { label: catLabel, score } of results) {
        const time = (score / 100).toFixed(2);
        if (score < threshold) {
            casesXml +=
                `    <testcase name="${catLabel}" classname="lighthouse.${pageName}" time="${time}">\n` +
                `      <failure message="Score ${score}/100 is below threshold ${threshold}/100">` +
                `Score ${score}/100 is below the minimum threshold of ${threshold}/100` +
                `</failure>\n` +
                `    </testcase>\n`;
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

const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites>\n` +
    suitesXml +
    `</testsuites>\n`;

fs.writeFileSync('lighthouse-junit.xml', xml, 'utf8');
console.log(`\nlighthouse-junit.xml written (${files.length} page(s), threshold: ${threshold}/100)`);
