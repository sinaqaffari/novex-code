import { defineConfig } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

const dataDirectory = process.env.NOVEX_E2E_DATA_DIR ?? path.join(os.tmpdir(), 'novex-code-e2e');
const chromiumArgs = process.env.PLAYWRIGHT_CHROMIUM_ARGS
	? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) as string[]
	: [];

export default defineConfig({
	testDir: './tests/browser',
	fullyParallel: false,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 8_000 },
	reporter: 'list',
	outputDir: './test-results/playwright',
	use: {
		baseURL: 'http://127.0.0.1:4321',
		browserName: 'chromium',
		headless: true,
		viewport: { width: 1440, height: 1000 },
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
		launchOptions: {
			...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
				? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
				: {}),
			args: chromiumArgs,
		},
	},
	webServer: {
		command: 'npm run preview -- --host 0.0.0.0 --port 4321',
		url: 'http://127.0.0.1:4321/api/health',
		// The test server is intentionally isolated: it must never attach to a developer's existing app.
		reuseExistingServer: false,
		timeout: 60_000,
		env: {
			...process.env,
			BUILDER_DATA_FILE: path.join(dataDirectory, 'builder-pages.json'),
			CMS_SETTINGS_FILE: path.join(dataDirectory, 'cms-settings.json'),
			CMS_USERS_FILE: path.join(dataDirectory, 'users.json'),
			COMMERCE_DB_FILE: path.join(dataDirectory, 'commerce.json'),
			CMS_USERNAME: 'novex-e2e-admin',
			CMS_PASSWORD: 'novex-e2e-password-only-for-local-tests',
			CMS_SESSION_SECRET: 'novex-e2e-session-secret-not-for-production',
		},
	},
});
