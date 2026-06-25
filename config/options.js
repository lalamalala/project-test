// ─────────────────────────────────────────────────────────────────────────────
// Load-test options for QuickPizza
//
// Environment variables (pass with -e flag or in Jenkinsfile):
//   BASE_VUS    – VUs at the warm-up and steady phases  (default: 5)
//   PEAK_VUS    – VUs at peak load                       (default: 20)
//   RAMP_TIME   – duration of each ramp stage            (default: 30s)
//   STEADY_TIME – duration of each steady stage          (default: 2m)
// ─────────────────────────────────────────────────────────────────────────────

const BASE_VUS    = parseInt(__ENV.BASE_VUS    || '5');
const PEAK_VUS    = parseInt(__ENV.PEAK_VUS    || '20');
const RAMP_TIME   = __ENV.RAMP_TIME   || '30s';
const STEADY_TIME = __ENV.STEADY_TIME || '2m';

export const options = {
    // ── Stages (ramp-up → steady → peak → ramp-down) ──────────────────────
    stages: [
        { duration: RAMP_TIME,   target: BASE_VUS  }, // warm-up ramp
        { duration: STEADY_TIME, target: BASE_VUS  }, // steady base load
        { duration: RAMP_TIME,   target: PEAK_VUS  }, // ramp to peak
        { duration: STEADY_TIME, target: PEAK_VUS  }, // peak load
        { duration: RAMP_TIME,   target: 0          }, // ramp-down
    ],

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
