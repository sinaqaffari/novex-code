import type { APIRoute } from 'astro';
import { applyFilters } from '../../../../lib/plugins/hooks';
import { ensurePluginsBooted } from '../../../../lib/plugins/registry';
import { findOrderByPaymentRef, updateOrderStatus } from '../../../../lib/commerce/orders';

export const prerender = false;

export const GET: APIRoute = async ({ url, redirect }) => {
	await ensurePluginsBooted();

	const authority = url.searchParams.get('Authority');
	const status = url.searchParams.get('Status');

	if (!authority) {
		return redirect('/shop/checkout?error=مرجع پرداخت ارائه نشده است.', 303);
	}

	const order = await findOrderByPaymentRef(authority);
	if (!order) {
		return redirect('/shop/checkout?error=سفارش با این مرجع پیدا نشد.', 303);
	}

	if (status !== 'OK') {
		// کاربر پرداخت را لغو کرد یا بانک پرداخت را رد کرد.
		await updateOrderStatus(order.id, 'cancelled');
		return redirect(
			`/shop/order/${order.number}?error=پرداخت توسط شما یا بانک لغو شد.`,
			303,
		);
	}

	try {
		const verifyResult = await applyFilters('shop.payment.verify', null, {
			authority,
			amount: order.total,
		});

		if (!verifyResult || typeof verifyResult !== 'object' || !(verifyResult as { verified?: boolean }).verified) {
			await updateOrderStatus(order.id, 'cancelled');
			return redirect(
				`/shop/order/${order.number}?error=تایید پرداخت ناموفق بود.`,
				303,
			);
		}

		await updateOrderStatus(order.id, 'paid');
		return redirect(`/shop/order/${order.number}?payment=success`, 303);
	} catch {
		await updateOrderStatus(order.id, 'cancelled');
		return redirect(
			`/shop/order/${order.number}?error=خطا در تایید پرداخت با درگاه.`,
			303,
		);
	}
};
