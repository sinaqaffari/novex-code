#!/usr/bin/env node

/**
 * Opt-in local catalogue fixtures. Draft-only products; never seed orders,
 * customers, discounts, or payment outcomes. Run with `--apply` to write.
 */

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEMO_DATE = '2026-10-27T12:00:00.000Z';
const demoProducts = [
	{
		id: 'demo_prd_rtl_ui_kit',
		name: 'پیش‌نویس نمایشی: کیت رابط RTL',
		slug: 'demo-rtl-ui-kit',
		sku: 'DEMO-RTL-01',
		category: 'رابط کاربری',
		description: 'دادهٔ نمایشی محلی؛ قابل فروش نیست. پیش از انتشار، قیمت واقعی، موجودی و تصویر اختصاصی ثبت کنید.',
	},
	{
		id: 'demo_prd_astro_theme_fa',
		name: 'پیش‌نویس نمایشی: پوستهٔ فارسی Astro',
		slug: 'demo-astro-theme-fa',
		sku: 'DEMO-ASTRO-01',
		category: 'پوسته',
		description: 'دادهٔ نمایشی محلی؛ قابل فروش نیست. پیش از انتشار، قیمت واقعی، موجودی و تصویر اختصاصی ثبت کنید.',
	},
	{
		id: 'demo_prd_content_audit',
		name: 'پیش‌نویس نمایشی: بازبینی محتوا',
		slug: 'demo-content-audit',
		sku: 'DEMO-PLUGIN-01',
		category: 'افزونه',
		description: 'دادهٔ نمایشی محلی؛ قابل فروش نیست. پیش از انتشار، قیمت واقعی، موجودی و تصویر اختصاصی ثبت کنید.',
	},
	{
		id: 'demo_prd_persian_type_guide',
		name: 'پیش‌نویس نمایشی: راهنمای تایپوگرافی فارسی',
		slug: 'demo-persian-type-guide',
		sku: 'DEMO-GUIDE-01',
		category: 'راهنما',
		description: 'دادهٔ نمایشی محلی؛ قابل فروش نیست. پیش از انتشار، قیمت واقعی، موجودی و تصویر اختصاصی ثبت کنید.',
	},
	{
		id: 'demo_prd_accessibility_checklist',
		name: 'پیش‌نویس نمایشی: چک‌لیست دسترس‌پذیری',
		slug: 'demo-accessibility-checklist',
		sku: 'DEMO-GUIDE-02',
		category: 'راهنما',
		description: 'دادهٔ نمایشی محلی؛ قابل فروش نیست. پیش از انتشار، قیمت واقعی، موجودی و تصویر اختصاصی ثبت کنید.',
	},
	{
		id: 'demo_prd_plugin_handbook',
		name: 'پیش‌نویس نمایشی: راهنمای افزونهٔ TypeScript',
		slug: 'demo-plugin-handbook',
		sku: 'DEMO-PLUGIN-02',
		category: 'افزونه',
		description: 'دادهٔ نمایشی محلی؛ قابل فروش نیست. پیش از انتشار، قیمت واقعی، موجودی و تصویر اختصاصی ثبت کنید.',
	},
].map((product) => ({
	...product,
	price: 0,
	stock: 0,
	image: '',
	status: 'draft',
	featured: false,
	createdAt: DEMO_DATE,
	updatedAt: DEMO_DATE,
}));

function isRecord(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertDatabase(value) {
	if (!isRecord(value) || !Number.isSafeInteger(value.version) || value.version < 1) {
		throw new Error('فایل فروشگاه معتبر نیست؛ هیچ داده‌ای تغییر نکرد.');
	}
	if (!isRecord(value.counters) || !Number.isSafeInteger(value.counters.order) || value.counters.order < 0) {
		throw new Error('شمارندهٔ سفارش در فایل فروشگاه معتبر نیست؛ هیچ داده‌ای تغییر نکرد.');
	}
	for (const key of ['products', 'orders', 'customers', 'discounts']) {
		if (!Array.isArray(value[key])) {
			throw new Error(`فهرست ${key} در فایل فروشگاه معتبر نیست؛ هیچ داده‌ای تغییر نکرد.`);
		}
	}
	return value;
}

async function readDatabase(databaseFile) {
	try {
		const raw = await readFile(databaseFile, 'utf8');
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new Error('فایل فروشگاه JSON معتبر ندارد؛ برای حفظ داده، seed متوقف شد.');
		}
		return assertDatabase(parsed);
	} catch (error) {
		if (error?.code === 'ENOENT') {
			return { version: 1, counters: { order: 0 }, products: [], orders: [], customers: [], discounts: [] };
		}
		throw error;
	}
}

