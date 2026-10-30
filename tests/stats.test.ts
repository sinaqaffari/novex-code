/** Revenue dashboard metrics must use real orders from the displayed period. */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, it } from 'node:test';
import type { Order, Product } from '../src/lib/commerce/types.ts';

const previousCommerceFile = process.env.COMMERCE_DB_FILE;
const previousBuilderFile = process.env.BUILDER_DATA_FILE;
const testDirectory = await mkdtemp(join(tmpdir(), 'novex-revenue-stats-'));
process.env.COMMERCE_DB_FILE = join(testDirectory, 'commerce.json');
process.env.BUILDER_DATA_FILE = join(testDirectory, 'builder.json');

const { updateDatabase } = await import('../src/lib/commerce/db.ts');
const { buildDashboardMetrics } = await import('../src/lib/commerce/stats.ts');

after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
	if (previousCommerceFile === undefined) delete process.env.COMMERCE_DB_FILE;
	else process.env.COMMERCE_DB_FILE = previousCommerceFile;
	if (previousBuilderFile === undefined) delete process.env.BUILDER_DATA_FILE;
	else process.env.BUILDER_DATA_FILE = previousBuilderFile;
});

function order(
	id: string,
	status: Order['status'],
	createdAt: string,
	productName: string,
): Order {
	return {
		id,
		number: id,
		customerId: `customer-${id}`,
		customerName: 'مشتری آزمون',
		email: '',
		phone: '',
		city: '',
		address: '',
		items: [{ productId: `product-${id}`, name: productName, sku: id, price: 100, quantity: 2 }],
		subtotal: 200,
		shipping: 0,
		discount: 0,
		total: 200,
		status,
		createdAt,
		updatedAt: createdAt,
	};
}

it('limits reported top products to revenue orders created in the last 30 days', async () => {
	const now = Date.now();
	await updateDatabase((db) => {
		db.orders = [
			order('old-paid', 'paid', new Date(now - 90 * 86_400_000).toISOString(), 'محصول قدیمی'),
			order('recent-pending', 'pending', new Date(now - 2 * 86_400_000).toISOString(), 'محصول در انتظار'),
			order('recent-paid', 'paid', new Date(now - 2 * 86_400_000).toISOString(), 'محصول این دوره'),
		];
	});

	const metrics = await buildDashboardMetrics(30);
	assert.deepEqual(metrics.topProducts, [{ name: 'محصول این دوره', quantity: 2, revenue: 200 }]);
	assert.equal(metrics.revenue.change, null);
	assert.equal(metrics.orders.change, null);
});

function product(id: string, status: Product['status'], stock: number): Product {
	const now = new Date().toISOString();
	return {
		id,
		name: `محصول ${id}`,
		slug: id,
		sku: id.toUpperCase(),
		price: 100,
		stock,
		category: 'آزمون',
		description: '',
		image: '',
		status,
		featured: false,
		createdAt: now,
		updatedAt: now,
	};
}

it('counts low and out-of-stock products from the active catalog only', async () => {
	await updateDatabase((db) => {
		db.products = [
			product('active-out', 'active', 0),
			product('active-low', 'active', 3),
			product('active-ready', 'active', 12),
			product('draft-out', 'draft', 0),
			product('archived-out', 'archived', 0),
		];
	});

	const metrics = await buildDashboardMetrics();
	assert.equal(metrics.activeProducts, 3);
	assert.equal(metrics.outOfStock, 1);
	assert.deepEqual(metrics.lowStock.map((item) => item.id), ['active-out', 'active-low']);
});

it('does not report a percentage change when the comparison period has no orders', async () => {
	await updateDatabase((db) => {
		db.orders = [];
	});

	const metrics = await buildDashboardMetrics();
	assert.equal(metrics.revenue.change, null);
	assert.equal(metrics.orders.change, null);
});

it('distinguishes no confirmed payment from a confirmed zero-value payment', async () => {
	await updateDatabase((db) => {
		db.orders = [];
	});

	const emptyMetrics = await buildDashboardMetrics();
	assert.equal(emptyMetrics.paidOrderCount, 0);

	const zeroValueOrder = order('zero-paid', 'paid', new Date().toISOString(), 'محصول رایگان');
	zeroValueOrder.subtotal = 0;
	zeroValueOrder.total = 0;
	zeroValueOrder.items[0].price = 0;
	await updateDatabase((db) => {
		db.orders = [zeroValueOrder];
	});

	const paidMetrics = await buildDashboardMetrics();
	assert.equal(paidMetrics.paidOrderCount, 1);
	assert.equal(paidMetrics.averageOrder, 0);
});
