import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { AppError } from '../src/lib/errors.ts';
import { assertFileStoreNotMigrated, migrateCommerceFile, readPostgresCommerce } from '../src/lib/commerce/postgres.ts';
import type { Product } from '../src/lib/commerce/types.ts';

const token = 'fake-backend-token-0123456789abcdef0123456789';
const fixture = () => ({ version: 1, counters: { order: 5, legacyCounter: 19 }, products: [], orders: [], customers: [], discounts: [], legacyExtension: { retained: true } });

it('resumes an interrupted migration without overwriting the source or accepting a changed source', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'novex-migration-fake-'));
	const file = path.join(directory, 'commerce.json');
	const original = `${JSON.stringify(fixture(), null, 2)}\n`;
	await writeFile(file, original);
	const oldFetch = globalThis.fetch, oldUrl = process.env.NOVEX_BACKEND_URL, oldToken = process.env.NOVEX_BACKEND_TOKEN;
	process.env.NOVEX_BACKEND_URL = 'http://fake.invalid'; process.env.NOVEX_BACKEND_TOKEN = token;
	let remote: { storeId: string; sourceHash: string; snapshot: unknown; revision: number } | null = null;
	let interruptOnce = true;
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		if (url.pathname === '/v1/commerce' && (!init?.method || init.method === 'GET')) {
			return remote ? Response.json({ ok: true, ...remote }) : Response.json({ ok: false, code: 'not_initialized' }, { status: 404 });
		}
		if (url.pathname === '/v1/commerce/bootstrap' && init?.method === 'POST') {
			const body = JSON.parse(String(init.body)) as { storeId: string; sourceHash: string; snapshot: unknown };
			if (!remote) remote = { ...body, revision: 0 };
			else if (remote.storeId !== body.storeId || remote.sourceHash !== body.sourceHash || JSON.stringify(remote.snapshot) !== JSON.stringify(body.snapshot)) return Response.json({ ok: false, code: 'already_initialized' }, { status: 409 });
			if (interruptOnce) { interruptOnce = false; throw new Error('connection lost after commit'); }
			return Response.json({ ok: true, revision: 0, replayed: true });
		}
		throw new Error(`Unexpected fake request ${url.pathname}`);
	};
	try {
		const validate = (value: unknown) => { assert.ok(value && typeof value === 'object'); };
		await assert.rejects(migrateCommerceFile(file, fixture(), validate, false));
		assert.equal(await readFile(file, 'utf8'), original);
		const marker = JSON.parse(await readFile(`${file}.novex-postgres`, 'utf8')) as { state: string; storeId: string };
		assert.equal(marker.state, 'pending');
		await assert.rejects(assertFileStoreNotMigrated(file), (error: unknown) => error instanceof AppError && error.status === 503);
		await assert.rejects(readPostgresCommerce(file));
		await writeFile(file, JSON.stringify({ ...fixture(), legacyExtension: { retained: false } }));
		await assert.rejects(migrateCommerceFile(file, fixture(), validate, false), /source changed/i);
		await writeFile(file, original);
		await migrateCommerceFile(file, fixture(), validate, false);
		assert.equal(await readFile(file, 'utf8'), original);
		const complete = JSON.parse(await readFile(`${file}.novex-postgres`, 'utf8')) as { state: string; storeId: string };
		assert.equal(complete.state, 'complete'); assert.equal(complete.storeId, marker.storeId);
		const read = await readPostgresCommerce(file);
		assert.deepEqual(read.raw, fixture());
		await assert.rejects(migrateCommerceFile(file, fixture(), validate, false), /already been migrated/i);
	} finally {
		globalThis.fetch = oldFetch;
		if (oldUrl === undefined) delete process.env.NOVEX_BACKEND_URL; else process.env.NOVEX_BACKEND_URL = oldUrl;
		if (oldToken === undefined) delete process.env.NOVEX_BACKEND_TOKEN; else process.env.NOVEX_BACKEND_TOKEN = oldToken;
		await rm(directory, { recursive: true, force: true });
	}
});

