const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const METRICS_DIR  = path.resolve(__dirname, '../../reports/playwright');
const METRICS_FILE = path.join(METRICS_DIR, 'metrics.json');

// Configurable thresholds (override via env vars in Jenkins build parameters)
const T = {
    pageLoad: Number(process.env.PW_THRESHOLD_LOAD  || '6000'),  // 6 s cold-start CI
    ttfb:     Number(process.env.PW_THRESHOLD_TTFB  || '800'),   // 800 ms server time
    fcp:      Number(process.env.PW_THRESHOLD_FCP   || '6000'),  // 6 s cold-start CI (override with PW_THRESHOLD_FCP for warmer envs)
    lcp:      Number(process.env.PW_THRESHOLD_LCP   || '6000'),  // 6 s cold-start CI
    login:    Number(process.env.PW_THRESHOLD_LOGIN || '3000'),  // 3 s
};

// Metrics collected per test; flushed to metrics.json in afterAll
const metricsLog = {};

// ---------------------------------------------------------------------------
// Web Vitals helpers
// ---------------------------------------------------------------------------

async function getNavTiming(page) {
    return page.evaluate(() => {
        const [nav] = performance.getEntriesByType('navigation');
        if (!nav) return null;
        return {
            // TTFB = server response time only (excludes DNS + TLS on cold start)
            ttfb:        Math.round(nav.responseStart - nav.requestStart),
            domComplete: Math.round(nav.domComplete   - nav.startTime),
            pageLoad:    Math.round(nav.loadEventEnd  - nav.startTime),
        };
    });
}

async function getLCP(page) {
    return page.evaluate(() => new Promise(resolve => {
        if (!('PerformanceObserver' in window)) return resolve(null);
        let done = false;
        const obs = new PerformanceObserver(list => {
            const entries = list.getEntries();
            if (entries.length && !done) {
                done = true;
                obs.disconnect();
                resolve(Math.round(entries[entries.length - 1].startTime));
            }
        });
        try {
            obs.observe({ type: 'largest-contentful-paint', buffered: true });
        } catch (_) { return resolve(null); }
        setTimeout(() => { if (!done) { obs.disconnect(); resolve(null); } }, 3000);
    }));
}

async function getFCP(page) {
    return page.evaluate(() => new Promise(resolve => {
        if (!('PerformanceObserver' in window)) return resolve(null);
        const obs = new PerformanceObserver(list => {
            const fcp = list.getEntries().find(e => e.name === 'first-contentful-paint');
            if (fcp) { obs.disconnect(); resolve(Math.round(fcp.startTime)); }
        });
        try {
            obs.observe({ type: 'paint', buffered: true });
        } catch (_) { return resolve(null); }
        setTimeout(() => { obs.disconnect(); resolve(null); }, 3000);
    }));
}

