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

const fs   = require('fs');
const path = require('path');

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
