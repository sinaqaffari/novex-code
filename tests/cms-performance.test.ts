import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, it } from 'node:test';
import type { PostSummary } from '../src/lib/cms/posts.ts';
import type { Customer, Database, Order, Product } from '../src/lib/commerce/types.ts';

const directory = await mkdtemp(join(tmpdir(), 'novex-cms-performance-'));
const previous = {
	commerce: process.env.COMMERCE_DB_FILE,
	settings: process.env.CMS_SETTINGS_FILE,
	builder: process.env.BUILDER_DATA_FILE,
	assets: process.env.CMS_ASSETS_DIR,
	blog: process.env.CMS_BLOG_DIR,
};
process.env.COMMERCE_DB_FILE = join(directory, 'commerce.json');
process.env.CMS_SETTINGS_FILE = join(directory, 'settings.json');
process.env.BUILDER_DATA_FILE = join(directory, 'builder.json');
process.env.CMS_ASSETS_DIR = join(directory, 'assets');
process.env.CMS_BLOG_DIR = join(directory, 'blog');
const { createEmptyDatabase } = await import('../src/lib/commerce/db.ts');
const { calculateDashboardMetrics } = await import('../src/lib/commerce/stats.ts');
const { listCustomers, listOrders } = await import('../src/lib/commerce/orders.ts');
const { isRevenue } = await import('../src/lib/commerce/types.ts');
const { requestCommerce, requestSettings } = await import('../src/lib/cms/request-data.ts');
const { filterPosts, paginate } = await import('../src/lib/cms/listing.ts');
const { listMedia } = await import('../src/lib/cms/media.ts');

after(async () => {
	await rm(directory, { recursive: true, force: true });
	for (const [key, value] of Object.entries({ COMMERCE_DB_FILE: previous.commerce, CMS_SETTINGS_FILE: previous.settings, BUILDER_DATA_FILE: previous.builder, CMS_ASSETS_DIR: previous.assets, CMS_BLOG_DIR: previous.blog })) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
});

function order(id: string, status: Order['status'], createdAt: string, customerId = 'one'): Order {
	return { id, number: id, customerId, customerName: 'مشتری', email: '', phone: '', city: '', address: '',
		items: [{ productId: 'p', name: id.includes('a') ? 'الف' : 'ب', sku: 'p', price: 10, quantity: 2 }],
		subtotal: 20, shipping: 0, discount: 0, total: 20, status, createdAt, updatedAt: createdAt };
}

/** The previous definitions, including local-midnight chart boundaries. */
function reference(db: Database, days: number, now: Date) {
	const DAY = 86_400_000;
	const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
	const today = start(now);
	const currentStart = new Date(today.getTime() - 29 * DAY);
	const previousStart = new Date(today.getTime() - 59 * DAY);
	const current = db.orders.filter((item) => new Date(item.createdAt) >= currentStart);
	const previous = db.orders.filter((item) => new Date(item.createdAt) >= previousStart && new Date(item.createdAt) < currentStart);
	const revenue = (items: Order[]) => items.filter((item) => isRevenue(item.status)).reduce((sum, item) => sum + item.total, 0);
	const pct = (a: number, b: number) => b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10;
	const paid = current.filter((item) => isRevenue(item.status));
	const series = [];
	for (let i = days - 1; i >= 0; i--) {
		const day = start(new Date(today.getTime() - i * DAY));
		const next = new Date(day.getTime() + DAY);
		series.push({ date: day.toISOString(), total: db.orders.filter((item) => new Date(item.createdAt) >= day && new Date(item.createdAt) < next && isRevenue(item.status)).reduce((sum, item) => sum + item.total, 0) });
	}
	const units = new Map<string, { quantity: number; revenue: number }>();
	for (const item of paid.flatMap((entry) => entry.items)) {
		const value = units.get(item.name) ?? { quantity: 0, revenue: 0 };
		value.quantity += item.quantity; value.revenue += item.price * item.quantity; units.set(item.name, value);
	}
	return {
		revenue: { current: revenue(current), previous: revenue(previous), change: pct(revenue(current), revenue(previous)) },
		orders: { current: current.length, previous: previous.length, change: pct(current.length, previous.length) },
		averageOrder: paid.length ? Math.round(revenue(current) / paid.length) : 0,
		paidOrderCount: paid.length,
		pending: db.orders.filter((item) => item.status === 'pending').length,
		customers: db.customers.length,
		activeProducts: db.products.filter((item) => item.status === 'active').length,
		outOfStock: db.products.filter((item) => item.status === 'active' && item.stock === 0).length,
		lowStock: db.products.filter((item) => item.status === 'active' && item.stock <= 5).sort((a, b) => a.stock - b.stock).slice(0, 5),
		topProducts: [...units].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.revenue - a.revenue).slice(0, 4),
		series,
		recentOrders: [...db.orders].sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf()).slice(0, 5),
		discountUsage: db.discounts.reduce((sum, item) => sum + item.usedCount, 0),
	};
}

