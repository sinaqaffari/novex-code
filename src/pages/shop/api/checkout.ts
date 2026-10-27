import type { APIRoute } from 'astro';
import {
	readCart,
	writeCart,
	writeDiscountCode,
} from '../../../lib/commerce/cart';
import {
	claimPaymentInitiation,
	completePaymentInitiation,
	createOrGetOrderFromCheckout,
	findOrderByCheckoutIdempotencyKey,
	getOrder,
	markPaymentInitiationUnknown,
	type CheckoutInput,
} from '../../../lib/commerce/orders';
import { hasFilter, applyFilters } from '../../../lib/plugins/hooks';
import { ensurePluginsBooted } from '../../../lib/plugins/registry';
import { AppError } from '../../../lib/errors';
import {
	createOrderAccessToken,
	orderAccessCookieOptions,
	ORDER_ACCESS_COOKIE,
} from '../../../lib/commerce/order-access';
import type { Order } from '../../../lib/commerce/types';

export const prerender = false;

function formText(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

function checkoutFields(form: FormData, idempotencyKey: string): Omit<CheckoutInput, 'items'> {
	return {
		idempotencyKey,
		customerName: formText(form, 'customerName'),
		email: formText(form, 'email'),
		phone: formText(form, 'phone'),
		city: formText(form, 'city'),
		address: formText(form, 'address'),
		note: formText(form, 'note'),
		discountCode: formText(form, 'discountCode'),
	};
}

function parseCheckoutItems(value: string): CheckoutInput['items'] | null {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return null;
		return parsed.map((entry) => {
			if (!entry || typeof entry !== 'object') return { productId: '', quantity: Number.NaN };
			const item = entry as { productId?: unknown; quantity?: unknown };
			return {
				productId: typeof item.productId === 'string' ? item.productId : '',
				quantity: Number(item.quantity),
			};
		});
	} catch {
		return null;
	}
}

function callbackUrlFromEnvironment(): string {
	const configured = process.env.SITE_URL?.trim();
	if (!configured) {
		throw new AppError('برای فعال‌سازی پرداخت، نشانی عمومی HTTPS را در SITE_URL تنظیم کنید.', undefined, 503);
	}

	let site: URL;
	try {
		site = new URL(configured);
	} catch {
		throw new AppError('نشانی SITE_URL معتبر نیست.', undefined, 503);
	}
	if (
		site.protocol !== 'https:' ||
		site.username ||
		site.password ||
		site.hostname === 'example.com' ||
		site.hostname.endsWith('.example.com')
	) {
		throw new AppError('برای پرداخت، SITE_URL باید نشانی عمومی و معتبر HTTPS باشد.', undefined, 503);
	}
	return new URL('/shop/api/payment/callback', site.origin).href;
}

function parsePaymentResult(value: unknown): { authority: string; url: string } | null {
	if (value === null || value === undefined) return null;
	if (!value || typeof value !== 'object') {
		throw new Error('Payment adapter returned an invalid response.');
	}

	const result = value as { authority?: unknown; url?: unknown };
	const authority = typeof result.authority === 'string' ? result.authority.trim() : '';
	const rawUrl = typeof result.url === 'string' ? result.url.trim() : '';
	if (!authority || authority.length > 200 || /[\u0000-\u001f\u007f]/.test(authority)) {
		throw new Error('Payment adapter returned an invalid reference.');
	}

	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error('Payment adapter returned an invalid URL.');
	}
	if (url.protocol !== 'https:' || url.username || url.password) {
		throw new Error('Payment adapter returned an unsafe URL.');
	}
	return { authority, url: url.href };
}

