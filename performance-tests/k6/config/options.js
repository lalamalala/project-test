// ─────────────────────────────────────────────────────────────────────────────
// Load-test options for QuickPizza
//
// TEST_TYPE selects the stage profile: smoke (default) | load
//
// Smoke env vars (all optional, defaults shown):
//   SMOKE_VUS         – virtual users               (default: 1)
//   SMOKE_STEADY_TIME – steady-state duration        (default: 30s)
//
// Load env vars (all optional, defaults shown):
//   LOAD_VUS          – virtual users               (default: 5)
//   LOAD_RAMP_TIME    – ramp-up duration            (default: 30s)
//   LOAD_STEADY_TIME  – steady-state duration        (default: 1m)
// ─────────────────────────────────────────────────────────────────────────────

const TEST_TYPE       = __ENV.TEST_TYPE        || 'smoke';

const SMOKE_VUS       = parseInt(__ENV.SMOKE_VUS        || '1');
const SMOKE_STEADY    = __ENV.SMOKE_STEADY_TIME || '30s';

const LOAD_VUS        = parseInt(__ENV.LOAD_VUS         || '5');
const LOAD_RAMP       = __ENV.LOAD_RAMP_TIME   || '30s';
const LOAD_STEADY     = __ENV.LOAD_STEADY_TIME || '1m';

const RAMP_DOWN       = '10s'; // fixed ramp-down for both profiles

const profiles = {
    smoke: [
        { duration: '10s',     target: SMOKE_VUS }, // ramp-up  (fixed 10 s)
        { duration: SMOKE_STEADY, target: SMOKE_VUS }, // steady
        { duration: RAMP_DOWN, target: 0          }, // ramp-down
    ],
    load: [
        { duration: LOAD_RAMP,   target: LOAD_VUS }, // ramp-up
        { duration: LOAD_STEADY, target: LOAD_VUS }, // steady
        { duration: RAMP_DOWN,   target: 0         }, // ramp-down
    ],
};

export const options = {
    stages: profiles[TEST_TYPE] || profiles.smoke,

    // ── Performance thresholds ────────────────────────────────────────────
    thresholds: {
        http_req_duration: ['p(90)<1500', 'p(95)<2000'],
        http_req_failed:   ['rate<0.01'],
        checks:            ['rate>=0.99'],
    },
};
