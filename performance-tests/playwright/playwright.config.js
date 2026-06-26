const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const RESULTS_DIR = path.resolve(__dirname, '../reports/playwright');

module.exports = defineConfig({
    testDir:  './tests',
    timeout:  30_000,
    retries:  0,

    reporter: [
        ['junit', { outputFile: path.join(RESULTS_DIR, 'results.xml') }],
        ['html',  { outputFolder: path.join(RESULTS_DIR, 'html'), open: 'never' }],
        ['list'],
    ],

    use: {
        baseURL:    process.env.BASE_URL || 'http://localhost:3333',
        headless:   true,
        screenshot: 'only-on-failure',
        video:      'retain-on-failure',
    },

    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
});
