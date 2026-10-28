import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Product } from '../src/lib/commerce/types.ts';

const previousCommerceFile = process.env.COMMERCE_DB_FILE;
const previousSettingsFile = process.env.CMS_SETTINGS_FILE;
const testDirectory = await mkdtemp(join(tmpdir(), 'novex-product-grid-'));
process.env.COMMERCE_DB_FILE = join(testDirectory, 'commerce.json');
process.env.CMS_SETTINGS_FILE = join(testDirectory, 'cms-settings.json');

const { updateDatabase } = await import('../src/lib/commerce/db.ts');
const { listBoundPublicProductCards } = await import('../src/lib/commerce/product-grid.ts');
const { normalizeProductGridBinding, parseProductGridQuery, productGridApiPath } = await import('../src/lib/commerce/product-binding.ts');
const { resolveProductGridData } = await import('../src/lib/builder/product-grid.ts');

function product(id: string, overrides: Partial<Product> = {}): Product {
	const timestamp = '2026-10-28T12:00:00.000Z';
	return {
		id,
		name: `محصول ${id}`,
		slug: id,
		sku: `PRIVATE-${id}`,
		price: 120000,
		compareAtPrice: 150000,
		stock: 4,
		category: 'دستهٔ آزمایشی',
		description: 'توضیح محصول',
		image: '',
		status: 'active',
		featured: false,
		createdAt: timestamp,
		updatedAt: timestamp,
		...overrides,
	};
}

async function replaceProducts(products: Product[]): Promise<void> {
	await updateDatabase((database) => { database.products = products; });
}

beforeEach(async () => replaceProducts([]));

after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
	if (previousCommerceFile === undefined) delete process.env.COMMERCE_DB_FILE;
	else process.env.COMMERCE_DB_FILE = previousCommerceFile;
	if (previousSettingsFile === undefined) delete process.env.CMS_SETTINGS_FILE;
	else process.env.CMS_SETTINGS_FILE = previousSettingsFile;
});

describe('versioned Product Grid binding and public projection', () => {
	it('normalizes typed bindings, builds stable query URLs, and rejects ambiguous queries', () => {
		const binding = normalizeProductGridBinding({
			provider: 'novex-commerce-products', version: 1, selection: 'category', limit: 3, category: ' کتاب ' ,
		});
		assert.deepEqual(binding, {
			provider: 'novex-commerce-products', version: 1, selection: 'category', limit: 3, category: 'کتاب',
		});
		assert.equal(productGridApiPath(binding), '/api/products?selection=category&limit=3&category=%DA%A9%D8%AA%D8%A7%D8%A8');
		assert.throws(() => normalizeProductGridBinding({ ...binding, custom: 'unsafe' }), /Unsupported product data binding property/);
		assert.throws(() => normalizeProductGridBinding({ ...binding, limit: 13 }), /integer from 1 to 12/);
		assert.throws(() => parseProductGridQuery(new URLSearchParams('selection=featured&selection=latest&limit=4')), /provided only once/);
		assert.throws(() => parseProductGridQuery(new URLSearchParams('selection=featured&limit=4&internalId=secret')), /Unsupported product query parameter/);
	});

	it('selects only active records and exposes no internal ID, SKU, or exact stock', async () => {
		await replaceProducts([
			product('featured-public', { featured: true, image: 'javascript:alert(1)', stock: 7 }),
			product('ordinary-public', { featured: false, createdAt: '2026-10-27T12:00:00.000Z' }),
			product('draft-private', { featured: true, status: 'draft', stock: 99 }),
		]);

		const cards = await listBoundPublicProductCards({ provider: 'novex-commerce-products', version: 1, selection: 'featured', limit: 4 });
		assert.equal(cards.length, 1);
		assert.equal(cards[0]?.slug, 'featured-public');
		assert.equal(cards[0]?.image, '');
		assert.equal(cards[0]?.inStock, true);
		assert.equal('id' in (cards[0] ?? {}), false);
		assert.equal('sku' in (cards[0] ?? {}), false);
		assert.equal('stock' in (cards[0] ?? {}), false);
	});

	it('returns a ready empty card for a missing internal image instead of a broken reference', async () => {
		await replaceProducts([
			product('missing-image', { featured: true, image: '/media/uploads/not-present-e2e.png' }),
		]);
		const result = await resolveProductGridData({ provider: 'novex-commerce-products', version: 1, selection: 'featured', limit: 4 });
		assert.equal(result.status, 'ready');
		assert.equal(result.products.length, 1);
		assert.equal(result.products[0]?.image, '');
	});

	it('returns an explicit error state when the persisted commerce database is invalid', async () => {
		await writeFile(process.env.COMMERCE_DB_FILE!, '{not-json');
		const result = await resolveProductGridData({ provider: 'novex-commerce-products', version: 1, selection: 'latest', limit: 4 });
		assert.equal(result.status, 'error');
		assert.deepEqual(result.products, []);
	});
});
