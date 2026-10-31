/** سفارش‌ها و تسویه‌حساب فروشگاه. موجودی و شمارندهٔ سفارش در همین‌جا مدیریت می‌شود. */

import { createHash } from 'node:crypto';
import { AppError } from '../errors.ts';
import { newId, readDatabase, updateDatabase } from './db.ts';
import { computeDiscount } from './discounts.ts';
import type { Database, Order, OrderItem, OrderStatus } from './types.ts';
import { isRevenue } from './types.ts';
import { asText, parseEnum, requireText } from './validation.ts';

const FREE_SHIPPING_THRESHOLD = 1_000_000;
const SHIPPING_FEE = 45_000;

export interface CheckoutInput {
	idempotencyKey: string;
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
		.replace(/ك/g, 'ک')
		.replace(/[\u064B-\u065F\u0670]/g, '');
}

export async function listOrders(options: OrderListOptions = {}, snapshot?: Database) {
	const db = snapshot ?? await readDatabase();
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

export async function getOrder(idOrNumber: string, snapshot?: Database): Promise<Order | null> {
	const db = snapshot ?? await readDatabase();
	return db.orders.find((order) => order.id === idOrNumber || order.number === idOrNumber) ?? null;
}

const MAX_ORDER_LINES = 30;
const MAX_ORDER_QUANTITY = 20;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;
const RESTOCKING_STATUSES: OrderStatus[] = ['cancelled', 'refunded'];

function normalizeCheckoutItems(value: unknown): Array<{ productId: string; quantity: number }> {
	if (!Array.isArray(value) || value.length === 0) {
		throw new AppError('سبد خرید خالی است.', 'items');
	}
	if (value.length > MAX_ORDER_LINES) {
		throw new AppError('تعداد ردیف‌های سبد خرید بیش از حد مجاز است.', 'items');
	}

	const quantities = new Map<string, number>();
	for (const item of value) {
		if (!item || typeof item !== 'object') {
			throw new AppError('یکی از اقلام سبد خرید معتبر نیست.', 'items');
		}
		const line = item as { productId?: unknown; quantity?: unknown };
		const productId = requireText(line.productId, 'items', 'شناسهٔ محصول', 120);
		const quantity = Number(line.quantity);
		if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY) {
			throw new AppError(`تعداد هر محصول باید بین ۱ و ${MAX_ORDER_QUANTITY} باشد.`, 'items');
		}

		const combined = (quantities.get(productId) ?? 0) + quantity;
		if (combined > MAX_ORDER_QUANTITY) {
			throw new AppError(`تعداد هر محصول نباید بیشتر از ${MAX_ORDER_QUANTITY} باشد.`, 'items');
		}
		quantities.set(productId, combined);
	}

	return [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
}

function checkoutFingerprint(input: {
	customerName: string;
	email: string;
	phone: string;
	city: string;
	address: string;
	note: string;
	discountCode: string;
	items: Array<{ productId: string; quantity: number }>;
}): string {
	const canonical = {
		...input,
		email: input.email.toLowerCase(),
		discountCode: input.discountCode.toUpperCase(),
		items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)),
	};
	return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * ساخت سفارش از سبد خرید عمومی: قیمت‌ها از دیتابیس خوانده می‌شوند، موجودی
 * aggregate و اعتبارسنجی می‌شود و کلید idempotency از ثبت تکراری جلوگیری می‌کند.
 */
