/** آمار فروش برای داشبورد پنل. همهٔ محاسبات سمت سرور و بدون وابستگی به فرانت‌اند است. */

import { readDatabase } from './db.ts';
import type { Order, Product } from './types.ts';
import { isRevenue } from './types.ts';

const DAY = 86_400_000;

export interface DashboardMetrics {
	revenue: { current: number; previous: number; change: number | null };
	orders: { current: number; previous: number; change: number | null };
	averageOrder: number;
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
const revenueOf = (orders: Order[]) =>
	orders.filter((order) => isRevenue(order.status)).reduce((sum, order) => sum + order.total, 0);

function percentChange(current: number, previous: number): number | null {
	if (previous === 0) return current > 0 ? null : 0;
	return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function buildDashboardMetrics(days = 14): Promise<DashboardMetrics> {
	const db = await readDatabase();
	const now = new Date();
	const today = startOfDay(now);
	const periodStart = new Date(today.getTime() - 29 * DAY);
	const previousStart = new Date(today.getTime() - 59 * DAY);

	const inLast30 = db.orders.filter((order) => new Date(order.createdAt) >= periodStart);
	const inPrevious30 = db.orders.filter((order) => {
		const created = new Date(order.createdAt);
		return created >= previousStart && created < periodStart;
	});

	const revenueCurrent = revenueOf(inLast30);
	const revenuePrevious = revenueOf(inPrevious30);
	const ordersCurrent = inLast30.length;
	const ordersPrevious = inPrevious30.length;
	const paidCurrent = inLast30.filter((order) => isRevenue(order.status)).length;

	const series: Array<{ date: string; total: number }> = [];
	for (let index = days - 1; index >= 0; index -= 1) {
		const day = startOfDay(new Date(today.getTime() - index * DAY));
		const next = new Date(day.getTime() + DAY);
		const total = db.orders
			.filter((order) => {
				const created = new Date(order.createdAt);
				return created >= day && created < next && isRevenue(order.status);
			})
			.reduce((sum, order) => sum + order.total, 0);
		series.push({ date: day.toISOString(), total });
	}

	const unitsByProduct = new Map<string, { quantity: number; revenue: number }>();
	for (const order of inLast30) {
		if (!isRevenue(order.status)) continue;
		for (const item of order.items) {
			const entry = unitsByProduct.get(item.name) ?? { quantity: 0, revenue: 0 };
			entry.quantity += item.quantity;
			entry.revenue += item.price * item.quantity;
			unitsByProduct.set(item.name, entry);
		}
	}

	return {
		revenue: {
			current: revenueCurrent,
			previous: revenuePrevious,
			change: percentChange(revenueCurrent, revenuePrevious),
		},
		orders: {
			current: ordersCurrent,
			previous: ordersPrevious,
			change: percentChange(ordersCurrent, ordersPrevious),
		},
		averageOrder: paidCurrent ? Math.round(revenueCurrent / paidCurrent) : 0,
		pending: db.orders.filter((order) => order.status === 'pending').length,
		customers: db.customers.length,
		activeProducts: db.products.filter((product) => product.status === 'active').length,
		outOfStock: db.products.filter((product) => product.stock === 0).length,
		lowStock: db.products
			.filter((product) => product.status === 'active' && product.stock <= 5)
			.sort((a, b) => a.stock - b.stock)
			.slice(0, 5),
		topProducts: [...unitsByProduct.entries()]
			.map(([name, value]) => ({ name, ...value }))
			.sort((a, b) => b.revenue - a.revenue)
			.slice(0, 4),
		series,
		recentOrders: [...db.orders]
			.sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf())
			.slice(0, 5),
		discountUsage: db.discounts.reduce((sum, discount) => sum + discount.usedCount, 0),
	};
}
