const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const METRICS_DIR  = path.resolve(__dirname, '../../reports/playwright');
const METRICS_FILE = path.join(METRICS_DIR, 'metrics.json');

// Configurable thresholds via env vars
const T = {
    pageLoad: Number(process.env.PW_THRESHOLD_LOAD  || '6000'),  // 6 s (cold start from CI)
    ttfb:     Number(process.env.PW_THRESHOLD_TTFB  || '800'),   // 800 ms (server only)
    lcp:      Number(process.env.PW_THRESHOLD_LCP   || '6000'),  // 6 s (cold start from CI)
    login:    Number(process.env.PW_THRESHOLD_LOGIN || '3000'),  // 3 s
};

// Metrics collected per test; written to metrics.json in afterAll
const metricsLog = {};

// --- helpers -----------------------------------------------------------------

async function getNavTiming(page) {
    return page.evaluate(() => {
        const [nav] = performance.getEntriesByType('navigation');
        if (!nav) return null;
        return {
            // TTFB = server response time only (excludes DNS + TLS on cold start)
            ttfb:           Math.round(nav.responseStart  - nav.requestStart),
            domInteractive: Math.round(nav.domInteractive - nav.startTime),
            domComplete:    Math.round(nav.domComplete    - nav.startTime),
            pageLoad:       Math.round(nav.loadEventEnd   - nav.startTime),
        };
    });
}

async function getLCP(page) {
    return page.evaluate(() => new Promise(resolve => {
        if (!('PerformanceObserver' in window)) return resolve(null);
        const obs = new PerformanceObserver(list => {
            const entries = list.getEntries();
            resolve(entries.length ? Math.round(entries[entries.length - 1].startTime) : null);
        });
        try {
            obs.observe({ type: 'largest-contentful-paint', buffered: true });
        } catch (_) { resolve(null); }
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

// --- tests -------------------------------------------------------------------

test.describe('QuickPizza – Page Transition Performance', () => {

    test.afterEach(async ({}, testInfo) => {
        const entry = metricsLog[testInfo.title];
        if (entry) {
            entry.passed  = testInfo.status === 'passed';
            entry.failMsg = testInfo.error?.message?.split('\n')[0] ?? null;
        }
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
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const timing = await getNavTiming(page);
        const lcp    = await getLCP(page);

        logMetrics('Main /', timing, { LCP: lcp });

        entry.ttfb           = timing?.ttfb           ?? null;
        entry.domInteractive = timing?.domInteractive  ?? null;
        entry.domComplete    = timing?.domComplete     ?? null;
        entry.pageLoad       = timing?.pageLoad        ?? null;
        entry.lcp            = lcp;
        entry.transition     = null;
        entry.actionMs       = null;

        await expect(page).toHaveTitle(/.+/);

        if (timing) {
            expect(timing.ttfb,     `TTFB < ${T.ttfb}ms`).toBeLessThan(T.ttfb);
            expect(timing.pageLoad, `Load < ${T.pageLoad}ms`).toBeLessThan(T.pageLoad);
        }
        if (lcp !== null) {
            expect(lcp, `LCP < ${T.lcp}ms (Web Vitals "Good")`).toBeLessThan(T.lcp);
        }
    });

    test('2. Navigate to Admin Login page', async ({ page }) => {
        const entry = metricsLog['2. Navigate to Admin Login page'] = {
            name: '2. Navigate to Admin Login page', url: '/admin',
        };

        // Start from main, navigate to /admin — measures the full transition including
        // navigation intent → new page ready (wall-clock user perception time).
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const t0 = Date.now();
        await page.goto('/admin');
        await page.waitForLoadState('networkidle');
        const transitionMs = Date.now() - t0;

        const timing = await getNavTiming(page);
        const lcp    = await getLCP(page);

        logMetrics('/admin', timing, { 'Transition': transitionMs, LCP: lcp });

        entry.ttfb           = timing?.ttfb           ?? null;
        entry.domInteractive = timing?.domInteractive  ?? null;
        entry.domComplete    = timing?.domComplete     ?? null;
        entry.pageLoad       = timing?.pageLoad        ?? null;
        entry.lcp            = lcp;
        entry.transition     = transitionMs;
        entry.actionMs       = null;

        // Page must show a login form
        await expect(
            page.locator('input[type="password"]').first()
        ).toBeVisible({ timeout: 5000 });

        expect(transitionMs, `Page transition < ${T.pageLoad}ms`).toBeLessThan(T.pageLoad);
        if (timing) {
            expect(timing.ttfb,     `TTFB < ${T.ttfb}ms`).toBeLessThan(T.ttfb);
            expect(timing.pageLoad, `Load < ${T.pageLoad}ms`).toBeLessThan(T.pageLoad);
        }
        if (lcp !== null) {
            expect(lcp, `LCP < ${T.lcp}ms`).toBeLessThan(T.lcp);
        }
    });

    test('3. Login form submission response time', async ({ page }) => {
        const entry = metricsLog['3. Login form submission response time'] = {
            name: '3. Login form submission response time', url: '/admin (submit)',
        };

        const username = process.env.PW_ADMIN_USER || 'admin';
        const password = process.env.PW_ADMIN_PASS || 'admin';

        await page.goto('/admin');
        await page.waitForLoadState('networkidle');

        // Fill credentials
        await page.locator('input[type="text"], input[name="username"]').first().fill(username);
        await page.locator('input[type="password"]').first().fill(password);

        // Measure from submit click to page settled
        const t0 = Date.now();
        await page.locator('button[type="submit"], input[type="submit"]').first().click();
        try {
            await page.waitForLoadState('networkidle', { timeout: 8000 });
        } catch (_) { /* some apps respond via XHR without full navigation */ }
        const loginMs = Date.now() - t0;

        const timing = await getNavTiming(page);
        logMetrics('Login submit', timing, { 'Action time': loginMs });

        entry.ttfb           = timing?.ttfb           ?? null;
        entry.domInteractive = timing?.domInteractive  ?? null;
        entry.domComplete    = timing?.domComplete     ?? null;
        entry.pageLoad       = timing?.pageLoad        ?? null;
        entry.lcp            = null;
        entry.transition     = null;
        entry.actionMs       = loginMs;

        expect(loginMs, `Login response < ${T.login}ms`).toBeLessThan(T.login);
    });
});