function safeOrderRedirect(order: Order): string {
	if (order.paymentState === 'initiated' && order.paymentUrl) return order.paymentUrl;
	const path = `/shop/order/${encodeURIComponent(order.number)}`;
	if (order.paymentState === 'unknown') return `${path}?payment=unknown`;
	if (order.paymentState === 'initiating') return `${path}?payment=processing`;
	return path;
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
	const wantsJson = request.headers.get('accept')?.includes('application/json') ?? false;

	try {
		// Register optional payment adapters before deciding whether one is active.
		await ensurePluginsBooted();
		const form = await request.formData();
		const idempotencyKey = (
			formText(form, 'idempotencyKey') || request.headers.get('Idempotency-Key') || ''
		).trim();
		const fields = checkoutFields(form, idempotencyKey);
		const cartLines = readCart(cookies);
		const existing = idempotencyKey ? await findOrderByCheckoutIdempotencyKey(idempotencyKey) : null;

		let order: Order;
		if (existing) {
			// With the cart cookie cleared, the signed form still has the original lines.
			// The service checks the full fingerprint before it can issue an order-access cookie.
			const replayItems = parseCheckoutItems(formText(form, 'checkoutItems'));
			if (!replayItems) throw new AppError('اطلاعات بازفرست سفارش معتبر نیست.', 'checkoutItems', 409);
			const replay = await createOrGetOrderFromCheckout({ ...fields, items: replayItems });
			if (replay.created) throw new AppError('امکان بازیابی سفارش وجود ندارد.', undefined, 409);
			order = replay.order;
		} else {
			if (cartLines.length === 0) {
				return wantsJson
					? Response.json({ ok: false, message: 'سبد خرید خالی است.' }, { status: 400 })
					: redirect('/shop/cart', 303);
			}
			const created = await createOrGetOrderFromCheckout({
				...fields,
				items: cartLines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
			});
			order = created.order;
		}

		// Only one request can claim payment initiation. Replays reuse the persisted
		// provider URL/reference; a timeout is recorded as unknown and never re-issued.
		if (order.paymentState === 'not-started' || !order.paymentState) {
			const claimed = await claimPaymentInitiation(order.id);
			if (claimed) {
				if (!hasFilter('shop.payment.initiate')) {
					order = await completePaymentInitiation(order.id, null);
				} else {
					try {
						const paymentResult = await applyFilters('shop.payment.initiate', null, {
							orderId: order.id,
							amount: order.total,
							description: `پرداخت سفارش ${order.number} — فروشگاه نووکس‌کد`,
							callbackUrl: callbackUrlFromEnvironment(),
							metadata: {
								mobile: order.phone,
								email: order.email,
							},
						});
						order = await completePaymentInitiation(order.id, parsePaymentResult(paymentResult));
					} catch {
						await markPaymentInitiationUnknown(order.id);
						order = (await getOrder(order.id)) ?? order;
					}
				}
			} else {
				order = (await getOrder(order.id)) ?? order;
			}
		}

		writeCart(cookies, []);
		writeDiscountCode(cookies, '');
		cookies.set(
			ORDER_ACCESS_COOKIE,
			createOrderAccessToken(order.number, order.phone),
			orderAccessCookieOptions,
		);

		if (order.paymentState === 'initiated' && order.paymentUrl) {
			return wantsJson
				? Response.json({
						ok: true,
						number: order.number,
						total: order.total,
						status: order.status,
						paymentRequired: true,
						paymentUrl: order.paymentUrl,
				  })
				: redirect(order.paymentUrl, 303);
		}

		if (order.paymentState === 'unknown' || order.paymentState === 'initiating') {
			const message = 'سفارش ثبت شده، اما نتیجهٔ درخواست پرداخت هنوز مشخص نیست؛ برای جلوگیری از پرداخت تکراری دوباره تلاش نکنید.';
			return wantsJson
				? Response.json(
						{ ok: false, number: order.number, status: order.status, paymentState: order.paymentState, message },
						{ status: 202 },
				  )
				: redirect(safeOrderRedirect(order), 303);
		}

		return wantsJson
			? Response.json({
					ok: true,
					number: order.number,
					total: order.total,
					status: order.status,
					paymentState: order.paymentState,
					paymentRequired: false,
			  })
			: redirect(safeOrderRedirect(order), 303);
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
