// ─────────────────────────────────────────────────────────────────────────────
// Load-test options for QuickPizza
//
// Select a test profile with the TEST_TYPE environment variable:
//   smoke  (default) – quick sanity check: 1 VU, ramp 10s, steady 30s, ramp-down 10s
//   load             – real load:          5 VUs, ramp 30s, steady 1m,  ramp-down 10s
//
// Usage:
//   k6 run -e TEST_TYPE=smoke tests/quickpizza.js
//   k6 run -e TEST_TYPE=load  tests/quickpizza.js
// ─────────────────────────────────────────────────────────────────────────────

const profiles = {
    smoke: {
        stages: [
            { duration: '10s', target: 1 }, // ramp-up
            { duration: '30s', target: 1 }, // steady
            { duration: '10s', target: 0 }, // ramp-down
        ],
    },
    load: {
        stages: [
            { duration: '30s', target: 5 }, // ramp-up
            { duration: '1m',  target: 5 }, // steady
            { duration: '10s', target: 0 }, // ramp-down
        ],
    },
};

const profile = profiles[__ENV.TEST_TYPE] || profiles.smoke;

export const options = {
    stages: profile.stages,

    // ── Performance thresholds ────────────────────────────────────────────
    thresholds: {
        // 90 % of requests must finish under 1.5 s, 95 % under 2 s
        http_req_duration: ['p(90)<1500', 'p(95)<2000'],
        // Less than 1 % of all requests may fail
        http_req_failed: ['rate<0.01'],
        // At least 99 % of checks must pass
        checks: ['rate>=0.99'],
    },
};
