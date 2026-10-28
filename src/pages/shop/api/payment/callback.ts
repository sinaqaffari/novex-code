import type { APIRoute } from 'astro';
import { applyFilters } from '../../../../lib/plugins/hooks';
import { ensurePluginsBooted } from '../../../../lib/plugins/registry';
import {
	claimOrderPaymentVerification,
	findOrderByPaymentRef,
	getOrder,
	markOrderPaymentUnknown,
	settleOrderPayment,
} from '../../../../lib/commerce/orders';
import { isRevenue } from '../../../../lib/commerce/types';

export const prerender = false;

function orderPath(number: string, payment: string): string {
	return `/shop/order/${encodeURIComponent(number)}?payment=${encodeURIComponent(payment)}`;
}

export const GET: APIRoute = async ({ url, redirect }) => {
	await ensurePluginsBooted();

	const authority = (url.searchParams.get('Authority') ?? '').trim();
	const providerStatus = url.searchParams.get('Status');
	if (!authority || authority.length > 200 || /[\u0000-\u001f\u007f]/.test(authority)) {
		return redirect('/shop/checkout?error=مرجع پرداخت معتبر نیست.', 303);
	}

	const order = await findOrderByPaymentRef(authority);
	if (!order) return redirect('/shop/checkout?error=سفارش با این مرجع پیدا نشد.', 303);

	// A settled order must never be downgraded by a delayed or duplicate callback.
	if (order.status !== 'pending') {
		return redirect(orderPath(order.number, isRevenue(order.status) ? 'success' : 'failed'), 303);
	}

	if (providerStatus !== 'OK') {
		// Status is a browser-return query parameter, not proof of a payment failure.
		// Do not cancel, restock, or release discounts based on it; keep the order
		// pending so a later server-verified success callback can still settle it.
		return redirect(orderPath(order.number, 'not-confirmed'), 303);
	}

	// The state transition is atomic, so concurrent/repeated callbacks cannot
	// start multiple provider verification requests for the same order.
	const claimed = await claimOrderPaymentVerification(order.id, authority);
	if (!claimed) {
		const latest = await getOrder(order.id);
		if (!latest) return redirect('/shop/checkout?error=سفارش پیدا نشد.', 303);
		if (isRevenue(latest.status)) return redirect(orderPath(latest.number, 'success'), 303);
		return redirect(
			orderPath(latest.number, latest.paymentState === 'unknown' ? 'unknown' : 'processing'),
			303,
		);
	}

	try {
		const verifyResult = await applyFilters('shop.payment.verify', null, {
			authority,
			amount: order.total,
		});
		const verified = Boolean(
			verifyResult &&
			typeof verifyResult === 'object' &&
			(verifyResult as { verified?: boolean }).verified === true,
		);

		if (!verified) {
			await markOrderPaymentUnknown(order.id, authority);
			return redirect(orderPath(order.number, 'unknown'), 303);
		}

		const settlement = await settleOrderPayment(order.id, authority);
		if (settlement.order.status !== 'pending' && isRevenue(settlement.order.status)) {
			return redirect(orderPath(order.number, 'success'), 303);
		}
		return redirect(orderPath(order.number, 'unknown'), 303);
	} catch {
		// A timeout or provider error is ambiguous. Do not cancel/restock: payment
		// may have succeeded remotely. Keep the order pending for reconciliation.
		await markOrderPaymentUnknown(order.id, authority);
		return redirect(orderPath(order.number, 'unknown'), 303);
	}
};
