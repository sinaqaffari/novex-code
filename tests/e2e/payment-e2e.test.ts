/**
 * Service-level commerce workflow tests. These exercise the persisted JSON-store
 * operations; they do not simulate provider HTTP or claim a live payment test.
 *
 * Run: `node --experimental-strip-types --test tests/e2e/payment-e2e.test.ts`
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	claimOrderPaymentVerification,
	createOrGetOrderFromCheckout,
	createOrderFromCheckout,
	findOrderByPaymentRef,
	listOrders,
	settleOrderPayment,
	updateOrderPaymentRef,
	updateOrderStatus,
	type CheckoutInput,
} from '../../src/lib/commerce/orders.ts';
import { createEmptyDatabase, DB_FILE, readDatabase, updateDatabase } from '../../src/lib/commerce/db.ts';
import { isRevenue, ORDER_STATUSES, type OrderStatus, type Product } from '../../src/lib/commerce/types.ts';
import { AppError } from '../../src/lib/errors.ts';
import { CART_COOKIE, readCart } from '../../src/lib/commerce/cart.ts';

const COMMERCE_FILE = DB_FILE;
const BACKUP_FILE = `${DB_FILE}.test-backup-${process.pid}`;

function backupCommerce() {
	fs.mkdirSync(path.dirname(COMMERCE_FILE), { recursive: true });
	if (fs.existsSync(COMMERCE_FILE)) fs.copyFileSync(COMMERCE_FILE, BACKUP_FILE);
}

function restoreCommerce() {
	if (fs.existsSync(BACKUP_FILE)) {
		fs.copyFileSync(BACKUP_FILE, COMMERCE_FILE);
		fs.rmSync(BACKUP_FILE);
	} else if (fs.existsSync(COMMERCE_FILE)) {
		fs.rmSync(COMMERCE_FILE);
	}
}

function fixtureProduct(id: string, name: string, price: number, stock: number): Product {
	const now = new Date('2026-10-26T00:00:00.000Z').toISOString();
	return {
		id,
		name,
		slug: id,
		sku: id.toUpperCase(),
		price,
		stock,
		category: 'آزمایشی',
		description: 'دادهٔ ساختگی فقط برای تست خودکار؛ در فروشگاه واقعی استفاده نمی‌شود.',
		image: '',
		status: 'active',
		featured: false,
		createdAt: now,
		updatedAt: now,
	};
}

beforeEach(async () => {
	backupCommerce();
	await updateDatabase((db) => {
		db.products = [
			fixtureProduct('test_rtl_template', 'قالب RTL آزمایشی', 890_000, 12),
			fixtureProduct('test_typography_course', 'دورهٔ تایپوگرافی آزمایشی', 2_400_000, 50),
		];
	});
});
afterEach(restoreCommerce);

function makeTestOrderInput(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
	return {
		idempotencyKey: randomUUID(),
		customerName: 'رضا Ahmadi',
		email: 'reza@example.com',
		phone: '۰۹۱۲۳۴۵۶۷۸۹',
		city: 'تهران',
		address: 'خیابان ولیعصر، پلاک ۱۲۳',
		items: [
			{ productId: 'test_rtl_template', quantity: 1 },
			{ productId: 'test_typography_course', quantity: 1 },
		],
		discountCode: '',
		...overrides,
	};
}

describe('Commerce checkout service', () => {
	it('creates a pending order using server product prices', async () => {
		const order = await createOrderFromCheckout(makeTestOrderInput());

		assert.equal(order.status, 'pending');
		assert.equal(order.customerName, 'رضا Ahmadi');
		assert.ok(order.number.startsWith('NVX-'));
		assert.equal(order.subtotal, 3_290_000);
		assert.equal(order.total, 3_290_000);
		assert.equal(order.paymentState, 'not-started');
		assert.equal(order.paymentRef, undefined);
	});

	it('returns the same order on a retry and decrements inventory only once', async () => {
		const input = makeTestOrderInput({ items: [{ productId: 'test_rtl_template', quantity: 2 }] });
		const first = await createOrGetOrderFromCheckout(input);
		const retry = await createOrGetOrderFromCheckout(input);

		assert.equal(first.created, true);
		assert.equal(retry.created, false);
		assert.equal(retry.order.id, first.order.id);
		const db = await readDatabase();
		assert.equal(db.orders.length, 1);
		assert.equal(db.products.find((product) => product.id === 'test_rtl_template')?.stock, 10);
	});

	it('rejects reusing an idempotency key for different checkout data', async () => {
		const input = makeTestOrderInput({ items: [{ productId: 'test_rtl_template', quantity: 1 }] });
		await createOrGetOrderFromCheckout(input);

		await assert.rejects(
			createOrGetOrderFromCheckout({ ...input, phone: '۰۹۱۲۰۰۰۰۰۰۰' }),
			(error: unknown) => error instanceof AppError && error.status === 409,
		);
		const db = await readDatabase();
		assert.equal(db.orders.length, 1);
		assert.equal(db.products.find((product) => product.id === 'test_rtl_template')?.stock, 11);
	});

	it('aggregates duplicate product lines before checking stock and charging', async () => {
		const order = await createOrderFromCheckout(
			makeTestOrderInput({
				items: [
					{ productId: 'test_rtl_template', quantity: 6 },
					{ productId: 'test_rtl_template', quantity: 6 },
				],
			}),
		);
		assert.equal(order.items.length, 1);
		assert.equal(order.items[0]?.quantity, 12);

		const db = await readDatabase();
		assert.equal(db.products.find((product) => product.id === 'test_rtl_template')?.stock, 0);
	});

	it('rejects over-stock and non-integer quantities without side effects', async () => {
		const overStock = makeTestOrderInput({ items: [{ productId: 'test_rtl_template', quantity: 13 }] });
		await assert.rejects(createOrderFromCheckout(overStock));
		const fractional = makeTestOrderInput({ items: [{ productId: 'test_rtl_template', quantity: 1.5 }] });
		await assert.rejects(createOrderFromCheckout(fractional));

		const db = await readDatabase();
		assert.equal(db.orders.length, 0);
		assert.equal(db.products.find((product) => product.id === 'test_rtl_template')?.stock, 12);
	});

	it('does not seed invented catalog, customers, orders, or discounts', () => {
		const empty = createEmptyDatabase();
		assert.deepEqual(empty.products, []);
		assert.deepEqual(empty.orders, []);
		assert.deepEqual(empty.customers, []);
		assert.deepEqual(empty.discounts, []);
	});

	it('preserves malformed commerce data instead of replacing it with empty data', async () => {
		for (const corrupt of ['{not valid json', '{}']) {
			fs.writeFileSync(COMMERCE_FILE, corrupt, 'utf8');
			await assert.rejects(readDatabase());
			assert.equal(fs.readFileSync(COMMERCE_FILE, 'utf8'), corrupt);
		}
	});

	it('normalizes duplicate cart-cookie lines and drops invalid quantities', () => {
		const cookies = {
			get: (name: string) => name === CART_COOKIE
				? { value: JSON.stringify([
					{ productId: 'test_rtl_template', quantity: 2 },
					{ productId: 'test_rtl_template', quantity: 3 },
					{ productId: 'invalid', quantity: -1 },
				]) }
				: undefined,
		} as never;
		assert.deepEqual(readCart(cookies), [{ productId: 'test_rtl_template', quantity: 5 }]);
	});
});

describe('Payment state transitions (service-level only)', () => {
	it('claims callback verification once and settles a repeated success once', async () => {
		const order = await createOrderFromCheckout(
			makeTestOrderInput({ items: [{ productId: 'test_rtl_template', quantity: 1 }] }),
		);
		const authority = 'A000000000000000000000000000001';
		await updateOrderPaymentRef(order.id, authority);

		assert.equal(await claimOrderPaymentVerification(order.id, authority), true);
		assert.equal(await claimOrderPaymentVerification(order.id, authority), false);
		const settled = await settleOrderPayment(order.id, authority);
		assert.equal(settled.changed, true);
		assert.equal(settled.order.status, 'paid');
		assert.equal(settled.order.paymentState, 'verified');

		const duplicate = await settleOrderPayment(order.id, authority);
		assert.equal(duplicate.changed, false);
		const db = await readDatabase();
		assert.equal(db.products.find((product) => product.id === 'test_rtl_template')?.stock, 11);
	});

	it('cancels and restocks only once when the order is cancelled repeatedly', async () => {
		const order = await createOrderFromCheckout(
			makeTestOrderInput({ items: [{ productId: 'test_rtl_template', quantity: 1 }] }),
		);
		const authority = 'A000000000000000000000000000002';
		await updateOrderPaymentRef(order.id, authority);

		const first = await updateOrderStatus(order.id, 'cancelled');
		const duplicate = await updateOrderStatus(order.id, 'cancelled');
		assert.equal(first.status, 'cancelled');
		assert.equal(duplicate.status, 'cancelled');
		const db = await readDatabase();
		assert.equal(db.products.find((product) => product.id === 'test_rtl_template')?.stock, 12);
	});
});

describe('Order queries and revenue', () => {
	it('stores a payment reference and finds its order', async () => {
		const order = await createOrderFromCheckout(makeTestOrderInput());
		const authority = 'A000000000000000000000000000003';
		const updated = await updateOrderPaymentRef(order.id, authority);
		assert.equal(updated.paymentRef, authority);
		assert.equal((await findOrderByPaymentRef(authority))?.id, order.id);
	});

	it('returns null for an unknown payment reference', async () => {
		assert.equal(await findOrderByPaymentRef('UNKNOWN_AUTHORITY_999'), null);
	});

	it('lists pending orders and counts them from persisted records', async () => {
		const before = await listOrders({ status: 'pending' });
		await createOrderFromCheckout(makeTestOrderInput());
		const after = await listOrders({ status: 'pending' });
		assert.equal(after.counts.pending, before.counts.pending + 1);
	});

	it('counts revenue only from paid orders', async () => {
		const paidOrder = await createOrderFromCheckout(makeTestOrderInput());
		await updateOrderStatus(paidOrder.id, 'paid');
		const cancelledOrder = await createOrderFromCheckout(makeTestOrderInput());
		await updateOrderStatus(cancelledOrder.id, 'cancelled');

		const db = await readDatabase();
		const revenueOrders = db.orders.filter((item) => isRevenue(item.status));
		assert.ok(revenueOrders.some((item) => item.id === paidOrder.id));
		assert.equal(revenueOrders.some((item) => item.id === cancelledOrder.id), false);
	});

	it('lists statuses in the documented lifecycle', () => {
		const lifecycle: OrderStatus[] = [
			'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded',
		];
		const statusValues = ORDER_STATUSES.map((status) => status.value);
		for (const status of lifecycle) assert.ok(statusValues.includes(status));
		assert.ok(isRevenue('paid'));
		assert.ok(isRevenue('processing'));
		assert.ok(isRevenue('shipped'));
		assert.ok(isRevenue('delivered'));
		assert.equal(isRevenue('pending'), false);
		assert.equal(isRevenue('cancelled'), false);
		assert.equal(isRevenue('refunded'), false);
	});
});

describe('Zarinpal plugin manifest contract', () => {
	it('declares its implemented payment hooks and required admin capabilities', () => {
		const manifestPath = path.join(process.cwd(), 'plugins/zarinpal-gateway/plugin.json');
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
			hooks?: string[];
			capabilities?: string[];
		};
		assert.ok(manifest.hooks?.includes('shop.payment.initiate'));
		assert.ok(manifest.hooks?.includes('shop.payment.verify'));
		for (const capability of ['cms:widgets', 'commerce:payments', 'options:read', 'options:write', 'admin:page']) {
			assert.ok(manifest.capabilities?.includes(capability));
		}
	});
});
