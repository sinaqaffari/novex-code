import type { APIRoute } from 'astro';
import { readCart, readDiscountCode, writeCart, writeDiscountCode } from '../../../lib/commerce/cart';
import {
	createOrderFromCheckout,
	updateOrderPaymentRef,
} from '../../../lib/commerce/orders';
import { applyFilters } from '../../../lib/plugins/hooks';
import { ensurePluginsBooted } from '../../../lib/plugins/registry';
import { AppError } from '../../../lib/errors';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
	// افزونه‌ها باید ثبت شده باشند تا قلاب پرداخت فعال باشد.
	await ensurePluginsBooted();

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

		// درخواست راه‌اندازی پرداخت از طریق افزونه‌ها (مثلاً زرین‌پال).
		const paymentResult = await applyFilters('shop.payment.initiate', null, {
			orderId: order.id,
			amount: order.total,
			description: `پرداخت سفارش ${order.number} — فروشگاه نووکس‌کد`,
			callbackUrl: new URL('/shop/payment/callback', `http://${request.headers.get('host') ?? 'localhost'}`).href,
			metadata: {
				mobile: order.phone,
				email: order.email,
			},
		});

		if (!paymentResult || typeof paymentResult !== 'object' || !('url' in paymentResult)) {
			// اگر افزونه پرداخت فعال نیست، سفارش به صورت معلق می‌ماند و کاربر به صفحه سفارش هدایت می‌شود.
			writeCart(cookies, []);
			writeDiscountCode(cookies, '');
			cookies.set('novex_last_order', `${order.number}:${order.phone}`, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 14,
			});
			return wantsJson
				? Response.json({ ok: true, number: order.number, total: order.total, paymentRequired: false })
				: redirect(`/shop/order/${order.number}`, 303);
		}

		const { authority, url } = paymentResult as { authority: string; url: string };

		// ذخیرهٔ Authority در سفارش تا در Callback بتوانیم آن را پیدا کنیم.
		await updateOrderPaymentRef(order.id, authority);

		writeCart(cookies, []);
		writeDiscountCode(cookies, '');
		cookies.set('novex_last_order', `${order.number}:${order.phone}`, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 14,
		});

		return wantsJson
			? Response.json({
					ok: true,
					number: order.number,
					total: order.total,
					paymentRequired: true,
					paymentUrl: url,
					authority,
			  })
			: redirect(url, 303);
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
