import type { APIRoute } from 'astro';
import {
	addToCart,
	hydrateCart,
	readCart,
	removeLine,
	setLineQuantity,
	writeCart,
	writeDiscountCode,
} from '../../../lib/commerce/cart';
import { readDatabase } from '../../../lib/commerce/db';
import { computeDiscount } from '../../../lib/commerce/discounts';
import { AppError } from '../../../lib/errors';

export const prerender = false;

/** مقصد بازگشت را محدود می‌کنیم تا فقط مسیرهای داخلی فروشگاه مجاز باشند. */
function safeRedirect(value: FormDataEntryValue | null, fallback: string): string {
	const target = String(value ?? '');
	return target.startsWith('/shop') && !target.startsWith('//') ? target : fallback;
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
	const form = await request.formData();
	const action = String(form.get('action') ?? 'add');
	const productId = String(form.get('productId') ?? '');
	const quantity = Math.round(Number(form.get('quantity') ?? 1));
	const back = safeRedirect(form.get('redirect'), '/shop/cart');
	const wantsJson = request.headers.get('accept')?.includes('application/json');

	const fail = (message: string, status = 400) =>
		wantsJson ? Response.json({ ok: false, message }, { status }) : redirect(`${back}?error=${encodeURIComponent(message)}`, 303);

	try {
		let lines = readCart(cookies);

		if (action === 'add') {
			if (!productId) throw new AppError('محصولی انتخاب نشده است.', 'productId');
			const db = await readDatabase();
			const product = db.products.find((item) => item.id === productId);
			if (!product || product.status !== 'active') {
				throw new AppError('این محصول در دسترس نیست.', 'productId', 404);
			}
			if (product.stock < 1) throw new AppError('این محصول موجود نیست.', 'productId', 409);
			lines = addToCart(lines, productId, Number.isFinite(quantity) ? quantity : 1);
			writeCart(cookies, lines);
			return wantsJson ? Response.json({ ok: true, count: lines.length }) : redirect(back, 303);
		}

		if (action === 'quantity') {
			lines = setLineQuantity(lines, productId, quantity);
			writeCart(cookies, lines);
			return wantsJson ? Response.json({ ok: true, count: lines.length }) : redirect(back, 303);
		}

		if (action === 'remove') {
			lines = removeLine(lines, productId);
			writeCart(cookies, lines);
			return wantsJson ? Response.json({ ok: true, count: lines.length }) : redirect(back, 303);
		}

		if (action === 'clear') {
			writeCart(cookies, []);
			return wantsJson ? Response.json({ ok: true, count: 0 }) : redirect(back, 303);
		}

		if (action === 'discount') {
			const code = String(form.get('code') ?? '').trim().toUpperCase();
			if (!code) {
				writeDiscountCode(cookies, '');
				return redirect(back, 303);
			}
			const db = await readDatabase();
			const cart = await hydrateCart(lines);
			computeDiscount(db, code, cart.subtotal);
			writeDiscountCode(cookies, code);
			return wantsJson
				? Response.json({ ok: true, code })
				: redirect(back, 303);
		}

		return fail('درخواست نامعتبر است.', 400);
	} catch (error) {
		const message = error instanceof AppError ? error.message : 'انجام این عملیات ممکن نشد.';
		const status = error instanceof AppError ? error.status : 500;
		return fail(message, status);
	}
};
