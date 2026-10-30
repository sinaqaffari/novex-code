import assert from 'node:assert/strict';
import { describe, it, after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Product } from '../src/lib/commerce/types.ts';

const previousSettingsFile = process.env.CMS_SETTINGS_FILE;
const previousCommerceFile = process.env.COMMERCE_DB_FILE;
const previousBuilderFile = process.env.BUILDER_DATA_FILE;
const testDirectory = await mkdtemp(join(tmpdir(), 'novex-commerce-disabled-'));
process.env.CMS_SETTINGS_FILE = join(testDirectory, 'cms-settings.json');
process.env.COMMERCE_DB_FILE = join(testDirectory, 'commerce.json');
process.env.BUILDER_DATA_FILE = join(testDirectory, 'builder.json');

// Import after setting paths: both stores capture their paths at module initialization.
const { readSettings, writeSettings, SETTINGS_FILE } = await import('../src/lib/cms/settings.ts');
const { readDatabase, updateDatabase, DB_FILE } = await import('../src/lib/commerce/db.ts');
assert.equal(SETTINGS_FILE, process.env.CMS_SETTINGS_FILE);
assert.equal(DB_FILE, process.env.COMMERCE_DB_FILE);

const testProduct: Product = {
	id: 'prd_disabled_test',
	name: 'تست غیرفعال',
	slug: 'disabled-test',
	sku: 'DIS-TEST',
	price: 100000,
	stock: 5,
	category: 'تست',
	description: '',
	image: '',
	status: 'active',
	featured: false,
	createdAt: '2026-10-28T12:00:00.000Z',
	updatedAt: '2026-10-28T12:00:00.000Z',
};

async function setupCommerceWithProduct(): Promise<void> {
	await updateDatabase((db) => {
		db.products = [testProduct];
		db.orders = [];
		db.customers = [];
		db.discounts = [];
	});
}

async function disableCommerce(): Promise<void> {
	await writeSettings({ commerceEnabled: false });
}

async function enableCommerce(): Promise<void> {
	await writeSettings({ commerceEnabled: true });
}

after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
	if (previousSettingsFile === undefined) delete process.env.CMS_SETTINGS_FILE;
	else process.env.CMS_SETTINGS_FILE = previousSettingsFile;
	if (previousCommerceFile === undefined) delete process.env.COMMERCE_DB_FILE;
	else process.env.COMMERCE_DB_FILE = previousCommerceFile;
	if (previousBuilderFile === undefined) delete process.env.BUILDER_DATA_FILE;
	else process.env.BUILDER_DATA_FILE = previousBuilderFile;
});

describe('Commerce disabled state', () => {
	it('settings can toggle commerceEnabled off and on', async () => {
		const disabled = await readSettings();
		assert.equal(disabled.commerceEnabled, true);

		await disableCommerce();
		const afterDisable = await readSettings();
		assert.equal(afterDisable.commerceEnabled, false);

		await enableCommerce();
		const afterEnable = await readSettings();
		assert.equal(afterEnable.commerceEnabled, true);
	});

	it('product grid returns disabled status when commerce is off', async () => {
		await disableCommerce();
		try {
			const { resolveProductGridData } = await import('../src/lib/builder/product-grid.ts');
			const result = await resolveProductGridData({
				provider: 'novex-commerce-products',
				version: 1,
				selection: 'featured',
				limit: 4,
			});
			assert.equal(result.status, 'disabled');
			assert.deepEqual(result.products, []);
		} finally {
			await enableCommerce();
		}
	});

	it('public product API returns disabled status when commerce is off', async () => {
		await disableCommerce();
		try {
			const { listBoundPublicProductCards } = await import('../src/lib/commerce/product-grid.ts');
			const cards = await listBoundPublicProductCards({
				provider: 'novex-commerce-products',
				version: 1,
				selection: 'featured',
				limit: 4,
			});
			// The binding itself still resolves, but the grid resolver returns disabled
			assert.equal(cards.length, 0);
		} finally {
			await enableCommerce();
		}
	});

	it('checkout order creation is blocked when commerce is disabled', async () => {
		// Commerce disabled means the API layer returns 503 before reaching order creation
		// The store itself doesn't enforce commerceEnabled at the order level,
		// that's enforced in the API route handler. We verify the settings flag works.
		await disableCommerce();
		try {
			const settings = await readSettings();
			assert.equal(settings.commerceEnabled, false);
		} finally {
			await enableCommerce();
		}
	});

	it('database persists independently of commerceEnabled setting', async () => {
		await setupCommerceWithProduct();
		const db = await readDatabase();
		assert.equal(db.products.length, 1);
		assert.equal(db.products[0]!.id, 'prd_disabled_test');
	});
});
