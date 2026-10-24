/**
 * Small, dependency-free JSON store for the commerce module.
 *
 * Reads are cheap (the file is tiny), writes are serialised through a promise
 * queue and land atomically via `rename`, so two concurrent panel requests can
 * never tear the database. Swapping this file for Postgres later only requires
 * replacing `readDatabase` / `updateDatabase`.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Database } from './types';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const DB_FILE = path.join(DATA_DIR, 'commerce.json');

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

export const newId = (prefix: string) =>
	`${prefix}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

export function buildSeed(): Database {
	const products: Database['products'] = [
		{
			id: 'prd_rtl_template',
			name: 'قالب آسترو راست‌به‌چپ',
			slug: 'astro-rtl-template',
			sku: 'NVX-TPL-01',
			price: 890_000,
			compareAtPrice: 1_190_000,
			stock: 12,
			category: 'قالب',
			description:
				'قالبی کامل برای ساخت وبلاگ و فروشگاه فارسی با آسترو؛ شامل چیدمان RTL، قلم وزیرمتن و بهینه‌سازی تصویر.',
			image: '',
			status: 'active',
			featured: true,
			createdAt: daysAgo(42),
			updatedAt: daysAgo(3),
		},
		{
			id: 'prd_ui_kit',
			name: 'کیت رابط کاربری فارسی',
			slug: 'persian-ui-kit',
			sku: 'NVX-UIK-02',
			price: 1_450_000,
			stock: 8,
			category: 'کیت رابط کاربری',
			description:
				'بیش از ۴۰ مؤلفهٔ آمادهٔ فارسی: جدول داده، فرم، نمودار و حالت‌های خالی — همه با ویژگی‌های منطقی CSS.',
			image: '',
			status: 'active',
			featured: true,
			createdAt: daysAgo(35),
			updatedAt: daysAgo(1),
		},
		{
			id: 'prd_typo_course',
			name: 'دورهٔ تایپوگرافی فارسی وب',
			slug: 'persian-typography-course',
			sku: 'NVX-CRS-03',
			price: 2_400_000,
			stock: 100,
			category: 'دوره آموزشی',
			description:
				'دوازده جلسهٔ ویدیویی دربارهٔ انتخاب قلم، نیم‌فاصله، ارتفاع خط و ساخت رابط راست‌به‌چپ بدون دردسر.',
			image: '',
			status: 'active',
			featured: false,
			createdAt: daysAgo(28),
			updatedAt: daysAgo(6),
		},
		{
			id: 'prd_book',
			name: 'کتابچهٔ طراحی راست‌به‌چپ',
			slug: 'rtl-design-handbook',
			sku: 'NVX-BOK-04',
			price: 390_000,
			stock: 0,
			category: 'کتاب',
			description: 'چکیدهٔ ۶۴ صفحه‌ای قواعد چیدمان، فاصله‌گذاری و آیکون‌ها در رابط‌های فارسی.',
			image: '',
			status: 'active',
			featured: false,
			createdAt: daysAgo(21),
			updatedAt: daysAgo(9),
		},
		{
			id: 'prd_cart_plugin',
			name: 'افزونهٔ سبد خرید و پرداخت',
			slug: 'cart-plugin',
			sku: 'NVX-PLG-05',
			price: 690_000,
			stock: 50,
			category: 'افزونه',
			description: 'اتصال درگاه پرداخت ایرانی به فروشگاه آسترو؛ نگارش بعدی، منتشر نشده است.',
			image: '',
			status: 'draft',
			featured: false,
			createdAt: daysAgo(11),
			updatedAt: daysAgo(2),
		},
	];

	const customers: Database['customers'] = [
		{
			id: 'cus_sara',
			name: 'سارا محمدی',
			email: 'sara@example.com',
			phone: '۰۹۱۲۳۴۵۶۷۸۹',
			city: 'تهران',
			createdAt: daysAgo(40),
		},
		{
			id: 'cus_amir',
			name: 'امیر رضایی',
			email: 'amir@example.com',
			phone: '۰۹۳۵۱۱۱۲۲۳۳',
			city: 'اصفهان',
			createdAt: daysAgo(33),
		},
		{
			id: 'cus_neg',
			name: 'نگین کریمی',
			email: 'negin@example.com',
			phone: '۰۹۱۹۸۸۷۷۶۶۵',
			city: 'شیراز',
			createdAt: daysAgo(18),
		},
		{
			id: 'cus_hadi',
			name: 'هادی موسوی',
			email: 'hadi@example.com',
			phone: '۰۹۱۲۰۰۹۸۷۶۵',
			city: 'مشهد',
			createdAt: daysAgo(6),
		},
	];

	const order = (
		index: number,
		customerId: string,
		slugPrice: [string, number, number][],
		status: Database['orders'][number]['status'],
		day: number,
	): Database['orders'][number] => {
		const customer = customers.find((item) => item.id === customerId);
		const items = slugPrice.map(([productId, price, quantity]) => {
			const product = products.find((item) => item.id === productId)!;
			return {
				productId,
				name: product.name,
				sku: product.sku,
				price,
				quantity,
			};
		});
		const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
		const shipping = subtotal > 1_000_000 ? 0 : 45_000;
		return {
			id: `ord_seed_${index}`,
			number: `NVX-${1032 + index}`,
			customerId,
			customerName: customer?.name ?? 'مهمان',
			email: customer?.email ?? '',
			phone: customer?.phone ?? '',
			city: customer?.city ?? 'تهران',
			address: 'خیابان نمونه، پلاک ۱۲، واحد ۳',
			items,
			subtotal,
			shipping,
			discount: 0,
			total: subtotal + shipping,
			status,
			createdAt: daysAgo(day),
			updatedAt: daysAgo(Math.max(0, day - 1)),
		};
	};

	const orders: Database['orders'] = [
		order(0, 'cus_hadi', [['prd_ui_kit', 1_450_000, 1]], 'pending', 1),
		order(1, 'cus_neg', [['prd_book', 390_000, 2]], 'paid', 2),
		order(2, 'cus_sara', [['prd_typo_course', 2_400_000, 1]], 'processing', 5),
		order(
			3,
			'cus_amir',
			[
				['prd_rtl_template', 890_000, 1],
				['prd_book', 390_000, 1],
			],
			'shipped',
			9,
		),
		order(4, 'cus_sara', [['prd_ui_kit', 1_450_000, 1]], 'delivered', 14),
		order(5, 'cus_neg', [['prd_rtl_template', 890_000, 1]], 'delivered', 20),
		order(6, 'cus_amir', [['prd_book', 390_000, 1]], 'cancelled', 24),
		order(7, 'cus_hadi', [['prd_typo_course', 2_400_000, 1]], 'delivered', 27),
	];

	const discounts: Database['discounts'] = [
		{
			id: 'dsc_nowruz',
			code: 'NOWRUZ25',
			type: 'percent',
			value: 25,
			active: true,
			expiresAt: daysAgo(-30),
			minSubtotal: 500_000,
			usageLimit: 100,
			usedCount: 14,
			createdAt: daysAgo(12),
		},
		{
			id: 'dsc_welcome',
			code: 'WELCOME100',
			type: 'fixed',
			value: 100_000,
			active: false,
			minSubtotal: 0,
			usageLimit: 200,
			usedCount: 200,
			createdAt: daysAgo(45),
		},
	];

	return {
		version: 1,
		counters: { order: 1040 },
		products,
		orders,
		customers,
		discounts,
	};
}

function normalize(raw: Partial<Database>): Database {
	const seed = buildSeed();
	return {
		version: typeof raw.version === 'number' ? raw.version : 1,
		counters: { order: Number(raw.counters?.order) || seed.counters.order },
		products: Array.isArray(raw.products) ? raw.products : seed.products,
		orders: Array.isArray(raw.orders) ? raw.orders : seed.orders,
		customers: Array.isArray(raw.customers) ? raw.customers : seed.customers,
		discounts: Array.isArray(raw.discounts) ? raw.discounts : seed.discounts,
	};
}

async function writeDatabase(db: Database): Promise<void> {
	await mkdir(DATA_DIR, { recursive: true });
	const temporary = `${DB_FILE}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(db, null, '\t')}\n`, 'utf8');
	await rename(temporary, DB_FILE);
}

export async function readDatabase(): Promise<Database> {
	try {
		const raw = await readFile(DB_FILE, 'utf8');
		return normalize(JSON.parse(raw) as Partial<Database>);
	} catch {
		const seeded = buildSeed();
		await writeDatabase(seeded);
		return seeded;
	}
}

let queue: Promise<unknown> = Promise.resolve();

/** Serialised read–modify–write. The mutator may change `db` in place. */
export function updateDatabase<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
	const run = async () => {
		const db = await readDatabase();
		const result = await mutator(db);
		await writeDatabase(db);
		return result;
	};

	const next = queue.then(run, run);
	queue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}
