// ─────────────────────────────────────────────────────────────────────────────
// QuickPizza API client
// All requests go to BASE_URL (env var). Falls back to the public demo server.
// ─────────────────────────────────────────────────────────────────────────────
import http  from 'k6/http';
import { check } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'https://quickpizza.grafana.com').replace(/\/$/, '');

// ── Pages & Admin ─────────────────────────────────────────────────────────────

/**
 * GET /
 * Open the QuickPizza main page.
 */
export function visitMainPage() {
    const res = http.get(
        `${BASE_URL}/`,
        { tags: { name: 'Main Page' } }
    );

    check(res, {
        'main page: status 200':      (r) => r.status === 200,
        'main page: has QuickPizza':  (r) => r.body.includes('QuickPizza'),
    });

    return res;
}

/**
 * GET /admin
 * Navigate to the admin login page  (the "Click here" link on the main page).
 */
export function visitAdminPage() {
    const res = http.get(
        `${BASE_URL}/admin`,
        { tags: { name: 'Admin Login Page' } }
    );

    check(res, {
        'admin page: status 200': (r) => r.status === 200,
        'admin page: has form':   (r) => r.body.includes('admin') || r.body.includes('Sign in'),
    });

    return res;
}

/**
 * POST /api/admin/login?user=<username>&password=<password>
 * Submit the admin Sign-in form.
 * Credentials default to the demo values admin / admin.
 * Returns the full response; token is at res.json('token').
 */
export function adminLogin(username = __ENV.ADMIN_USERNAME || 'admin',
                           password = __ENV.ADMIN_PASSWORD || 'admin') {
    const res = http.post(
        `${BASE_URL}/api/admin/login?user=${username}&password=${password}`,
        null,
        { tags: { name: 'Admin Page' } }
    );

    check(res, {
        'admin login: status 200':  (r) => r.status === 200,
        'admin login: has token':   (r) => r.json('token') !== undefined,
    });

    return res;
}
