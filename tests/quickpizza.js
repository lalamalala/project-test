// -----------------------------------------------------------------------------
// QuickPizza load test  -  https://quickpizza.grafana.com
//
// Admin user journey per VU iteration:
//   1. Main Page        GET  /
//   2. Admin Login Page GET  /admin
//   3. Admin Page       POST /api/admin/login?user=admin&password=admin
//   4. Main Page        GET  /
//
// Run locally:
//   k6 run tests/quickpizza.js
//
// Override target URL and load parameters:
//   k6 run -e BASE_URL=https://quickpizza.grafana.com ^
//           -e BASE_VUS=5 -e PEAK_VUS=20 ^
//           tests/quickpizza.js
//
// Override admin credentials (optional, defaults to admin/admin):
//   k6 run -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=admin tests/quickpizza.js
// -----------------------------------------------------------------------------

import { sleep, group } from 'k6';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

import { options as loadOptions } from '../config/options.js';
import { randomIntBetween } from '../lib/helpers.js';
import {
    visitMainPage,
    visitAdminPage,
    adminLogin,
} from '../lib/api.js';

// Re-export options so k6 picks them up
export const options = loadOptions;

// -- Default (VU) function ----------------------------------------------------

export default function () {

    // -- 1. Main Page ---------------------------------------------------------
    group('Main Page', () => {
        visitMainPage();
    });

    sleep(randomIntBetween(1, 2));

    // -- 2. Admin Login Page  (click "Click here" link on the main page) ------
    group('Admin Login Page', () => {
        visitAdminPage();
    });

    sleep(randomIntBetween(1, 2));

    // -- 3. Admin Page  (fill Username/Password and click Sign in) ------------
    let adminToken;

    group('Admin Page', () => {
        const res = adminLogin();
        adminToken = res.json('token');
    });

    if (!adminToken) {
        console.warn(`[VU ${__VU}] admin login failed, skipping iteration`);
        return;
    }

    sleep(randomIntBetween(1, 2));

    // -- 4. Main Page  (click "Back to main page") ----------------------------
    group('Main Page', () => {
        visitMainPage();
    });

    sleep(randomIntBetween(1, 3));
}

// -- Summary (runs once after the test, on the k6 process) -------------------
// Generates an HTML report, a JUnit XML (consumed by Jenkins junit step),
// and prints the standard text table to stdout.

function generateJUnitXml(data) {
    const duration = (data.state.testRunDuration / 1000).toFixed(3);

    // Real avg HTTP response time (ms → s) — used as `time` per testcase so that
    // the Jenkins Performance Plugin can build response-time trend charts across builds.
    const avgReqDurationSec = (
        (data.metrics['http_req_duration']?.values?.avg || 0) / 1000
    ).toFixed(3);

    // p90 and p95 go into the testsuite `properties` block for extra context.
    const p90  = (data.metrics['http_req_duration']?.values?.['p(90)'] || 0).toFixed(2);
    const p95  = (data.metrics['http_req_duration']?.values?.['p(95)'] || 0).toFixed(2);
    const errRate = (data.metrics['http_req_failed']?.values?.rate || 0).toFixed(4);

    let testcases = '';
    let totalTests = 0;
    let totalFailures = 0;

    function processGroup(group, parentName) {
        const prefix = parentName ? `${parentName} > ${group.name}` : group.name;
        for (const check of group.checks) {
            totalTests++;
            const name = `${prefix} > ${check.name}`;
            if (check.fails > 0) {
                totalFailures++;
                testcases += `    <testcase name="${name}" classname="k6" time="${avgReqDurationSec}">\n` +
                    `      <failure message="${check.fails} failure(s) out of ${check.passes + check.fails} checks">` +
                    `${check.fails} failure(s) out of ${check.passes + check.fails} checks` +
                    `</failure>\n    </testcase>\n`;
            } else {
                testcases += `    <testcase name="${name}" classname="k6" time="${avgReqDurationSec}"/>\n`;
            }
        }
        for (const sub of group.groups) {
            processGroup(sub, prefix);
        }
    }

    processGroup(data.root_group, '');

    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<testsuites>\n` +
        `  <testsuite name="k6" tests="${totalTests}" failures="${totalFailures}" time="${duration}">\n` +
        `    <properties>\n` +
        `      <property name="http_req_duration_avg_ms" value="${(avgReqDurationSec * 1000).toFixed(2)}"/>\n` +
        `      <property name="http_req_duration_p90_ms" value="${p90}"/>\n` +
        `      <property name="http_req_duration_p95_ms" value="${p95}"/>\n` +
        `      <property name="http_req_failed_rate"     value="${errRate}"/>\n` +
        `    </properties>\n` +
        testcases +
        `  </testsuite>\n` +
        `</testsuites>\n`;
}

export function handleSummary(data) {
    return {
        'k6-report.html': htmlReport(data),
        'k6-junit.xml':   generateJUnitXml(data),
        stdout: textSummary(data, { indent: ' ', enableColors: false }),
    };
}