export async function createOrGetOrderFromCheckout(
	input: CheckoutInput,
): Promise<{ order: Order; created: boolean }> {
	const idempotencyKey = asText(input?.idempotencyKey);
	if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
		throw new AppError('شناسهٔ ثبت سفارش معتبر نیست؛ صفحه را تازه‌سازی و دوباره تلاش کنید.', 'idempotencyKey');
	}

	const customerName = requireText(input.customerName, 'customerName', 'نام و نام خانوادگی', 120);
	const phone = requireText(input.phone, 'phone', 'شمارهٔ تماس', 20);
	const address = requireText(input.address, 'address', 'نشانی', 400);
	const email = asText(input.email);
	const city = requireText(input.city, 'city', 'شهر', 60);
	const note = asText(input.note).slice(0, 500);
	const discountCode = asText(input.discountCode).toUpperCase();
	const checkoutItems = normalizeCheckoutItems(input.items);

	if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
		throw new AppError('ایمیل واردشده معتبر نیست.', 'email');
	}

	const fingerprint = checkoutFingerprint({
		customerName,
		email,
		phone,
		city,
		address,
		note,
		discountCode,
		items: checkoutItems,
	});

	return updateDatabase((db) => {
		const existing = db.orders.find((order) => order.checkoutIdempotencyKey === idempotencyKey);
		if (existing) {
			if (existing.checkoutFingerprint !== fingerprint) {
				throw new AppError('این شناسه قبلاً برای اطلاعات دیگری استفاده شده است.', undefined, 409);
			}
			return { order: existing, created: false };
		}

		const items: OrderItem[] = [];
		for (const line of checkoutItems) {
			const product = db.products.find((item) => item.id === line.productId);
			if (!product || product.status !== 'active') {
				throw new AppError('یکی از محصولات سبد خرید دیگر موجود نیست.', 'items');
			}
			if (!Number.isSafeInteger(product.stock) || product.stock < 0 || !Number.isSafeInteger(product.price) || product.price < 0) {
				throw new AppError('اطلاعات موجودی یا قیمت یکی از محصولات نامعتبر است.', 'items', 409);
			}
			if (product.stock < line.quantity) {
				throw new AppError(`موجودی «${product.name}» کافی نیست.`, 'items', 409);
			}
			items.push({
				productId: product.id,
				name: product.name,
				sku: product.sku,
				price: product.price,
				quantity: line.quantity,
			});
		}

		const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
		if (!Number.isSafeInteger(subtotal)) {
			throw new AppError('مبلغ سفارش از محدودهٔ مجاز بیشتر است.', 'items', 409);
		}
		const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
		const applied = computeDiscount(db, discountCode, subtotal);
		const discount = applied?.amount ?? 0;
		const total = Math.max(0, subtotal - discount) + shipping;
		if (!Number.isSafeInteger(total)) {
			throw new AppError('مبلغ نهایی سفارش معتبر نیست.', 'items', 409);
		}

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
			product.stock -= item.quantity;
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
			checkoutIdempotencyKey: idempotencyKey,
			checkoutFingerprint: fingerprint,
			paymentState: 'not-started',
			note: note || undefined,
			createdAt: now,
			updatedAt: now,
		};

		db.orders.unshift(order);
		return { order, created: true };
	});
}

/** Compatibility helper for callers that need only the order record. */
export async function createOrderFromCheckout(input: CheckoutInput): Promise<Order> {
	return (await createOrGetOrderFromCheckout(input)).order;
}

export async function findOrderByCheckoutIdempotencyKey(key: string): Promise<Order | null> {
	const db = await readDatabase();
	return db.orders.find((order) => order.checkoutIdempotencyKey === key) ?? null;
}

function applyOrderStatusTransition(db: Database, order: Order, status: OrderStatus): void {
	const willRestock = RESTOCKING_STATUSES.includes(status) && !RESTOCKING_STATUSES.includes(order.status);
	if (willRestock) {
		for (const item of order.items) {
			const product = db.products.find((candidate) => candidate.id === item.productId);
			if (product) {
				product.stock += item.quantity;
				product.updatedAt = new Date().toISOString();
			}
		}

		// A discount is reserved when the order is created; release it on cancellation/refund.
		if (order.discountCode) {
			const discount = db.discounts.find((item) => item.code === order.discountCode);
			if (discount) discount.usedCount = Math.max(0, discount.usedCount - 1);
		}
	}

	order.status = status;
	order.updatedAt = new Date().toISOString();
	if (status === 'paid' && order.paymentState === 'verifying') order.paymentState = 'verified';
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
	return updateDatabase((db) => {
		const order = db.orders.find((item) => item.id === id);
		if (!order) throw new AppError('سفارش پیدا نشد.', undefined, 404);
		applyOrderStatusTransition(db, order, status);
		return order;
	});
}

/** Claim the one allowed payment-initiation attempt for an order. */
export async function claimPaymentInitiation(id: string): Promise<boolean> {
	return updateDatabase((db) => {
		const order = db.orders.find((item) => item.id === id);
		if (!order) throw new AppError('سفارش پیدا نشد.', undefined, 404);
		const state = order.paymentState ?? (order.paymentRef ? 'initiated' : 'not-started');
		if (order.status !== 'pending' || state !== 'not-started') return false;
		order.paymentState = 'initiating';
		order.updatedAt = new Date().toISOString();
		return true;
	});
}

/** Persist the provider session (or record that no payment adapter is active). */
export async function completePaymentInitiation(
	id: string,
	payment: { authority: string; url: string } | null,
): Promise<Order> {
	return updateDatabase((db) => {
		const order = db.orders.find((item) => item.id === id);
		if (!order) throw new AppError('سفارش پیدا نشد.', undefined, 404);
		if (order.paymentState !== 'initiating') {
			throw new AppError('وضعیت درخواست پرداخت تغییر کرده است.', undefined, 409);
		}
		if (payment) {
			order.paymentRef = payment.authority;
			order.paymentUrl = payment.url;
			order.paymentState = 'initiated';
		} else {
			order.paymentState = 'not-configured';
		}
		order.updatedAt = new Date().toISOString();
		return order;
	});
}