function logMetrics(label, timing, extra = {}) {
    const parts = [`[${label}]`];
    if (timing) {
        parts.push(`TTFB: ${timing.ttfb}ms`);
        parts.push(`DOM: ${timing.domComplete}ms`);
        parts.push(`Load: ${timing.pageLoad}ms`);
    }
    for (const [k, v] of Object.entries(extra)) {
        if (v !== null && v !== undefined) parts.push(`${k}: ${v}ms`);
    }
    console.log(parts.join(' | '));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('QuickPizza – Page Transition Performance', () => {

    // Attach metrics JSON to Playwright HTML report; record pass/fail status
    test.afterEach(async ({}, testInfo) => {
        const entry = metricsLog[testInfo.title];
        if (!entry) return;
        entry.passed   = testInfo.status === 'passed';
        // Collect all soft + hard assertion failure messages
        entry.failMsgs = testInfo.errors.map(e => e.message?.split('\n')[0]).filter(Boolean);
        entry.failMsg  = entry.failMsgs[0] ?? null;
        // Attach raw metrics so they are downloadable from the Playwright HTML report
        await testInfo.attach('performance-metrics', {
            body: JSON.stringify({
                ttfb: entry.ttfb, domComplete: entry.domComplete,
                pageLoad: entry.pageLoad, fcp: entry.fcp,
                lcp: entry.lcp, transition: entry.transition, actionMs: entry.actionMs,
            }, null, 2),
            contentType: 'application/json',
        });
    });

    test.afterAll(() => {
        try {
            if (!fs.existsSync(METRICS_DIR)) fs.mkdirSync(METRICS_DIR, { recursive: true });
            fs.writeFileSync(METRICS_FILE, JSON.stringify({
                generatedAt: new Date().toISOString(),
                thresholds:  T,
                tests:       Object.values(metricsLog),
            }, null, 2), 'utf8');
        } catch (e) {
            console.warn('metrics.json write failed:', e.message);
        }
    });

    test('1. Main page load', async ({ page }) => {
        const entry = metricsLog['1. Main page load'] = { name: '1. Main page load', url: '/' };

        await test.step('Load page', async () => {
            await page.goto('/');
            await page.waitForLoadState('networkidle');
            await expect(page).toHaveTitle(/.+/);
        });

        const { timing, fcp, lcp } = await test.step('Collect Web Vitals', async () => {
            const timing = await getNavTiming(page);
            const fcp    = await getFCP(page);
            const lcp    = await getLCP(page);
            logMetrics('Main /', timing, { FCP: fcp, LCP: lcp });
            return { timing, fcp, lcp };
        });

        entry.ttfb        = timing?.ttfb        ?? null;
        entry.domComplete = timing?.domComplete  ?? null;
        entry.pageLoad    = timing?.pageLoad     ?? null;
        entry.fcp         = fcp;
        entry.lcp         = lcp;
        entry.transition  = null;
        entry.actionMs    = null;

        await test.step('Assert performance thresholds', async () => {
            if (timing) {
                expect.soft(timing.ttfb,     `TTFB ${timing.ttfb}ms < ${T.ttfb}ms`).toBeLessThan(T.ttfb);
                expect.soft(timing.pageLoad, `Load ${timing.pageLoad}ms < ${T.pageLoad}ms`).toBeLessThan(T.pageLoad);
            }
            if (fcp !== null) expect.soft(fcp, `FCP ${fcp}ms < ${T.fcp}ms`).toBeLessThan(T.fcp);
            if (lcp !== null) expect.soft(lcp, `LCP ${lcp}ms < ${T.lcp}ms`).toBeLessThan(T.lcp);
        });
    });

    test('2. Navigate to Admin Login page', async ({ page }) => {
        const entry = metricsLog['2. Navigate to Admin Login page'] = {
            name: '2. Navigate to Admin Login page', url: '/admin',
        };

        const transitionMs = await test.step('Navigate from / to /admin', async () => {
            await page.goto('/');
            await page.waitForLoadState('networkidle');
            const t0 = Date.now();
            await page.goto('/admin');
            await page.waitForLoadState('networkidle');
            return Date.now() - t0;
        });

        const { timing, fcp, lcp } = await test.step('Collect Web Vitals', async () => {
            const timing = await getNavTiming(page);
            const fcp    = await getFCP(page);
            const lcp    = await getLCP(page);
            logMetrics('/admin', timing, { Transition: transitionMs, FCP: fcp, LCP: lcp });
            return { timing, fcp, lcp };
        });

        entry.ttfb        = timing?.ttfb        ?? null;
        entry.domComplete = timing?.domComplete  ?? null;
        entry.pageLoad    = timing?.pageLoad     ?? null;
        entry.fcp         = fcp;
        entry.lcp         = lcp;
        entry.transition  = transitionMs;
        entry.actionMs    = null;

        await test.step('Assert login form visible', async () => {
            await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 5000 });
        });

        await test.step('Assert performance thresholds', async () => {
            expect.soft(transitionMs, `Transition ${transitionMs}ms < ${T.pageLoad}ms`).toBeLessThan(T.pageLoad);
            if (timing) {
                expect.soft(timing.ttfb,     `TTFB ${timing.ttfb}ms < ${T.ttfb}ms`).toBeLessThan(T.ttfb);
                expect.soft(timing.pageLoad, `Load ${timing.pageLoad}ms < ${T.pageLoad}ms`).toBeLessThan(T.pageLoad);
            }
            if (fcp !== null) expect.soft(fcp, `FCP ${fcp}ms < ${T.fcp}ms`).toBeLessThan(T.fcp);
            if (lcp !== null) expect.soft(lcp, `LCP ${lcp}ms < ${T.lcp}ms`).toBeLessThan(T.lcp);
        });
    });

    test('3. Login form submission response time', async ({ page }) => {
        const entry = metricsLog['3. Login form submission response time'] = {
            name: '3. Login form submission response time', url: '/admin (submit)',
        };

        await test.step('Open admin login page', async () => {
            await page.goto('/admin');
            await page.waitForLoadState('networkidle');
        });

        const loginMs = await test.step('Submit login form', async () => {
            const username = process.env.PW_ADMIN_USER || 'admin';
            const password = process.env.PW_ADMIN_PASS || 'admin';
            await page.locator('input[type="text"], input[name="username"]').first().fill(username);
            await page.locator('input[type="password"]').first().fill(password);
            const t0 = Date.now();
            await page.locator('button[type="submit"], input[type="submit"]').first().click();
            try {
                await page.waitForLoadState('networkidle', { timeout: 8000 });
            } catch (_) { /* XHR-based login without full navigation */ }
            return Date.now() - t0;
        });

        const timing = await test.step('Collect Nav Timing', async () => {
            const timing = await getNavTiming(page);
            logMetrics('Login submit', timing, { 'Action time': loginMs });
            return timing;
        });

        entry.ttfb        = timing?.ttfb        ?? null;
        entry.domComplete = timing?.domComplete  ?? null;
        entry.pageLoad    = timing?.pageLoad     ?? null;
        entry.fcp         = null;
        entry.lcp         = null;
        entry.transition  = null;
        entry.actionMs    = loginMs;

        await test.step('Assert login response time', async () => {
            expect.soft(loginMs, `Login ${loginMs}ms < ${T.login}ms`).toBeLessThan(T.login);
        });
    });
});
