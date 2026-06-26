const { test, expect } = require('@playwright/test');

// Configurable thresholds via env vars
const T = {
    pageLoad: Number(process.env.PW_THRESHOLD_LOAD || '5000'),  // 5 s
    ttfb:     Number(process.env.PW_THRESHOLD_TTFB || '800'),   // 800 ms
    lcp:      Number(process.env.PW_THRESHOLD_LCP  || '2500'),  // 2.5 s (Google "Good")
    login:    Number(process.env.PW_THRESHOLD_LOGIN || '3000'),  // 3 s
};

// --- helpers -----------------------------------------------------------------

async function getNavTiming(page) {
    return page.evaluate(() => {
        const [nav] = performance.getEntriesByType('navigation');
        if (!nav) return null;
        return {
            ttfb:           Math.round(nav.responseStart  - nav.startTime),
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

    test('1. Main page load', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const timing = await getNavTiming(page);
        const lcp    = await getLCP(page);

        logMetrics('Main /', timing, { LCP: lcp });

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

        expect(loginMs, `Login response < ${T.login}ms`).toBeLessThan(T.login);
    });
});