it('preserves every dashboard metric at period boundaries, including DST and invalid dates', () => {
	const oldTz = process.env.TZ;
	try {
		for (const tz of ['UTC', 'America/New_York', 'Asia/Tehran']) {
			process.env.TZ = tz;
			for (const now of [new Date('2026-03-10T12:00:00Z'), new Date('2026-11-03T12:00:00Z')]) {
				const db = createEmptyDatabase();
				const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).valueOf();
				const offsets = [-90, -60, -59, -30, -29, -14, -2, -1, 0, 1, 5];
				db.orders = offsets.flatMap((offset, index) => [
					order(`a${index}`, index % 2 ? 'pending' : 'paid', new Date(today + offset * 86_400_000).toISOString()),
					order(`b${index}`, 'shipped', new Date(today + offset * 86_400_000 + 3_600_000).toISOString()),
				]);
				db.orders.push(order('invalid', 'paid', 'not-a-date'));
				db.products = [0, 3, 9].map((stock, index) => ({ id: `p${index}`, status: 'active', stock } as Product));
				for (const days of [0, 14, 30]) assert.deepEqual(calculateDashboardMetrics(db, days, now), reference(db, days, now), `${tz}, ${now.toISOString()}, ${days} days`);
			}
		}
	} finally { if (oldTz === undefined) delete process.env.TZ; else process.env.TZ = oldTz; }
});

it('parses each order date once rather than once per chart day', () => {
	const db = createEmptyDatabase();
	let reads = 0;
	db.orders = Array.from({ length: 1000 }, (_, index) => {
		const item = order(String(index), 'paid', '2026-10-01T12:00:00.000Z');
		Object.defineProperty(item, 'createdAt', { get() { reads++; return '2026-10-01T12:00:00.000Z'; } });
		return item;
	});
	calculateDashboardMetrics(db, 30, new Date('2026-10-15T12:00:00Z'));
	assert.equal(reads, db.orders.length);
});

it('indexes customers once while retaining counts, revenue and lexicographic last order', async () => {
	const db = createEmptyDatabase();
	db.customers = [
		{ id: 'one', name: 'علی', email: '', phone: '', city: '', createdAt: '' },
		{ id: 'two', name: 'مینا', email: '', phone: '', city: '', createdAt: '' },
		{ id: 'empty', name: 'بدون سفارش', email: '', phone: '', city: '', createdAt: '' },
	] satisfies Customer[];
	db.orders = [order('a', 'paid', '2026-01-01', 'one'), order('b', 'pending', '2026-03-01', 'one'), order('c', 'refunded', '2026-02-01', 'two')];
	const result = await listCustomers('', db);
	assert.deepEqual(result.map(({ id, ordersCount, totalSpent, lastOrderAt }) => ({ id, ordersCount, totalSpent, lastOrderAt })), [
		{ id: 'one', ordersCount: 2, totalSpent: 20, lastOrderAt: '2026-03-01' },
		{ id: 'two', ordersCount: 1, totalSpent: 0, lastOrderAt: '2026-02-01' },
		{ id: 'empty', ordersCount: 0, totalSpent: 0, lastOrderAt: undefined },
	]);
	assert.deepEqual((await listCustomers('مينا', db)).map((item) => item.id), ['two']);
});

