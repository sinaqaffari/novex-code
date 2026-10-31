import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'novex-code-e2e-'));
const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const uploadLog = path.join(dataDirectory, 'test-uploads.txt');
// Blog writes in browser tests must never touch the user's source content.
await cp(path.join(root, 'src/content/blog'), path.join(dataDirectory, 'blog'), { recursive: true });
// Serve bundled fixtures from a private asset directory. Tests never create or
// clean up files in the user's media library, including content-addressed kits.
await mkdir(path.join(dataDirectory, 'assets', 'uploads'), { recursive: true });
for (const name of ['blog-placeholder-1.jpg', 'blog-placeholder-2.jpg', 'blog-placeholder-3.jpg', 'blog-placeholder-4.jpg', 'blog-placeholder-5.jpg', 'blog-placeholder-about.jpg']) {
	await cp(path.join(root, 'src/assets', name), path.join(dataDirectory, 'assets', name));
}

// The browser suite uses one clearly labelled fixture product in its isolated data directory.
await writeFile(path.join(dataDirectory, 'commerce.json'), `${JSON.stringify({
	version: 1,
	counters: { order: 0 },
	products: [{
		id: 'e2e_product_internal_id',
		name: 'محصول آزمایشی',
		slug: 'e2e-test-product',
		sku: 'E2E-TEST-ONLY',
		price: 123000,
		compareAtPrice: 150000,
		stock: 2,
		category: 'دستهٔ آزمایشی',
		description: 'این محصول فقط در داده‌های موقت آزمون مرورگر وجود دارد.',
		image: '/media/blog-placeholder-1.jpg',
		status: 'active',
		featured: true,
		createdAt: '2026-10-28T12:00:00.000Z',
		updatedAt: '2026-10-28T12:00:00.000Z',
	}, {
		id: 'e2e_draft_internal_id',
		name: 'پیش‌نویس آزمایشی',
		slug: 'e2e-draft-product',
		sku: 'E2E-DRAFT-ONLY',
		price: 1,
		stock: 1,
		category: 'آزمایش',
		description: '',
		image: '',
		status: 'draft',
		featured: true,
		createdAt: '2026-10-28T12:00:00.000Z',
		updatedAt: '2026-10-28T12:00:00.000Z',
	}],
	orders: [],
	customers: [],
	discounts: [],
}, null, 2)}\n`, { mode: 0o600 });
const args = process.argv.slice(2);

