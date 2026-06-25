/**
 * get-auth-headers.js
 *
 * Authenticates with QuickPizza and writes an auth-headers JSON file
 * that Lighthouse can use via --extra-headers-path to audit the admin page.
 *
 * Usage:
 *   node scripts/get-auth-headers.js <baseUrl> <username> <password> [outFile]
 *
 * Output (outFile, default: lh-auth-headers.json):
 *   { "Authorization": "Token <token>", "Cookie": "sessionid=<value>" }
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');

const [,, baseUrl, username, password, outFile = 'lh-auth-headers.json'] = process.argv;

if (!baseUrl || !username || !password) {
    console.error('Usage: get-auth-headers.js <baseUrl> <username> <password> [outFile]');
    process.exit(1);
}

const LOGIN_PATH = '/api/v1/auth/token/login/';
const body       = JSON.stringify({ username, password });

let parsed;
try   { parsed = new URL(baseUrl + LOGIN_PATH); }
catch (e) { console.error('Invalid base URL:', e.message); process.exit(1); }

const client  = parsed.protocol === 'https:' ? https : http;
const options = {
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path:     parsed.pathname,
    method:   'POST',
    headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
    },
};

const req = client.request(options, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
            console.error(`[Auth] Login failed: HTTP ${res.statusCode} – ${data}`);
            process.exit(1);
        }

        let json;
        try   { json = JSON.parse(data); }
        catch (e) { console.error('[Auth] Invalid JSON response:', data); process.exit(1); }

        const token = json.auth_token || json.token || json.access || json.key;
        if (!token) {
            console.error('[Auth] No token in response. Fields:', Object.keys(json).join(', '));
            process.exit(1);
        }

        // Build headers object for Lighthouse --extra-headers-path
        const headers = { Authorization: `Token ${token}` };

        // Also capture Set-Cookie header so session-based pages work too
        const setCookie = res.headers['set-cookie'];
        if (setCookie && setCookie.length > 0) {
            headers.Cookie = setCookie
                .map(c => c.split(';')[0])   // take only name=value part
                .join('; ');
        }

        fs.writeFileSync(outFile, JSON.stringify(headers, null, 2), 'utf8');
        console.log(`[Auth] Token obtained – headers written to ${outFile}`);
    });
});

req.on('error', e => { console.error('[Auth] Request error:', e.message); process.exit(1); });
req.write(body);
req.end();
