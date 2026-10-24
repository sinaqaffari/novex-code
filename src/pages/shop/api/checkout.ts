import type { APIRoute } from 'astro';
import { readCart, readDiscountCode, writeCart, writeDiscountCode } from '../../../lib/commerce/cart';
import { createOrderFromCheckout } from '../../../lib/commerce/orders';
import { AppError } from '../../../lib/errors';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
	const form = await request.formData();
	const lines = readCart(cookies);
	const wantsJson = request.headers.get('accept')?.includes('application/json');

	if (lines.length === 0) {
		return wantsJson
			? Response.json({ ok: false, message: 'سبد خرید خالی است.' }, { status: 400 })
			: redirect('/shop/cart', 303);
	}

	const discountCode = String(form.get('discountCode') ?? '') || readDiscountCode(cookies);

	try {
		const order = await createOrderFromCheckout({
			customerName: String(form.get('customerName') ?? ''),
			email: String(form.get('email') ?? ''),
			phone: String(form.get('phone') ?? ''),
			city: String(form.get('city') ?? ''),
			address: String(form.get('address') ?? ''),
			note: String(form.get('note') ?? ''),
			discountCode,
			items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
		});

		writeCart(cookies, []);
		writeDiscountCode(cookies, '');
		cookies.set('novex_last_order', `${order.number}:${order.phone}`, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 14,
		});

		return wantsJson
			? Response.json({ ok: true, number: order.number, total: order.total })
			: redirect(`/shop/order/${order.number}`, 303);
	} catch (error) {
		const message = error instanceof AppError ? error.message : 'ثبت سفارش انجام نشد.';
		const status = error instanceof AppError ? error.status : 500;

		if (wantsJson) {
			return Response.json(
				{ ok: false, message, field: error instanceof AppError ? error.field : undefined },
				{ status },
			);
		}
		return redirect(`/shop/checkout?error=${encodeURIComponent(message)}`, 303);
	}
};