try {
	const testEnv = { ...process.env, NOVEX_E2E_DATA_DIR: dataDirectory, NOVEX_E2E_UPLOAD_LOG: uploadLog };
	delete testEnv.NOVEX_BACKEND_URL;
	delete testEnv.NOVEX_BACKEND_TOKEN;
	delete testEnv.NOVEX_COMMERCE_STORE;
	delete testEnv.NOVEX_BUILDER_STORE;
	// Opt-in only: never let browser tests reach the developer's live database.
	if (process.env.NOVEX_E2E_BACKEND_URL && process.env.NOVEX_E2E_BACKEND_TOKEN) {
		testEnv.NOVEX_BACKEND_URL = process.env.NOVEX_E2E_BACKEND_URL;
		testEnv.NOVEX_BACKEND_TOKEN = process.env.NOVEX_E2E_BACKEND_TOKEN;
	}
	delete testEnv.NOVEX_E2E_COMMERCE_POSTGRES;
	delete testEnv.NOVEX_E2E_COMMERCE_OUTAGE_READY;
	delete testEnv.NOVEX_E2E_BUILDER_POSTGRES;
	delete testEnv.NOVEX_E2E_BUILDER_OUTAGE_READY;
	const specs = args.filter((argument) => argument.endsWith('.spec.ts'));
	if ((process.env.NOVEX_E2E_PG_COMMERCE || process.env.NOVEX_E2E_PG_BUILDER) && specs.length === 1 && specs[0].endsWith('fullstack-postgres.spec.ts') && (!process.env.NOVEX_E2E_PG_COMMERCE || !process.env.NOVEX_E2E_PG_BUILDER)) throw new Error('The full-stack test requires both disposable store opt-ins.');
	// This opt-in INITIALIZES a store, so require an explicitly disposable,
	// uninitialized test service and run only its dedicated test. Never infer it
	// from a developer's ordinary NOVEX_BACKEND_URL or commerce configuration.
	if (process.env.NOVEX_E2E_PG_COMMERCE) {
		const files = args.filter((argument) => argument.endsWith('.spec.ts'));
		if (process.env.NOVEX_E2E_PG_COMMERCE !== 'initialize-disposable-store' || !testEnv.NOVEX_BACKEND_URL || !testEnv.NOVEX_BACKEND_TOKEN || files.length !== 1 || !['postgres-commerce.spec.ts', 'fullstack-postgres.spec.ts'].some((name) => files[0].endsWith(name))) {
			throw new Error('PostgreSQL browser tests require a disposable uninitialized backend and a dedicated commerce spec.');
		}
		const migrationEnv = { ...testEnv, COMMERCE_DB_FILE: path.join(dataDirectory, 'commerce.json'), BUILDER_DATA_FILE: path.join(dataDirectory, 'builder-pages.json') };
		const migration = spawn(process.execPath, ['--experimental-strip-types', 'scripts/migrate-commerce.ts', '--confirm-offline'], { cwd: root, env: migrationEnv, stdio: 'inherit' });
		const migrationResult = await new Promise((resolve, reject) => { migration.once('error', reject); migration.once('exit', (code, signal) => resolve({ code, signal })); });
		if (migrationResult.signal || migrationResult.code !== 0) throw new Error('Disposable commerce test migration failed.');
		testEnv.NOVEX_COMMERCE_STORE = 'postgres';
		testEnv.NOVEX_E2E_COMMERCE_POSTGRES = 'initialized';
	}
	if (process.env.NOVEX_E2E_PG_BUILDER) {
		const files = args.filter((argument) => argument.endsWith('.spec.ts'));
		if (process.env.NOVEX_E2E_PG_BUILDER !== 'initialize-disposable-store' || !testEnv.NOVEX_BACKEND_URL || !testEnv.NOVEX_BACKEND_TOKEN || files.length !== 1 || !files[0].endsWith('fullstack-postgres.spec.ts')) {
			throw new Error('Builder PostgreSQL browser tests require a disposable uninitialized backend and only fullstack-postgres.spec.ts.');
		}
		const migrationEnv = { ...testEnv, COMMERCE_DB_FILE: path.join(dataDirectory, 'commerce.json'), BUILDER_DATA_FILE: path.join(dataDirectory, 'builder-pages.json') };
		const migration = spawn(process.execPath, ['--experimental-strip-types', 'scripts/migrate-builder.ts', '--confirm-offline', '--allow-empty'], { cwd: root, env: migrationEnv, stdio: 'inherit' });
		const migrationResult = await new Promise((resolve, reject) => { migration.once('error', reject); migration.once('exit', (code, signal) => resolve({ code, signal })); });
		if (migrationResult.signal || migrationResult.code !== 0) throw new Error('Disposable Builder test migration failed.');
		testEnv.NOVEX_BUILDER_STORE = 'postgres';
		testEnv.NOVEX_E2E_BUILDER_POSTGRES = 'initialized';
	}
	if (process.env.NOVEX_E2E_BUILDER_OUTAGE) {
		const files = args.filter((argument) => argument.endsWith('.spec.ts'));
		if (process.env.NOVEX_E2E_BUILDER_OUTAGE !== 'simulate' || process.env.NOVEX_E2E_PG_BUILDER || process.env.NOVEX_E2E_PG_COMMERCE || process.env.NOVEX_E2E_COMMERCE_OUTAGE || files.length !== 1 || !files[0].endsWith('builder-outage.spec.ts')) throw new Error('Builder outage simulation runs only builder-outage.spec.ts.');
		await writeFile(path.join(dataDirectory, 'builder-pages.json.novex-postgres'), JSON.stringify({ version: 1, state: 'complete', source: 'empty', storeId: 'c'.repeat(32), sourceHash: 'd'.repeat(64) }), { mode: 0o600 });
		testEnv.NOVEX_BACKEND_URL = 'http://127.0.0.1:9';
		testEnv.NOVEX_BACKEND_TOKEN = 'outage-test-only-0123456789abcdef0123456789';
		testEnv.NOVEX_BUILDER_STORE = 'postgres';
		testEnv.NOVEX_E2E_BUILDER_OUTAGE_READY = '1';
	}
	if (process.env.NOVEX_E2E_COMMERCE_OUTAGE) {
		const files = args.filter((argument) => argument.endsWith('.spec.ts'));
		if (process.env.NOVEX_E2E_COMMERCE_OUTAGE !== 'simulate' || process.env.NOVEX_E2E_PG_COMMERCE || files.length !== 1 || !files[0].endsWith('commerce-outage.spec.ts')) throw new Error('Outage simulation runs only commerce-outage.spec.ts.');
		// This fake marker belongs to the disposable fixture file only; there is
		// no live backend, database, or user data involved in this test.
		await writeFile(path.join(dataDirectory, 'commerce.json.novex-postgres'), JSON.stringify({ version: 1, state: 'complete', source: 'file', storeId: 'a'.repeat(32), sourceHash: 'b'.repeat(64) }), { mode: 0o600 });
		testEnv.NOVEX_BACKEND_URL = 'http://127.0.0.1:9';
		testEnv.NOVEX_BACKEND_TOKEN = 'outage-test-only-0123456789abcdef0123456789';
		testEnv.NOVEX_COMMERCE_STORE = 'postgres';
		testEnv.NOVEX_E2E_COMMERCE_OUTAGE_READY = '1';
	}
	const child = spawn(process.execPath, [cli, 'test', ...args], {
		cwd: root,
		stdio: 'inherit',
		env: testEnv,
	});
	const result = await new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	if (result.signal) process.exitCode = 1;
	else process.exitCode = result.code ?? 1;
} finally {
	await rm(dataDirectory, { recursive: true, force: true });
}
