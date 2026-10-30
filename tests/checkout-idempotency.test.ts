import assert from 'node:assert/strict';
import { describe, it, after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Product } from '../src/lib/commerce/types.ts';

const previousCommerceFile = process.env.COMMERCE_DB_FILE;
const previousBuilderFile = process.env.BUILDER_DATA_FILE;
const testDirectory = await mkdtemp(join(tmpdir(), 'novex-checkout-idempotency-'));
process.env.COMMERCE_DB_FILE = join(testDirectory, 'commerce.json');
process.env.BUILDER_DATA_FILE = join(testDirectory, 'builder.json');

// The commerce store resolves its data path when imported.
const { readDatabase, updateDatabase, DB_FILE } = await import('../src/lib/commerce/db.ts');
const { createOrGetOrderFromCheckout } = await import('../src/lib/commerce/orders.ts');
assert.equal(DB_FILE, process.env.COMMERCE_DB_FILE);

const testProduct: Product = {
	id: 'prd_idem_test',
	name: 'تست یکسان‌سازی',
	slug: 'idem-test',
	sku: 'IDEM-TEST',
	price: 50000,
	stock: 10,
	category: 'تست',
	description: '',
	image: '',
	status: 'active',
	featured: false,
	createdAt: '2026-10-28T12:00:00.000Z',
	updatedAt: '2026-10-28T12:00:00.000Z',
};

	const baseInput = {
		idempotencyKey: 'idem_key_001_abcdef',
		customerName: 'خریدار تست',
		email: 'test@example.com',
		phone: '09123456789',
		city: 'تهران',
		address: 'نشانی تست',
		note: '',
		discountCode: '',
		items: [{ productId: 'prd_idem_test', quantity: 2 }],
	};

after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
	if (previousCommerceFile === undefined) delete process.env.COMMERCE_DB_FILE;
	else process.env.COMMERCE_DB_FILE = previousCommerceFile;
	if (previousBuilderFile === undefined) delete process.env.BUILDER_DATA_FILE;
	else process.env.BUILDER_DATA_FILE = previousBuilderFile;
});

async function seedProduct(): Promise<void> {
	await updateDatabase((db) => {
		db.products = [testProduct];
		db.orders = [];
		db.customers = [];
		db.discounts = [];
	});
}

describe('Checkout idempotency and payment behavior', () => {
	it('creates an order with idempotency key and returns created=true', async () => {
		await seedProduct();
		const result = await createOrGetOrderFromCheckout(baseInput);
		assert.equal(result.created, true);
		assert.match(result.order.number, /^NVX-\d+$/);
		assert.equal(result.order.status, 'pending');
		assert.equal(result.order.paymentState, 'not-started');
		assert.equal(result.order.checkoutIdempotencyKey, 'idem_key_001_abcdef');
		assert.equal(result.order.total, 145000); // 50000*2 + 45000 shipping
	});

	it('replaying the same idempotency key returns the existing order with created=false', async () => {
		const crypto = await import('node:crypto');
		const { idempotencyKey: _, ...fingerprintInput } = baseInput;
		const canonical = {
			...fingerprintInput,
			email: baseInput.email.toLowerCase(),
			discountCode: baseInput.discountCode.toUpperCase(),
			items: [...baseInput.items].sort((a, b) => a.productId.localeCompare(b.productId)),
		};
		const expectedFingerprint = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');

		const replay = await createOrGetOrderFromCheckout(baseInput);
		assert.equal(replay.created, false);
		assert.match(replay.order.number, /^NVX-\d+$/);
		assert.equal(replay.order.checkoutIdempotencyKey, 'idem_key_001_abcdef');
		assert.equal(replay.order.checkoutFingerprint, expectedFingerprint);
	});

	it('same idempotency key with different items returns 409 conflict', async () => {
		const conflictingInput = { ...baseInput, items: [{ productId: 'prd_idem_test', quantity: 5 }] };
		await assert.rejects(
			createOrGetOrderFromCheckout(conflictingInput),
			(error: unknown) => error instanceof Error && error.message.includes('قبلاً برای اطلاعات دیگری استفاده شده است')
		);
	});

	it('order stock is decremented on creation', async () => {
		await seedProduct();
		await createOrGetOrderFromCheckout(baseInput);
		const db = await readDatabase();
		const product = db.products.find((p) => p.id === 'prd_idem_test');
		assert.equal(product!.stock, 8); // 10 - 2
	});

	it('insufficient stock returns 409', async () => {
		await seedProduct();
		// Product has stock 10; order 15 (within per-line max of 20 but exceeds stock)
		const overstockInput = { ...baseInput, idempotencyKey: 'idem_key_overstock_xyz', items: [{ productId: 'prd_idem_test', quantity: 15 }] };
		await assert.rejects(
			createOrGetOrderFromCheckout(overstockInput),
			(error: unknown) => error instanceof Error && 'status' in error && error.status === 409
		);
	});

	it('inactive product cannot be ordered', async () => {
		await updateDatabase((db) => {
			const product = db.products.find((p) => p.id === 'prd_idem_test');
			if (product) product.status = 'draft';
		});
		const draftInput = { ...baseInput, idempotencyKey: 'idem_key_draft_abcdef' };
		await assert.rejects(
			createOrGetOrderFromCheckout(draftInput),
			(error: unknown) => error instanceof Error && error.message.includes('موجود نیست')
		);
	});

	it('invalid idempotency key is rejected', async () => {
		await seedProduct();
		const badKeyInput = { ...baseInput, idempotencyKey: 'short' };
		await assert.rejects(
			createOrGetOrderFromCheckout(badKeyInput),
			(error: unknown) => error instanceof Error && error.message.includes('معتبر نیست')
		);
	});
});
