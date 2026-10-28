/**
 * سبد خرید عمومی — یک کوکی امضاشده‌نشده اما کوچک و قابل‌اعتبارسنجی.
 * قیمت‌ها هرگز از کوکی خوانده نمی‌شوند؛ هنگام نمایش و تسویه از سرور می‌آیند.
 */

import type { AstroCookies } from 'astro';
import { readDatabase } from './db.ts';
import type { Product } from './types.ts';

export const CART_COOKIE = 'novex_cart';
export const DISCOUNT_COOKIE = 'novex_discount';
const MAX_LINES = 30;
const MAX_QUANTITY = 20;

export interface CartLine {
	productId: string;
	quantity: number;
}

export interface HydratedLine {
	product: Product;
	quantity: number;
	total: number;
}

export interface HydratedCart {
	lines: HydratedLine[];
	subtotal: number;
	count: number;
}

/** مقادیر کوکی ممکن است یک یا دو بار کدگذاری شده باشند؛ هر دو حالت را می‌پذیریم. */
function decodeCandidates(raw: string): string[] {
	const values = [raw];
	let current = raw;
	for (let index = 0; index < 2; index += 1) {
		try {
			const next = decodeURIComponent(current);
			if (next === current) break;
			current = next;
			values.push(current);
		} catch {
			break;
		}
	}
	return values;
}

export function readCart(cookies: AstroCookies): CartLine[] {
	const raw = cookies.get(CART_COOKIE)?.value;
	if (!raw || raw.length > 8192) return [];

	for (const candidate of decodeCandidates(raw)) {
		const lines = parseCart(candidate);
		if (lines) return lines;
	}
	return [];
}

function parseCart(raw: string): CartLine[] | null {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return null;

		const quantities = new Map<string, number>();
		for (const item of parsed.slice(0, MAX_LINES)) {
			if (!item || typeof item !== 'object') continue;
			const line = item as Partial<CartLine>;
			const productId = String(line.productId ?? '').trim();
			const quantity = Number(line.quantity);
			if (!productId || productId.length > 120 || !Number.isSafeInteger(quantity) || quantity < 1) continue;
			const combined = Math.min(MAX_QUANTITY, (quantities.get(productId) ?? 0) + quantity);
			quantities.set(productId, combined);
		}
		return [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
	} catch {
		return null;
	}
}

export function writeCart(cookies: AstroCookies, lines: CartLine[]): void {
	const clean = new Map<string, number>();
	for (const line of lines.slice(0, MAX_LINES)) {
		if (!line.productId || line.productId.length > 120 || !Number.isSafeInteger(line.quantity) || line.quantity < 1) continue;
		clean.set(line.productId, Math.min(MAX_QUANTITY, (clean.get(line.productId) ?? 0) + line.quantity));
	}
	if (!clean.size) {
		cookies.delete(CART_COOKIE, { path: '/' });
		return;
	}
	cookies.set(CART_COOKIE, JSON.stringify([...clean].map(([productId, quantity]) => ({ productId, quantity }))), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 30,
	});
}

export function addToCart(lines: CartLine[], productId: string, quantity: number): CartLine[] {
	if (!productId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return lines;
	const existing = lines.find((line) => line.productId === productId);
	if (existing) {
		existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + quantity);
		return lines;
	}
	if (lines.length >= MAX_LINES) return lines;
	return [...lines, { productId, quantity }];
}

export function setLineQuantity(lines: CartLine[], productId: string, quantity: number): CartLine[] {
	if (quantity === 0) return lines.filter((line) => line.productId !== productId);
	if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return lines;
	return lines.map((line) => (line.productId === productId ? { ...line, quantity } : line));
}

export function removeLine(lines: CartLine[], productId: string): CartLine[] {
	return lines.filter((line) => line.productId !== productId);
}

/** محصولات را از دیتابیس می‌خواند؛ خطوط نامعتبر (حذف‌شده یا غیرفعال) کنار گذاشته می‌شوند. */
export async function hydrateCart(lines: CartLine[]): Promise<HydratedCart> {
	const db = await readDatabase();
	const hydrated: HydratedLine[] = [];

	for (const line of lines) {
		const product = db.products.find((item) => item.id === line.productId);
		if (!product || product.status !== 'active') continue;
		const quantity = Math.min(line.quantity, Math.max(1, product.stock));
		if (product.stock === 0) continue;
		hydrated.push({ product, quantity, total: product.price * quantity });
	}

	return {
		lines: hydrated,
		subtotal: hydrated.reduce((sum, line) => sum + line.total, 0),
		count: hydrated.reduce((sum, line) => sum + line.quantity, 0),
	};
}

const DISCOUNT_PATTERN = /^[A-Z0-9_-]{3,24}$/;

export function readDiscountCode(cookies: AstroCookies): string {
	const raw = cookies.get(DISCOUNT_COOKIE)?.value ?? '';
	const code = decodeURIComponent(raw).trim().toUpperCase();
	return DISCOUNT_PATTERN.test(code) ? code : '';
}

export function writeDiscountCode(cookies: AstroCookies, code: string): void {
	const clean = code.trim().toUpperCase();
	if (!DISCOUNT_PATTERN.test(clean)) {
		cookies.delete(DISCOUNT_COOKIE, { path: '/' });
		return;
	}
	cookies.set(DISCOUNT_COOKIE, clean, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 7,
	});
}
