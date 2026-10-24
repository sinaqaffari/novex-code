/** کدهای تخفیف: ساخت، فعال/غیرفعال‌سازی و اعتبارسنجی هنگام تسویه. */

import { AppError } from '../errors.ts';
import { newId, readDatabase, updateDatabase } from './db.ts';
import type { Database, Discount, DiscountType } from './types.ts';
import { asBool, asText, parseDate, parseEnum, parseInteger, parseMoney } from './validation.ts';

export interface DiscountInput {
	code: string;
	type: DiscountType;
	value: number;
	active: boolean;
	expiresAt?: string;
	minSubtotal: number;
	usageLimit?: number;
}

export function toDiscountInput(payload: Record<string, unknown>): DiscountInput {
	const type = parseEnum<DiscountType>(payload.type, ['percent', 'fixed'], 'percent', 'type', 'نوع تخفیف');
	const code = asText(payload.code).toUpperCase().replace(/\s+/g, '');

	if (!code) throw new AppError('کد تخفیف الزامی است.', 'code');
	if (!/^[A-Z0-9_-]{3,24}$/.test(code)) {
		throw new AppError('کد تخفیف فقط می‌تواند شامل حروف لاتین، رقم، خط تیره و زیرخط باشد.', 'code');
	}

	const value =
		type === 'percent'
			? parseInteger(payload.value, 'value', 'درصد تخفیف', { min: 1, max: 100 })
			: parseMoney(payload.value, 'value', 'مبلغ تخفیف');

	const usageLimit = asText(payload.usageLimit)
		? parseInteger(payload.usageLimit, 'usageLimit', 'سقف استفاده', { max: 1_000_000 })
		: undefined;

	return {
		code,
		type,
		value,
		active: asBool(payload.active),
		expiresAt: parseDate(payload.expiresAt),
		minSubtotal: parseMoney(payload.minSubtotal, 'minSubtotal', 'حداقل مبلغ سفارش'),
		usageLimit,
	};
}

export async function listDiscounts(): Promise<Discount[]> {
	const db = await readDatabase();
	return [...db.discounts].sort(
		(a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf(),
	);
}

export async function createDiscount(input: DiscountInput): Promise<Discount> {
	return updateDatabase((db) => {
		if (db.discounts.some((discount) => discount.code === input.code)) {
			throw new AppError('این کد تخفیف قبلاً ساخته شده است.', 'code');
		}
		const discount: Discount = {
			id: newId('dsc'),
			...input,
			usedCount: 0,
			createdAt: new Date().toISOString(),
		};
		db.discounts.unshift(discount);
		return discount;
	});
}

export async function updateDiscount(id: string, input: DiscountInput): Promise<Discount> {
	return updateDatabase((db) => {
		const discount = db.discounts.find((item) => item.id === id);
		if (!discount) throw new AppError('کد تخفیف پیدا نشد.', undefined, 404);
		if (db.discounts.some((item) => item.id !== id && item.code === input.code)) {
			throw new AppError('این کد تخفیف قبلاً ساخته شده است.', 'code');
		}
		Object.assign(discount, input);
		return discount;
	});
}

export async function toggleDiscount(id: string): Promise<Discount> {
	return updateDatabase((db) => {
		const discount = db.discounts.find((item) => item.id === id);
		if (!discount) throw new AppError('کد تخفیف پیدا نشد.', undefined, 404);
		discount.active = !discount.active;
		return discount;
	});
}

export async function deleteDiscount(id: string): Promise<void> {
	await updateDatabase((db) => {
		const index = db.discounts.findIndex((item) => item.id === id);
		if (index === -1) throw new AppError('کد تخفیف پیدا نشد.', undefined, 404);
		db.discounts.splice(index, 1);
	});
}

/** محاسبهٔ تخفیف برای یک کد؛ پیام خطاها فارسی و قابل نمایش است. */
export function computeDiscount(
	db: Database,
	code: string,
	subtotal: number,
): { discount: Discount; amount: number } | null {
	const normalized = code.trim().toUpperCase();
	if (!normalized) return null;

	const discount = db.discounts.find((item) => item.code === normalized);
	if (!discount) throw new AppError('کد تخفیف معتبر نیست.', 'discountCode');
	if (!discount.active) throw new AppError('این کد تخفیف غیرفعال است.', 'discountCode');
	if (discount.expiresAt && new Date(discount.expiresAt).valueOf() < Date.now()) {
		throw new AppError('مهلت این کد تخفیف به پایان رسیده است.', 'discountCode');
	}
	if (discount.usageLimit !== undefined && discount.usedCount >= discount.usageLimit) {
		throw new AppError('ظرفیت استفاده از این کد تکمیل شده است.', 'discountCode');
	}
	if (subtotal < discount.minSubtotal) {
		throw new AppError('مبلغ سفارش برای استفاده از این کد کافی نیست.', 'discountCode');
	}

	const raw =
		discount.type === 'percent' ? Math.round((subtotal * discount.value) / 100) : discount.value;
	return { discount, amount: Math.min(raw, subtotal) };
}
