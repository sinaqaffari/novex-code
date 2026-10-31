/** Server-side sales metrics. All figures come from the persisted commerce snapshot. */

import { readDatabase } from './db.ts';
import type { Database, Order, Product } from './types.ts';
import { isRevenue } from './types.ts';

const DAY = 86_400_000;

export interface DashboardMetrics {
	revenue: { current: number; previous: number; change: number | null };
	orders: { current: number; previous: number; change: number | null };
	averageOrder: number;
	paidOrderCount: number;
	pending: number;
	customers: number;
	activeProducts: number;
	outOfStock: number;
	lowStock: Product[];
	topProducts: Array<{ name: string; quantity: number; revenue: number }>;
	series: Array<{ date: string; total: number }>;
	recentOrders: Order[];
	discountUsage: number;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

function percentChange(current: number, previous: number): number | null {
	if (previous === 0) return null;
	return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Calculate from one request's snapshot without repeatedly parsing dates for every chart day. */
export function calculateDashboardMetrics(db: Database, days = 14, now = new Date()): DashboardMetrics {
	const today = startOfDay(now);
	const periodStart = today.getTime() - 29 * DAY;
	const previousStart = today.getTime() - 59 * DAY;
	const series: DashboardMetrics['series'] = [];
	const starts: number[] = [];
	for (let index = days - 1; index >= 0; index -= 1) {
		const day = startOfDay(new Date(today.getTime() - index * DAY));
		starts.push(day.getTime());
		series.push({ date: day.toISOString(), total: 0 });
	}

	let revenueCurrent = 0;
	let revenuePrevious = 0;
	let ordersCurrent = 0;
	let ordersPrevious = 0;
	let paidCurrent = 0;
	let pending = 0;
	const unitsByProduct = new Map<string, { quantity: number; revenue: number }>();
	const datedOrders: Array<{ order: Order; created: number }> = [];

	for (const order of db.orders) {
		const created = new Date(order.createdAt).valueOf();
		const revenue = isRevenue(order.status);
		datedOrders.push({ order, created });
		if (order.status === 'pending') pending++;

		if (created >= periodStart) {
			ordersCurrent++;
			if (revenue) {
				revenueCurrent += order.total;
				paidCurrent++;
				for (const item of order.items) {
					const entry = unitsByProduct.get(item.name) ?? { quantity: 0, revenue: 0 };
					entry.quantity += item.quantity;
					entry.revenue += item.price * item.quantity;
					unitsByProduct.set(item.name, entry);
				}
			}
		} else if (created >= previousStart && created < periodStart) {
			ordersPrevious++;
			if (revenue) revenuePrevious += order.total;
		}

		if (!revenue || !Number.isFinite(created)) continue;
		// The original ranges are local midnights plus 24 hours. Around DST,
		// ranges can overlap or share a start; find and include every match.
		let low = 0;
		let high = starts.length;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if (starts[middle] + DAY <= created) low = middle + 1;
			else high = middle;
		}
		for (let index = low; index < starts.length && starts[index] <= created; index++) {
			if (created < starts[index] + DAY) series[index].total += order.total;
		}
	}

	let activeProducts = 0;
	let outOfStock = 0;
	const lowStock: Product[] = [];
	for (const product of db.products) {
		if (product.status !== 'active') continue;
		activeProducts++;
		if (product.stock === 0) outOfStock++;
		if (product.stock <= 5) lowStock.push(product);
	}

	return {
		revenue: { current: revenueCurrent, previous: revenuePrevious, change: percentChange(revenueCurrent, revenuePrevious) },
		orders: { current: ordersCurrent, previous: ordersPrevious, change: percentChange(ordersCurrent, ordersPrevious) },
		averageOrder: paidCurrent ? Math.round(revenueCurrent / paidCurrent) : 0,
		paidOrderCount: paidCurrent,
		pending,
		customers: db.customers.length,
		activeProducts,
		outOfStock,
		lowStock: lowStock.sort((a, b) => a.stock - b.stock).slice(0, 5),
		topProducts: [...unitsByProduct.entries()]
			.map(([name, value]) => ({ name, ...value }))
			.sort((a, b) => b.revenue - a.revenue)
			.slice(0, 4),
		series,
		recentOrders: datedOrders.sort((a, b) => b.created - a.created).slice(0, 5).map(({ order }) => order),
		discountUsage: db.discounts.reduce((sum, discount) => sum + discount.usedCount, 0),
	};
}

/** Optional snapshot is supplied only by a request-scoped, read-only rendering path. */
export async function buildDashboardMetrics(days = 14, snapshot?: Database): Promise<DashboardMetrics> {
	return calculateDashboardMetrics(snapshot ?? await readDatabase(), days);
}
