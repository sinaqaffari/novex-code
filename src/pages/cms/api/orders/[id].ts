import type { APIRoute } from 'astro';
import { AppError } from '../../../../lib/errors';
import { asText, failure, json, readPayload, redirect } from '../../../../lib/cms/http';
import {
	getOrder,
	toOrderStatus,
	updateOrderNote,
	updateOrderStatus,
} from '../../../../lib/commerce/orders';

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	const id = decodeURIComponent(params.id ?? '');
	const target = `/cms/orders/${encodeURIComponent(id)}`;

	try {
		const payload = await readPayload(request);
		const action = asText(payload.action);
		const order = await getOrder(id);
		if (!order) throw new AppError('سفارش پیدا نشد.', undefined, 404);

		if (action === 'status') {
			await updateOrderStatus(order.id, toOrderStatus(payload.status));
			const url = `${target}?flash=status-updated`;
			return wantsJson ? json({ ok: true, redirect: url }) : redirect(url);
		}

		if (action === 'note') {
			await updateOrderNote(order.id, asText(payload.note));
			const url = `${target}?flash=saved`;
			return wantsJson ? json({ ok: true, redirect: url }) : redirect(url);
		}

		throw new AppError('عملیات خواسته‌شده پشتیبانی نمی‌شود.', undefined, 400);
	} catch (error) {
		const message = error instanceof AppError ? error.message : 'به‌روزرسانی سفارش ناموفق بود.';
		const status = error instanceof AppError ? error.status : 500;
		return wantsJson
			? failure(message, status)
			: redirect(`${target}?error=${encodeURIComponent(message)}`);
	}
};