/** Record an ambiguous provider request; it must not be automatically re-issued. */
export async function markPaymentInitiationUnknown(id: string): Promise<void> {
	await updateDatabase((db) => {
		const order = db.orders.find((item) => item.id === id);
		if (!order) throw new AppError('سفارش پیدا نشد.', undefined, 404);
		if (order.paymentState === 'initiating') {
			order.paymentState = 'unknown';
			order.updatedAt = new Date().toISOString();
		}
	});
}

/** Atomically claim callback verification so duplicate callbacks do not call the provider twice. */
export async function claimOrderPaymentVerification(id: string, authority: string): Promise<boolean> {
	return updateDatabase((db) => {
		const order = db.orders.find((item) => item.id === id);
		if (!order) throw new AppError('سفارش پیدا نشد.', undefined, 404);
		const state = order.paymentState ?? (order.paymentRef ? 'initiated' : 'not-started');
		if (
			order.status !== 'pending' ||
			order.paymentRef !== authority ||
			state !== 'initiated'
		) return false;
		order.paymentState = 'verifying';
		order.updatedAt = new Date().toISOString();
		return true;
	});
}

/** Fail closed on an ambiguous verification response; an operator must reconcile it. */
export async function markOrderPaymentUnknown(id: string, authority: string): Promise<void> {
	await updateDatabase((db) => {
		const order = db.orders.find((item) => item.id === id);
		if (!order) throw new AppError('سفارش پیدا نشد.', undefined, 404);
		if (
			order.status === 'pending' &&
			order.paymentRef === authority &&
			(order.paymentState === 'verifying' || order.paymentState === 'initiating')
		) {
			order.paymentState = 'unknown';
			order.updatedAt = new Date().toISOString();
		}
	});
}

/** Compare-and-set successful payment settlement; side effects happen at most once. */
export async function settleOrderPayment(
	id: string,
	authority: string,
): Promise<{ order: Order; changed: boolean }> {
	return updateDatabase((db) => {
		const order = db.orders.find((item) => item.id === id);
		if (!order || order.paymentRef !== authority) {
			throw new AppError('سفارش پیدا نشد.', undefined, 404);
		}
		if (order.status !== 'pending' || order.paymentState !== 'verifying') {
			return { order, changed: false };
		}

		applyOrderStatusTransition(db, order, 'paid');
		order.paymentState = 'verified';
		return { order, changed: true };
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

/** Compatibility helper for adapters/tests that persist a provider reference directly. */
export async function updateOrderPaymentRef(id: string, paymentRef: string): Promise<Order> {
	const authority = requireText(paymentRef, 'paymentRef', 'مرجع پرداخت', 200);
	return updateDatabase((db) => {
		const order = db.orders.find((item) => item.id === id);
		if (!order) throw new AppError('سفارش پیدا نشد.', undefined, 404);
		if (order.paymentRef && order.paymentRef !== authority) {
			throw new AppError('برای این سفارش مرجع پرداخت دیگری ثبت شده است.', undefined, 409);
		}
		order.paymentRef = authority;
		order.paymentState = 'initiated';
		order.updatedAt = new Date().toISOString();
		return order;
	});
}

/** یافتن سفارش بر اساس مرجع پرداخت (Authority). */
export async function findOrderByPaymentRef(paymentRef: string): Promise<Order | null> {
	const db = await readDatabase();
	return db.orders.find((item) => item.paymentRef === paymentRef) ?? null;
}

export async function listCustomers(query = '', snapshot?: Database) {
	const db = snapshot ?? await readDatabase();
	const needle = normalize(query.trim());
	// Index once rather than scanning and sorting all orders for every customer.
	const byCustomer = new Map<string, { ordersCount: number; totalSpent: number; lastOrderAt: string | undefined }>();
	for (const order of db.orders) {
		const entry = byCustomer.get(order.customerId) ?? { ordersCount: 0, totalSpent: 0, lastOrderAt: undefined };
		entry.ordersCount++;
		if (isRevenue(order.status)) entry.totalSpent += order.total;
		if (entry.lastOrderAt === undefined || order.createdAt > entry.lastOrderAt) entry.lastOrderAt = order.createdAt;
		byCustomer.set(order.customerId, entry);
	}
	const rows = db.customers
		.map((customer) => ({
			...customer,
			...(byCustomer.get(customer.id) ?? { ordersCount: 0, totalSpent: 0, lastOrderAt: undefined }),
		}))
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
