// ─────────────────────────────────────────────────────────────────────────────
// QuickPizza load test  –  https://quickpizza.grafana.com
//
// Admin user journey per VU iteration:
//   1. Open main page   GET  /
//   2. Click admin link  GET  /admin
//   3. Sign in as admin  POST /api/admin/login?user=admin&password=admin
//   4. Back to main page GET  /
//
// Run locally:
//   k6 run tests/quickpizza.js
//
// Override target URL and load parameters:
//   k6 run -e BASE_URL=https://quickpizza.grafana.com \
//           -e BASE_VUS=5 -e PEAK_VUS=20 \
//           tests/quickpizza.js
//
// Override admin credentials (optional, defaults to admin/admin):
//   k6 run -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=admin tests/quickpizza.js
// ─────────────────────────────────────────────────────────────────────────────

import { sleep, group } from 'k6';

import { options as loadOptions } from '../config/options.js';
import { randomIntBetween } from '../lib/helpers.js';
import {
    visitMainPage,
    visitAdminPage,
    adminLogin,
} from '../lib/api.js';

// Re-export options so k6 picks them up
export const options = loadOptions;

// ── Default (VU) function ─────────────────────────────────────────────────────

export default function () {

    // ── 1. Открываем главную страницу ────────────────────────────────────────
    group('01_main_page', () => {
        visitMainPage();
    });

    sleep(randomIntBetween(1, 2));

    // ── 2. Нажимаем «Click here» → переходим на /admin ───────────────────────
    group('02_admin_page', () => {
        visitAdminPage();
    });

    sleep(randomIntBetween(1, 2));

    // ── 3. Вводим Username: admin, Password: admin → нажимаем Sign in ─────────
    let adminToken;

    group('03_admin_sign_in', () => {
        const res = adminLogin();
        adminToken = res.json('token');
    });

    if (!adminToken) {
        console.warn(`[VU ${__VU}] admin login failed, skipping iteration`);
        return;
    }

    sleep(randomIntBetween(1, 2));

    // ── 4. Нажимаем «Back to main page» ──────────────────────────────────────
    group('04_back_to_main', () => {
        visitMainPage();
    });

    sleep(randomIntBetween(1, 3));
}
