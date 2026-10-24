/** ورودی‌های فارسی (ارقام و جداکننده‌ها) را به عدد و متن استاندارد تبدیل می‌کند. */

import { AppError } from '../errors';

const persianDigits = /[\u06F0-\u06F9]/g;
const arabicDigits = /[\u0660-\u0669]/g;

export function normalizeDigits(input: string): string {
	return input
		.replace(persianDigits, (digit) => String(digit.charCodeAt(0) - 0x06f0))
		.replace(arabicDigits, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

export function asText(value: unknown, fallback = ''): string {
	if (value === null || value === undefined) return fallback;
	return String(value).trim();
}

export function asBool(value: unknown): boolean {
	return value === true || value === 'true' || value === 'on' || value === '1';
}

/** «۱٬۲۵۰٬۰۰۰» یا «1,250,000 تومان» → 1250000 */
export function parseMoney(value: unknown, field: string, label: string): number {
	const raw = normalizeDigits(asText(value)).replace(/[^\d.-]/g, '');
	if (raw === '') return 0;
	const amount = Number(raw);
	if (!Number.isFinite(amount) || amount < 0) {
		throw new AppError(`${label} باید یک عدد مثبت باشد.`, field);
	}
	return Math.round(amount);
}

export function parseInteger(
	value: unknown,
	field: string,
	label: string,
	{ min = 0, max = Number.MAX_SAFE_INTEGER } = {},
): number {
	const amount = parseMoney(value, field, label);
	if (amount < min || amount > max) {
		throw new AppError(`${label} باید بین ${min} و ${max} باشد.`, field);
	}
	return amount;
}

export function requireText(value: unknown, field: string, label: string, max = 200): string {
	const text = asText(value);
	if (!text) throw new AppError(`${label} الزامی است.`, field);
	if (text.length > max) throw new AppError(`${label} نباید بیشتر از ${max} نویسه باشد.`, field);
	return text;
}

export function parseEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
	field: string,
	label: string,
): T {
	const text = asText(value) as T;
	if (!text) return fallback;
	if (!allowed.includes(text)) throw new AppError(`${label} معتبر نیست.`, field);
	return text;
}

export function parseDate(value: unknown): string | undefined {
	const text = asText(value);
	if (!text) return undefined;
	const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00.000Z` : text;
	const date = new Date(normalized);
	if (Number.isNaN(date.valueOf())) return undefined;
	return date.toISOString();
}
