// ─────────────────────────────────────────────────────────────────────────────
// QuickPizza API client
// All requests go to BASE_URL (env var). Falls back to the public demo server.
// ─────────────────────────────────────────────────────────────────────────────
import http  from 'k6/http';
import { check } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'https://quickpizza.grafana.com').replace(/\/$/, '');

// ── Header factories ─────────────────────────────────────────────────────────

const JSON_CT = { 'Content-Type': 'application/json' };

function authHeaders(token) {
    return {
        'Content-Type':  'application/json',
        'Authorization': `Token ${token}`,
    };
}

// ── Auth ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/users
 * Returns the full response object so the caller can inspect status.
 */
export function registerUser(username, password) {
    const res = http.post(
        `${BASE_URL}/api/users`,
        JSON.stringify({ username, password }),
        { headers: JSON_CT, tags: { name: 'RegisterUser' } }
    );

    check(res, {
        'register: status 201':  (r) => r.status === 201,
        'register: has user id': (r) => r.json('id') !== undefined,
    });

    return res;
}

/**
 * POST /api/users/token/login
 * Returns the auth token string, or null on failure.
 */
export function loginUser(username, password) {
    const res = http.post(
        `${BASE_URL}/api/users/token/login`,
        JSON.stringify({ username, password }),
        { headers: JSON_CT, tags: { name: 'LoginUser' } }
    );

    check(res, {
        'login: status 200':  (r) => r.status === 200,
        'login: has token':   (r) => r.json('token') !== undefined,
    });

    return res.json('token') || null;
}

/**
 * POST /api/users/token/logout
 */
export function logoutUser(token) {
    const res = http.post(
        `${BASE_URL}/api/users/token/logout`,
        null,
        { headers: authHeaders(token), tags: { name: 'LogoutUser' } }
    );

    check(res, {
        'logout: status 200': (r) => r.status === 200,
    });

    return res;
}

// ── Pizza ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/pizza
 * Requests a random pizza recommendation.
 * Returns the full response; pizza id is at res.json('pizza.id').
 */
export function getPizzaRecommendation(token) {
    const res = http.post(
        `${BASE_URL}/api/pizza`,
        JSON.stringify({
            maxCaloriesPerSlice:  900,
            mustBeVegetarian:     false,
            excludedIngredients:  [],
            excludedTools:        [],
            maxNumberOfToppings:  5,
            minNumberOfToppings:  2,
        }),
        { headers: authHeaders(token), tags: { name: 'GetPizzaRecommendation' } }
    );

    check(res, {
        'pizza: status 200':   (r) => r.status === 200,
        'pizza: has pizza id': (r) => r.json('pizza') !== null,
    });

    return res;
}

// ── Ratings ───────────────────────────────────────────────────────────────────

/**
 * POST /api/ratings
 * stars ∈ [1..5], pizzaId from getPizzaRecommendation.
 * Returns the full response; rating id is at res.json('id').
 */
export function ratePizza(token, pizzaId, stars) {
    const res = http.post(
        `${BASE_URL}/api/ratings`,
        JSON.stringify({ stars, pizza_id: pizzaId }),
        { headers: authHeaders(token), tags: { name: 'RatePizza' } }
    );

    check(res, {
        'rate pizza: status 201':    (r) => r.status === 201,
        'rate pizza: has rating id': (r) => r.json('id') !== undefined,
    });

    return res;
}

/**
 * GET /api/ratings
 * Returns all ratings for the current user.
 */
export function getRatings(token) {
    const res = http.get(
        `${BASE_URL}/api/ratings`,
        { headers: authHeaders(token), tags: { name: 'GetRatings' } }
    );

    check(res, {
        'get ratings: status 200': (r) => r.status === 200,
        'get ratings: is array':   (r) => Array.isArray(r.json('ratings')),
    });

    return res;
}

/**
 * DELETE /api/ratings/{id}
 */
export function deleteRating(token, ratingId) {
    const res = http.del(
        `${BASE_URL}/api/ratings/${ratingId}`,
        null,
        { headers: authHeaders(token), tags: { name: 'DeleteRating' } }
    );

    check(res, {
        'delete rating: status 204': (r) => r.status === 204,
    });

    return res;
}

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