it('coalesces reads within one request but sees fresh files in the next request', async () => {
	const db = createEmptyDatabase();
	await writeFile(process.env.COMMERCE_DB_FILE!, JSON.stringify(db));
	await writeFile(process.env.CMS_SETTINGS_FILE!, JSON.stringify({ siteTitle: 'اول' }));
	const one = {};
	assert.strictEqual(requestCommerce(one), requestCommerce(one));
	assert.strictEqual(requestSettings(one), requestSettings(one));
	const [firstDb, firstSettings] = await Promise.all([requestCommerce(one), requestSettings(one)]);
	db.orders.push(order('new', 'pending', '2026-10-01'));
	await writeFile(process.env.COMMERCE_DB_FILE!, JSON.stringify(db));
	await writeFile(process.env.CMS_SETTINGS_FILE!, JSON.stringify({ siteTitle: 'دوم' }));
	assert.equal((await requestCommerce(one)).orders.length, 0);
	assert.equal((await requestSettings(one)).siteTitle, 'اول');
	const two = {};
	assert.equal((await requestCommerce(two)).orders.length, 1);
	assert.equal((await requestSettings(two)).siteTitle, 'دوم');
	assert.notStrictEqual(await requestCommerce(two), firstDb);
	assert.notStrictEqual(await requestSettings(two), firstSettings);
});

it('filters and paginates posts across the complete dataset without losing URL state', () => {
	const posts = Array.from({ length: 43 }, (_, index) => ({ id: `${index}.md`, title: index === 42 ? 'كتاب فارسی' : `نوشته ${index}`, description: '', slug: `${index}`, tags: [index % 2 ? 'الف' : 'ب'], draft: index % 2 === 0 } as PostSummary));
	assert.equal(filterPosts(posts, { query: 'کتاب' })[0]?.id, '42.md');
	const drafts = filterPosts(posts, { status: 'draft' });
	assert.equal(drafts.length, 22);
	assert.deepEqual(paginate(drafts, 2, 20).items.map((item) => item.id), ['40.md', '42.md']);
	assert.equal(paginate(posts, 1000, 20).page, 3);
	assert.equal(paginate(posts, Number.NaN, 20).page, 1);
	assert.equal(filterPosts(posts, { status: 'published', tag: 'ب' }).length, 0);
});

it('retains media identity and default dimensions when callers opt out of metadata reads', async () => {
	const uploads = join(directory, 'assets', 'uploads');
	await mkdir(uploads, { recursive: true });
	await cp('src/assets/blog-placeholder-1.jpg', join(uploads, 'example.jpg'));
	const full = await listMedia();
	const lightweight = await listMedia({ dimensions: false });
	assert.deepEqual(lightweight.map(({ width: _width, height: _height, ...item }) => item),
		full.map(({ width: _width, height: _height, ...item }) => item));
	assert.ok(full.find((item) => item.name === 'example.jpg')?.width);
	assert.ok(full.find((item) => item.name === 'builder-studio.jpg')?.height);
	assert.ok(lightweight.every((item) => item.width === undefined && item.height === undefined));
});

it('keeps order-list searches consistent with Persian-normalized global search', async () => {
	const db = createEmptyDatabase();
	db.orders = [{ ...order('test', 'pending', '2026-10-01'), customerName: 'مُحمد كريم' }];
	assert.equal((await listOrders({ query: 'محمد کریم' }, db)).total, 1);
	assert.equal((await listOrders({ query: 'مُحمد كريم' }, db)).total, 1);
});
