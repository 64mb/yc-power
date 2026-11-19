import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';

if (process.env.YC_POWER_DOCKER !== '1' || process.platform !== 'linux' || !existsSync('/etc/yc-power-browser-test-container')) {
    throw new Error('Run browser tests with npm run smoke:firefox or npm run smoke:chromium in Docker');
}

export default defineConfig({
    testDir: './tests',
    workers: 1,
    timeout: 60000,
    reporter: 'list',
    outputDir: './test-results/results',
    use: {baseURL: 'http://127.0.0.1:4173', viewport: {width: 1200, height: 800}, screenshot: 'only-on-failure', trace: 'retain-on-failure'},
    webServer: {command: 'node tests/fixture-server.mjs', url: 'http://127.0.0.1:4173/tests/fixtures/options.html', reuseExistingServer: false},
    projects: [
        {name: 'firefox', testMatch: ['firefox*.spec.mjs', 'federation-ui-smoke.spec.mjs', 'icons-ui-smoke.spec.mjs'], use: {browserName: 'firefox'}},
        {name: 'chromium', testMatch: ['chromium-ui-smoke.spec.mjs', 'federation-ui-smoke.spec.mjs', 'icons-ui-smoke.spec.mjs'], use: {browserName: 'chromium'}},
    ],
});
