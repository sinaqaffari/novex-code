import type { APIRoute } from 'astro';
import { getOrder } from '../../../lib/commerce/orders';
import {
	clearOrderAccessFailures,
	createOrderAccessToken,
	normalizeOrderPhone,
	orderAccessCookieOptions,
	orderAccessRemaining,
	ORDER_ACCESS_COOKIE,
	recordOrderAccessFailure,
} from '../../../lib/commerce/order-access';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect, clientAddress }) => {
	const form = await request.formData();
	const rawNumber = String(form.get('number') ?? '').trim();
	const rawPhone = String(form.get('phone') ?? '');
	const number = rawNumber.length <= 80 ? rawNumber.toUpperCase() : '';
	const providedPhone = rawPhone.length <= 64 ? normalizeOrderPhone(rawPhone) : '';
	const order = number ? await getOrder(number) : null;
	const orderPath = order ? `/shop/order/${encodeURIComponent(order.number)}` : '';
	const invoicePath = order ? `/shop/invoice/${encodeURIComponent(order.number)}` : '';
	const returnCandidate = String(form.get('returnTo') ?? '');
	const requestedReturn = returnCandidate.length <= 256 ? returnCandidate : '';
	const safeReturn = requestedReturn === invoicePath ? invoicePath : orderPath;
	const clientKey = clientAddress || 'unknown-client';

	if (orderAccessRemaining(clientKey) > 0) return redirect('/shop/track?error=rate-limited', 303);

	const storedPhone = order ? normalizeOrderPhone(order.phone) : '';
	if (!order || !providedPhone || providedPhone !== storedPhone) {
		recordOrderAccessFailure(clientKey);
		return redirect('/shop/track?error=not-found', 303);
	}

	clearOrderAccessFailures(clientKey);
	cookies.set(ORDER_ACCESS_COOKIE, createOrderAccessToken(order.number, order.phone), orderAccessCookieOptions);

	return redirect(safeReturn, 303);
};
