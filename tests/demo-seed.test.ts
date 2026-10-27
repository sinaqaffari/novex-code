/** Safety contract for the opt-in local demo catalogue fixtures. */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { seedDemoProducts } from '../scripts/seed-demo.mjs';

const temporaryDirectories: string[] = [];

async function fixtureDatabase(initial?: unknown) {
	const directory = await mkdtemp(path.join(tmpdir(), 'novex-demo-seed-'));
	temporaryDirectories.push(directory);
	const databaseFile = path.join(directory, 'commerce.json');
	if (initial !== undefined) await writeFile(databaseFile, `${JSON.stringify(initial)}\n`, 'utf8');
	return databaseFile;
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('opt-in demo catalogue seed', () => {
	it('previews without writing and refuses application in production', async () => {
		const databaseFile = await fixtureDatabase();
		const preview = await seedDemoProducts({ databaseFile });
		assert.equal(preview.added, 6);
		assert.equal(preview.applied, false);
		await assert.rejects(readFile(databaseFile), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');

		await assert.rejects(
			seedDemoProducts({ databaseFile, apply: true, production: true }),
			/production/,
		);
		await assert.rejects(readFile(databaseFile), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
	});

	it('adds only conspicuously labeled draft products, with no invented commerce activity, and is idempotent', async () => {
		const databaseFile = await fixtureDatabase();
		const first = await seedDemoProducts({ databaseFile, apply: true });
		assert.equal(first.added, 6);

		const database = JSON.parse(await readFile(databaseFile, 'utf8'));
		assert.equal(database.products.length, 6);
		assert.ok(database.products.every((product: Record<string, unknown>) =>
			product.status === 'draft' && product.price === 0 && product.stock === 0 &&
			String(product.name).startsWith('پیش‌نویس نمایشی:') &&
			String(product.description).includes('قابل فروش نیست'),
		));
		assert.deepEqual(database.orders, []);
		assert.deepEqual(database.customers, []);
		assert.deepEqual(database.discounts, []);
		assert.deepEqual(database.counters, { order: 0 });

		const second = await seedDemoProducts({ databaseFile, apply: true });
		assert.equal(second.added, 0);
		assert.equal(second.total, 6);
	});

	it('preserves existing records and refuses SKU conflicts or corrupt files', async () => {
		const existing = {
			version: 1,
			counters: { order: 1 },
			products: [{ id: 'real_product_1', sku: 'REAL-01', slug: 'real-product', status: 'active' }],
			orders: [{ id: 'real_order_1', status: 'pending', total: 1200 }],
			customers: [{ id: 'real_customer_1', name: 'Existing customer' }],
			discounts: [],
		};
		const databaseFile = await fixtureDatabase(existing);
		await seedDemoProducts({ databaseFile, apply: true });
		const result = JSON.parse(await readFile(databaseFile, 'utf8'));
		assert.deepEqual(result.products[0], existing.products[0]);
		assert.deepEqual(result.orders, existing.orders);
		assert.deepEqual(result.customers, existing.customers);
		assert.deepEqual(result.discounts, existing.discounts);
		assert.equal(result.products.length, 7);

		const conflictFile = await fixtureDatabase({
			...existing,
			products: [{ id: 'different', sku: 'DEMO-RTL-01', slug: 'different', status: 'active' }],
		});
		const beforeConflict = await readFile(conflictFile, 'utf8');
		await assert.rejects(seedDemoProducts({ databaseFile: conflictFile, apply: true }), /استفاده شده/);
		assert.equal(await readFile(conflictFile, 'utf8'), beforeConflict);

		const corruptFile = await fixtureDatabase();
		await writeFile(corruptFile, '{not-json', 'utf8');
		const beforeCorrupt = await readFile(corruptFile, 'utf8');
		await assert.rejects(seedDemoProducts({ databaseFile: corruptFile, apply: true }), /JSON معتبر/);
		assert.equal(await readFile(corruptFile, 'utf8'), beforeCorrupt);
	});
});
