/**
 * تجارت — مدل دادهٔ فروشگاه
 *
 * محصولات، سفارش‌ها، مشتریان و کدهای تخفیف در یک فایل JSON نگهداری می‌شوند
 * (data/commerce.json) تا بدون پایگاه‌داده هم پنل کامل کار کند و هم بشود
 * بعداً با یک مخزن واقعی (Postgres/SQLite) جایگزینش کرد.
 */

export type ProductStatus = 'active' | 'draft' | 'archived';

export interface Product {
	id: string;
	name: string;
	slug: string;
	sku: string;
	price: number;
	compareAtPrice?: number;
	stock: number;
	category: string;
	description: string;
	image: string;
	status: ProductStatus;
	featured: boolean;
	createdAt: string;
	updatedAt: string;
}

export type OrderStatus =
	| 'pending'
	| 'paid'
	| 'processing'
	| 'shipped'
	| 'delivered'
	| 'cancelled'
	| 'refunded';

export interface OrderItem {
	productId: string;
	name: string;
	sku: string;
	price: number;
	quantity: number;
}

export type PaymentState =
	| 'not-started'
	| 'initiating'
	| 'not-configured'
	| 'initiated'
	| 'verifying'
	| 'verified'
	| 'unknown';

export interface Order {
	id: string;
	number: string;
	customerId: string;
	customerName: string;
	email: string;
	phone: string;
	city: string;
	address: string;
	items: OrderItem[];
	subtotal: number;
	shipping: number;
	discountCode?: string;
	discount: number;
	total: number;
	status: OrderStatus;
	/** Idempotency token and request fingerprint for safe checkout retries. */
	checkoutIdempotencyKey?: string;
	checkoutFingerprint?: string;
	/** Current payment workflow state; optional only for legacy order records. */
	paymentState?: PaymentState;
	/** Provider reference (for example, Authority) used by server-side callback verification. */
	paymentRef?: string;
	/** Validated provider URL, retained so a retry reuses the same payment session. */
	paymentUrl?: string;
	note?: string;
	createdAt: string;
	updatedAt: string;
}

export interface Customer {
	id: string;
	name: string;
	email: string;
	phone: string;
	city: string;
	createdAt: string;
}

export type DiscountType = 'percent' | 'fixed';

export interface Discount {
	id: string;
	code: string;
	type: DiscountType;
	value: number;
	active: boolean;
	expiresAt?: string;
	minSubtotal: number;
	usageLimit?: number;
	usedCount: number;
	createdAt: string;
}

export interface Database {
	version: number;
	counters: {
		order: number;
	};
	products: Product[];
	orders: Order[];
	customers: Customer[];
	discounts: Discount[];
}

export const ORDER_STATUSES: Array<{
	value: OrderStatus;
	label: string;
	tone: 'warning' | 'brand' | 'success' | 'neutral' | 'danger';
}> = [
	{ value: 'pending', label: 'در انتظار پرداخت', tone: 'warning' },
	{ value: 'paid', label: 'پرداخت‌شده', tone: 'brand' },
	{ value: 'processing', label: 'در حال آماده‌سازی', tone: 'brand' },
	{ value: 'shipped', label: 'ارسال‌شده', tone: 'brand' },
	{ value: 'delivered', label: 'تحویل‌شده', tone: 'success' },
	{ value: 'cancelled', label: 'لغو‌شده', tone: 'neutral' },
	{ value: 'refunded', label: 'بازگشت وجه', tone: 'danger' },
];

export const PRODUCT_STATUSES: Array<{
	value: ProductStatus;
	label: string;
	tone: 'success' | 'warning' | 'neutral';
}> = [
	{ value: 'active', label: 'فعال', tone: 'success' },
	{ value: 'draft', label: 'پیش‌نویس', tone: 'warning' },
	{ value: 'archived', label: 'بایگانی', tone: 'neutral' },
];

export function orderStatusLabel(status: OrderStatus): string {
	return ORDER_STATUSES.find((item) => item.value === status)?.label ?? status;
}

export function orderStatusTone(status: OrderStatus) {
	return ORDER_STATUSES.find((item) => item.value === status)?.tone ?? 'neutral';
}

export function productStatusLabel(status: ProductStatus): string {
	return PRODUCT_STATUSES.find((item) => item.value === status)?.label ?? status;
}

export function productStatusTone(status: ProductStatus) {
	return PRODUCT_STATUSES.find((item) => item.value === status)?.tone ?? 'neutral';
}

/** وضعیت‌هایی که پول را «واقعی» می‌کنند و در آمار درآمد حساب می‌شوند. */
export const REVENUE_STATUSES: OrderStatus[] = [
	'paid',
	'processing',
	'shipped',
	'delivered',
];

export function isRevenue(status: OrderStatus): boolean {
	return REVENUE_STATUSES.includes(status);
}
