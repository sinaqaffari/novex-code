/** Sorting and query normalization for the CMS product catalog. */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import type { Product } from '../src/lib/commerce/types.ts';

const previousCommerceFile = process.env.COMMERCE_DB_FILE;
const testDirectory = await mkdtemp(join(tmpdir(), 'novex-product-sorting-'));
process.env.COMMERCE_DB_FILE = join(testDirectory, 'commerce.json');

const { listProducts, parseProductSort } = await import('../src/lib/commerce/products.ts');
const { updateDatabase } = await import('../src/lib/commerce/db.ts');

after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
	if (previousCommerceFile === undefined) delete process.env.COMMERCE_DB_FILE;
	else process.env.COMMERCE_DB_FILE = previousCommerceFile;
});

function product(id: string, name: string, overrides: Partial<Product> = {}): Product {
	const timestamp = '2026-10-20T00:00:00.000Z';
	return {
		id,
		name,
		slug: id,
		sku: id.toUpperCase(),
		price: 100,
		stock: 5,
		category: 'آزمایش',
		description: '',
		image: '',
		status: 'active',
		featured: false,
		createdAt: timestamp,
		updatedAt: timestamp,
		...overrides,
	};
}

async function replaceProducts(products: Product[]): Promise<void> {
	await updateDatabase((db) => {
		db.products = products;
	});
}

beforeEach(async () => {
	await replaceProducts([]);
});

describe('CMS product sorting', () => {
	it('accepts only supported sort keys and falls back to newest', () => {
		assert.equal(parseProductSort('price-asc'), 'price-asc');
		assert.equal(parseProductSort('stock-asc'), 'stock-asc');
		assert.equal(parseProductSort('name'), 'name');
		assert.equal(parseProductSort('not-a-sort'), 'newest');
		assert.equal(parseProductSort(null), 'newest');
	});

	it('orders newest products by creation time, not a later edit to an older product', async () => {
		await replaceProducts([
			product('old-edited', 'محصول قدیمی', {
				createdAt: '2025-01-01T00:00:00.000Z',
				updatedAt: '2026-10-27T11:00:00.000Z',
			}),
			product('new-created', 'محصول تازه', {
				createdAt: '2026-10-27T10:00:00.000Z',
				updatedAt: '2026-10-27T10:00:00.000Z',
			}),
		]);

		const result = await listProducts({ sort: 'newest' });
		assert.deepEqual(result.items.map((item) => item.id), ['new-created', 'old-edited']);
	});

	it('sorts by price, stock, and Persian name with deterministic tie-breaking', async () => {
		await replaceProducts([
			product('gamma', 'گاما', { price: 200, stock: 5 }),
			product('beta', 'بتا', { price: 100, stock: 2 }),
			product('alpha', 'آلفا', { price: 100, stock: 2 }),
		]);

		const ascending = await listProducts({ sort: 'price-asc' });
		const descending = await listProducts({ sort: 'price-desc' });
		const lowStock = await listProducts({ sort: 'stock-asc' });
		const alphabetical = await listProducts({ sort: 'name' });
		const invalid = await listProducts({ sort: 'unknown' as never });

		assert.deepEqual(ascending.items.map((item) => item.id), ['alpha', 'beta', 'gamma']);
		assert.deepEqual(descending.items.map((item) => item.id), ['gamma', 'alpha', 'beta']);
		assert.deepEqual(lowStock.items.map((item) => item.id), ['alpha', 'beta', 'gamma']);
		assert.deepEqual(alphabetical.items.map((item) => item.id), ['alpha', 'beta', 'gamma']);
		assert.deepEqual(invalid.items.map((item) => item.id), ['alpha', 'beta', 'gamma']);
	});

	it('only exposes active product categories in public catalog results', async () => {
		await replaceProducts([
			product('published', 'محصول منتشرشده', { category: 'عمومی', status: 'active' }),
			product('draft', 'محصول پیش‌نویس', { category: 'پیش‌نویس', status: 'draft' }),
			product('archived', 'محصول بایگانی‌شده', { category: 'قدیمی', status: 'archived' }),
		]);

		const publicCatalog = await listProducts({ status: 'active' });
		const adminCatalog = await listProducts({ status: 'all' });

		assert.deepEqual(publicCatalog.categories, ['عمومی']);
		assert.deepEqual(adminCatalog.categories, ['پیش‌نویس', 'عمومی', 'قدیمی']);
	});
});