function addDraftProducts(database) {
	let added = 0;
	for (const fixture of demoProducts) {
		const sameSku = database.products.find((product) => product?.sku === fixture.sku);
		if (sameSku) {
			const isOurDraft = sameSku.id === fixture.id && sameSku.status === 'draft' && sameSku.price === 0 && sameSku.stock === 0;
			if (isOurDraft) continue;
			throw new Error(`SKU ${fixture.sku} از قبل برای دادهٔ دیگری استفاده شده است؛ هیچ داده‌ای نوشته نشد.`);
		}
		if (database.products.some((product) => product?.id === fixture.id || product?.slug === fixture.slug)) {
			throw new Error(`شناسه یا نامک ${fixture.slug} با دادهٔ موجود تداخل دارد؛ هیچ داده‌ای نوشته نشد.`);
		}
		database.products.push(fixture);
		added += 1;
	}
	return added;
}

async function writeDatabase(databaseFile, database) {
	await mkdir(path.dirname(databaseFile), { recursive: true });
	const temporaryFile = `${databaseFile}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryFile, `${JSON.stringify(database, null, '\t')}\n`, { encoding: 'utf8', mode: 0o600 });
		await rename(temporaryFile, databaseFile);
	} catch (error) {
		await rm(temporaryFile, { force: true }).catch(() => undefined);
		throw error;
	}
}

export async function seedDemoProducts({ databaseFile, apply = false, production = false } = {}) {
	if (apply && production) throw new Error('افزودن دادهٔ نمایشی در NODE_ENV=production مجاز نیست.');
	const target = path.resolve(databaseFile ?? process.env.COMMERCE_DB_FILE ?? 'data/commerce.json');
	const run = async () => {
		if (process.env.NOVEX_COMMERCE_STORE === 'postgres') throw new Error('seed فایل برای فروشگاه PostgreSQL پشتیبانی نمی‌شود؛ از پنل محصولات استفاده کنید.');
		try {
			await lstat(`${target}.novex-postgres`);
			throw new Error('فایل فروشگاه منتقل شده است؛ seed فایل قدیمی را تغییر نمی‌دهد.');
		} catch (error) { if (error?.code !== 'ENOENT') throw error; }
		const database = await readDatabase(target);
		const before = database.products.length;
		const added = addDraftProducts(database);
		if (apply && added > 0) await writeDatabase(target, database);
		return { target, added, total: database.products.length, before, applied: apply };
	};
	if (!apply) return run();
	// Coordinate with normal commerce writes, media deletion and migration.
	const { withBuilderAssetLock } = await import('../src/lib/builder/store.ts');
	return withBuilderAssetLock(run);
}

async function main() {
	const args = new Set(process.argv.slice(2));
	if (args.has('--help')) {
		console.log('Usage: npm run seed:demo -- [--apply]\nAdds local draft products only. Never creates orders or revenue.');
		return;
	}
	const apply = args.has('--apply');
	const result = await seedDemoProducts({ apply, production: process.env.NODE_ENV === 'production' });
	if (!apply) {
		console.log(`پیش‌نمایش: ${result.added} محصول پیش‌نویس نمایشی آماده است؛ فایلی تغییر نکرد. برای ذخیره: npm run seed:demo -- --apply`);
		return;
	}
	console.log(`محصول پیش‌نویس نمایشی افزوده شد: ${result.added}؛ مجموع محصولات: ${result.total}.`);
	console.log('هیچ سفارش، مشتری، تخفیف یا نتیجهٔ پرداختی ساخته یا تغییر نکرد.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : 'اجرای seed ناموفق بود.');
		process.exitCode = 1;
	});
}
