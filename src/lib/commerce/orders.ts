/** سفارش‌ها و تسویه‌حساب فروشگاه. موجودی و شمارندهٔ سفارش در همین‌جا مدیریت می‌شود. */

import { AppError } from '../errors.ts';
import { newId, readDatabase, updateDatabase } from './db.ts';
import { computeDiscount } from './discounts.ts';
import type { Database, Order, OrderItem, OrderStatus } from './types.ts';
import { isRevenue } from './types.ts';
import { asText, parseEnum, requireText } from './validation.ts';

const FREE_SHIPPING_THRESHOLD = 1_000_000;
const SHIPPING_FEE = 45_000;

export interface CheckoutInput {
	customerName: string;
	email: string;
	phone: string;
	city: string;
	address: string;
	note?: string;
	discountCode?: string;
	items: Array<{ productId: string; quantity: number }>;
}

export interface OrderListOptions {
	query?: string;
	status?: OrderStatus | 'all';
	sort?: 'newest' | 'oldest' | 'total-desc' | 'total-asc';
	page?: number;
	perPage?: number;
}

function normalize(value: string): string {
	return value
		.toLowerCase()
		.replace(/[يى]/g, 'ی')
		.replace(/ك/g, 'ک');
}

export async function listOrders(options: OrderListOptions = {}) {
	const db = await readDatabase();
	const { query = '', status = 'all', sort = 'newest', page = 1, perPage = 10 } = options;
	const needle = normalize(query.trim());

	let items = db.orders.filter((order) => {
		const matchesStatus = status === 'all' || order.status === status;
		const haystack = normalize(`${order.number} ${order.customerName} ${order.email} ${order.phone}`);
		return matchesStatus && (!needle || haystack.includes(needle));
	});

	items = [...items].sort((a, b) => {
		switch (sort) {
			case 'oldest':
				return new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf();
			case 'total-desc':
				return b.total - a.total;
			case 'total-asc':
				return a.total - b.total;
			default:
				return new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf();
		}
	});

	const total = items.length;
	const pages = Math.max(1, Math.ceil(total / perPage));
	const current = Math.min(Math.max(1, page), pages);

	return {
		items: items.slice((current - 1) * perPage, current * perPage),
		total,
		pages,
		page: current,
		perPage,
		counts: {
			all: db.orders.length,
			pending: db.orders.filter((order) => order.status === 'pending').length,
			processing: db.orders.filter((order) => order.status === 'processing').length,
			shipped: db.orders.filter((order) => order.status === 'shipped').length,
			delivered: db.orders.filter((order) => order.status === 'delivered').length,
			cancelled: db.orders.filter((order) => order.status === 'cancelled').length,
		},
	};
}

export async function getOrder(idOrNumber: string): Promise<Order | null> {
	const db = await readDatabase();
	return db.orders.find((order) => order.id === idOrNumber || order.number === idOrNumber) ?? null;
}

/**
 * ساخت سفارش از سبد خرید عمومی: قیمت‌ها همیشه از سرور خوانده می‌شوند تا
 * کاربر نتواند قیمت را دستکاری کند، موجودی کسر می‌شود و تخفیف اعتبارسنجی می‌گردد.
 */
export async function createOrderFromCheckout(input: CheckoutInput): Promise<Order> {
	const customerName = requireText(input.customerName, 'customerName', 'نام و نام خانوادگی', 120);
	const phone = requireText(input.phone, 'phone', 'شمارهٔ تماس', 20);
	const address = requireText(input.address, 'address', 'نشانی', 400);
	const email = asText(input.email);
	const city = requireText(input.city, 'city', 'شهر', 60);

	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new AppError('ایمیل واردشده معتبر نیست.', 'email');
	}
	if (input.items.length === 0) {
		throw new AppError('سبد خرید خالی است.', 'items');
	}

	return updateDatabase((db) => {
		const items: OrderItem[] = [];

		for (const line of input.items) {
			const quantity = Math.max(1, Math.round(line.quantity));
			const product = db.products.find((item) => item.id === line.productId);
			if (!product || product.status !== 'active') {
				throw new AppError('یکی از محصولات سبد خرید دیگر موجود نیست.', 'items');
			}
			if (product.stock < quantity) {
				throw new AppError(`موجودی «${product.name}» کافی نیست.`, 'items');
			}
			items.push({
				productId: product.id,
				name: product.name,
				sku: product.sku,
				price: product.price,
				quantity,
			});
		}

		const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
		const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
		const applied = computeDiscount(db, input.discountCode ?? '', subtotal);
		const discount = applied?.amount ?? 0;
		const total = Math.max(0, subtotal - discount) + shipping;

		const customer =
			db.customers.find(
				(item) =>
					(item.email && email && item.email.toLowerCase() === email.toLowerCase()) ||
					(item.phone && item.phone === phone),
			) ??
			(() => {
				const created = {
					id: newId('cus'),
					name: customerName,
					email,
					phone,
					city,
					createdAt: new Date().toISOString(),
				};
				db.customers.push(created);
				return created;
			})();

		if (applied) applied.discount.usedCount += 1;

		for (const item of items) {
			const product = db.products.find((candidate) => candidate.id === item.productId)!;
			product.stock = Math.max(0, product.stock - item.quantity);
			product.updatedAt = new Date().toISOString();
		}

		db.counters.order += 1;
		const now = new Date().toISOString();
		const order: Order = {
			id: newId('ord'),
			number: `NVX-${db.counters.order}`,
			customerId: customer.id,
			customerName,
			email,
			phone,
			city,
			address,
			items,
			subtotal,
			shipping,
			discountCode: applied?.discount.code,
			discount,
			total,
			status: 'pending',
			note: asText(input.note).slice(0, 500) || undefined,
			createdAt: now,
			updatedAt: now,
		};

		db.orders.unshift(order);
		return order;
	});
}