it('rejects missing and symlinked source files before making a migration marker', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'novex-migration-source-'));
	try {
		const missing = path.join(directory, 'missing.json');
		await assert.rejects(migrateCommerceFile(missing, fixture(), () => {}, false), /source is missing/i);
		const source = path.join(directory, 'source.json'), link = path.join(directory, 'link.json');
		await writeFile(source, JSON.stringify(fixture())); await symlink(source, link);
		await assert.rejects(migrateCommerceFile(link, fixture(), () => {}, false), /regular file/i);
		await assert.rejects(readFile(`${link}.novex-postgres`));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

it('migrates a real shop to Go/PostgreSQL and retains checkout idempotency and stock', async (t) => {
	const url = process.env.NOVEX_TEST_COMMERCE_BACKEND_URL, backendToken = process.env.NOVEX_TEST_COMMERCE_BACKEND_TOKEN;
	if (!url || !backendToken || process.env.NOVEX_TEST_COMMERCE_CONFIRM !== 'initialize-disposable-store') return t.skip('Requires an explicitly confirmed disposable, uninitialized commerce backend.');
	const directory = await mkdtemp(path.join(os.tmpdir(), 'novex-commerce-postgres-'));
	const file = path.join(directory, 'commerce.json');
	const product: Product = {
		id: 'prd_test001', name: 'محصول آزمایشی', slug: 'postgres-item', sku: 'PG-TEST', price: 50000, stock: 10,
		category: 'آزمایش', description: '', image: '', status: 'active', featured: true,
		createdAt: '2026-10-28T12:00:00.000Z', updatedAt: '2026-10-28T12:00:00.000Z',
	};
	const original = `${JSON.stringify({ ...fixture(), products: [product], orders: [{ id: 'ord_legacy', number: 'NVX-000005', custom: 'keep' }] }, null, 2)}\n`;
	await writeFile(file, original);
	const previous = { file: process.env.COMMERCE_DB_FILE, builder: process.env.BUILDER_DATA_FILE, blog: process.env.CMS_BLOG_DIR, assets: process.env.CMS_ASSETS_DIR, url: process.env.NOVEX_BACKEND_URL, token: process.env.NOVEX_BACKEND_TOKEN, mode: process.env.NOVEX_COMMERCE_STORE };
	process.env.COMMERCE_DB_FILE = file; process.env.BUILDER_DATA_FILE = path.join(directory, 'builder.json');
	process.env.CMS_BLOG_DIR = path.join(directory, 'blog'); process.env.CMS_ASSETS_DIR = path.join(directory, 'assets');
	await mkdir(process.env.CMS_BLOG_DIR, { recursive: true });
	await mkdir(path.join(process.env.CMS_ASSETS_DIR, 'uploads'), { recursive: true });
	process.env.NOVEX_BACKEND_URL = url; process.env.NOVEX_BACKEND_TOKEN = backendToken;
	try {
		const { DB_FILE, migrateCommerceToPostgres, readDatabase, updateDatabase, exportPostgresCommerce } = await import('../src/lib/commerce/db.ts');
		const { createOrGetOrderFromCheckout, claimPaymentInitiation, completePaymentInitiation } = await import('../src/lib/commerce/orders.ts');
		const { getCommerceSnapshot } = await import('../src/lib/backend/commerce.ts');
		assert.equal(DB_FILE, file);
		await migrateCommerceToPostgres();
		assert.equal(await readFile(file, 'utf8'), original);
		process.env.NOVEX_COMMERCE_STORE = 'postgres';
		assert.equal((await readDatabase()).products[0].stock, 10);
		const input = { idempotencyKey: 'pg-checkout-idempotent-12345', customerName: 'خریدار آزمایشی', email: 'buyer@example.invalid', phone: '09120000000', city: 'تهران', address: 'نشانی آزمایشی', items: [{ productId: product.id, quantity: 2 }] };
		const results = await Promise.all(Array.from({ length: 8 }, () => createOrGetOrderFromCheckout(input)));
		assert.equal(results.filter((result) => result.created).length, 1);
		assert.equal(new Set(results.map((result) => result.order.id)).size, 1);
		await assert.rejects(createOrGetOrderFromCheckout({ ...input, address: 'آدرس متفاوت' }), (error: unknown) => error instanceof AppError && error.status === 409);
		const orderId = results[0].order.id;
		const claims = await Promise.all(Array.from({ length: 5 }, () => claimPaymentInitiation(orderId)));
		assert.equal(claims.filter(Boolean).length, 1);
		assert.equal((await completePaymentInitiation(orderId, null)).paymentState, 'not-configured');
		// Independent app processes sharing the asset lock must replay one order,
		// not each decrement inventory or create a separate payment workflow.
		const secondInput = { ...input, idempotencyKey: 'pg-checkout-multiprocess-12345' };
		const moduleUrl = new URL('../src/lib/commerce/orders.ts', import.meta.url).href;
		const childSource = `const { createOrGetOrderFromCheckout } = await import(${JSON.stringify(moduleUrl)}); const value = await createOrGetOrderFromCheckout(${JSON.stringify(secondInput)}); console.log(JSON.stringify({id:value.order.id,created:value.created}));`;
		const childCheckout = () => new Promise<{ id: string; created: boolean }>((resolve, reject) => {
			const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', childSource], { env: { ...process.env, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
			let output = '', error = '';
			child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
			child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString(); });
			child.once('error', reject);
			child.once('exit', (code) => {
				if (code !== 0) { reject(new Error(`Child checkout failed: ${error}`)); return; }
				try { resolve(JSON.parse(output) as { id: string; created: boolean }); } catch (cause) { reject(cause); }
			});
		});
		const multiple = await Promise.all(Array.from({ length: 6 }, childCheckout));
		assert.equal(multiple.filter((entry) => entry.created).length, 1);
		assert.equal(new Set(multiple.map((entry) => entry.id)).size, 1);
		await updateDatabase((db) => { db.products[0].description = 'ویرایش‌شده'; });
		const db = await readDatabase();
		assert.equal(db.products[0].stock, 6); assert.equal(db.orders.length, 3); assert.equal(db.counters.order, 7);
		const backup = path.join(directory, 'commerce-backup.json');
		await exportPostgresCommerce(backup);
		assert.equal((await stat(backup)).mode & 0o077, 0);
		const backupText = await readFile(backup, 'utf8');
		assert.equal((JSON.parse(backupText) as { orders: unknown[] }).orders.length, 3);
		await assert.rejects(exportPostgresCommerce(backup));
		await assert.rejects(exportPostgresCommerce(file));
		assert.equal(await readFile(backup, 'utf8'), backupText);
		const raw = (await getCommerceSnapshot()).snapshot as { legacyExtension: unknown; counters: { legacyCounter: number }; orders: Array<{ custom?: string }> };
		assert.deepEqual(raw.legacyExtension, { retained: true }); assert.equal(raw.counters.legacyCounter, 19);
		assert.ok(raw.orders.some((order) => order.custom === 'keep'));
		assert.equal(await readFile(file, 'utf8'), original, 'original JSON must remain unchanged after checkout');
		// Media deletion must consult the live PostgreSQL catalog, not the now
		// stale source file, and must fail closed if the backend is unavailable.
		const imageName = 'postgres-product.png';
		const imagePath = path.join(process.env.CMS_ASSETS_DIR, 'uploads', imageName);
		await writeFile(imagePath, 'test image sentinel');
		await updateDatabase((snapshot) => { snapshot.products[0].image = `/media/uploads/${imageName}`; });
		const { deleteUpload } = await import('../src/lib/cms/media.ts');
		await assert.rejects(deleteUpload(imageName), (error: unknown) => error instanceof AppError && error.status === 409);
		process.env.NOVEX_BACKEND_URL = 'http://127.0.0.1:9';
		await assert.rejects(deleteUpload(imageName), (error: unknown) => error instanceof AppError && error.status === 503);
		process.env.NOVEX_BACKEND_URL = url;
		process.env.NOVEX_COMMERCE_STORE = 'file';
		await assert.rejects(deleteUpload(imageName), (error: unknown) => error instanceof AppError && error.status === 503);
		assert.ok((await stat(imagePath)).isFile());
		process.env.NOVEX_COMMERCE_STORE = 'postgres';
		await updateDatabase((snapshot) => { snapshot.products[0].image = ''; });
		await deleteUpload(imageName);
		await assert.rejects(stat(imagePath));
		process.env.NOVEX_COMMERCE_STORE = 'file';
		await assert.rejects(readDatabase(), (error: unknown) => error instanceof AppError && error.status === 503);
		await assert.rejects(updateDatabase(() => undefined), (error: unknown) => error instanceof AppError && error.status === 503);
		process.env.NOVEX_COMMERCE_STORE = 'postgres';
		process.env.NOVEX_BACKEND_URL = 'http://127.0.0.1:9';
		await assert.rejects(readDatabase(), (error: unknown) => error instanceof AppError && error.status === 503);
		await assert.rejects(updateDatabase(() => undefined), (error: unknown) => error instanceof AppError && error.status === 503);
		process.env.NOVEX_BACKEND_URL = url;
		assert.equal((await readDatabase()).products[0].stock, 6);
	} finally {
		for (const [key, value] of Object.entries({ COMMERCE_DB_FILE: previous.file, BUILDER_DATA_FILE: previous.builder, CMS_BLOG_DIR: previous.blog, CMS_ASSETS_DIR: previous.assets, NOVEX_BACKEND_URL: previous.url, NOVEX_BACKEND_TOKEN: previous.token, NOVEX_COMMERCE_STORE: previous.mode })) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
		await rm(directory, { recursive: true, force: true });
	}
});
