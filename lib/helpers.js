// ─────────────────────────────────────────────────────────────────────────────
// Shared utility helpers
// ─────────────────────────────────────────────────────────────────────────────
import { randomString, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

/**
 * Generate a random user credential pair.
 * Username: user_<8 random chars>
 * Password: pass_<12 random chars>
 */
export function generateUser() {
    return {
        username: `user_${randomString(8)}`,
        password: `pass_${randomString(12)}`,
    };
}

/**
 * Returns a random integer in [min, max].
 * Re-exported so callers only need one import.
 */
export { randomIntBetween };