const RESTOCKING_STATUSES: OrderStatus[] = ['cancelled', 'refunded'];

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
	return updateDatabase((db) => {
		const order = db.orders.find((item) => item.id === id);
		if (!order) throw new AppError('سفارش پیدا نشد.', undefined, 404);

		const wasRevenue = isRevenue(order.status);
		const willRestock = RESTOCKING_STATUSES.includes(status) && !RESTOCKING_STATUSES.includes(order.status);

		if (willRestock) {
			for (const item of order.items) {
				const product = db.products.find((candidate) => candidate.id === item.productId);
				if (product) {
					product.stock += item.quantity;
					product.updatedAt = new Date().toISOString();
				}
			}
		}

		order.status = status;
		order.updatedAt = new Date().toISOString();

		// اگر سفارش از حالت درآمدی خارج شود و کد تخفیف داشته باشد، مصرف آن آزاد می‌شود.
		if (wasRevenue && RESTOCKING_STATUSES.includes(status) && order.discountCode) {
			const discount = db.discounts.find((item) => item.code === order.discountCode);
			if (discount) discount.usedCount = Math.max(0, discount.usedCount - 1);
		}

		return order;
	});
}

export async function updateOrderNote(id: string, note: string): Promise<Order> {
	return updateDatabase((db) => {
		const order = db.orders.find((item) => item.id === id);
		if (!order) throw new AppError('سفارش پیدا نشد.', undefined, 404);
		order.note = note.slice(0, 500) || undefined;
		order.updatedAt = new Date().toISOString();
		return order;
	});
}

/** ذخیرهٔ مرجع پرداخت (مثل Authority درگاه زرین‌پال) در سفارش. */
export async function updateOrderPaymentRef(id: string, paymentRef: string): Promise<Order> {
	return updateDatabase((db) => {
		const order = db.orders.find((item) => item.id === id);
		if (!order) throw new AppError('سفارش پیدا نشد.', undefined, 404);
		order.paymentRef = paymentRef;
		order.updatedAt = new Date().toISOString();
		return order;
	});
}

/** یافتن سفارش بر اساس مرجع پرداخت (Authority). */
export async function findOrderByPaymentRef(paymentRef: string): Promise<Order | null> {
	const db = await readDatabase();
	return db.orders.find((item) => item.paymentRef === paymentRef) ?? null;
}

export async function listCustomers(query = '') {
	const db = await readDatabase();
	const needle = normalize(query.trim());
	const rows = db.customers
		.map((customer) => {
			const orders = db.orders.filter((order) => order.customerId === customer.id);
			const paid = orders.filter((order) => isRevenue(order.status));
			return {
				...customer,
				ordersCount: orders.length,
				totalSpent: paid.reduce((sum, order) => sum + order.total, 0),
				lastOrderAt: orders
					.map((order) => order.createdAt)
					.sort()
					.at(-1),
			};
		})
		.filter((customer) =>
			!needle
				? true
				: normalize(`${customer.name} ${customer.email} ${customer.phone} ${customer.city}`).includes(
						needle,
					),
		)
		.sort((a, b) => b.totalSpent - a.totalSpent);

	return rows;
}

export async function listPublicOrdersForCustomer(email: string): Promise<Order[]> {
	const db = await readDatabase();
	const normalized = email.trim().toLowerCase();
	return db.orders
		.filter((order) => order.email.toLowerCase() === normalized)
		.sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf());
}

export const ORDER_STATUS_VALUES: OrderStatus[] = [
	'pending',
	'paid',
	'processing',
	'shipped',
	'delivered',
	'cancelled',
	'refunded',
];

export const toOrderStatus = (value: unknown) =>
	parseEnum<OrderStatus>(value, ORDER_STATUS_VALUES, 'pending', 'status', 'وضعیت سفارش');

export const SHIPPING = { fee: SHIPPING_FEE, freeThreshold: FREE_SHIPPING_THRESHOLD };
export type { Database };
