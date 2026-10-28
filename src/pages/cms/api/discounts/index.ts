import type { APIRoute } from 'astro';
import { AppError } from '../../../../lib/errors';
import { failure, json, readPayload, redirect } from '../../../../lib/cms/http';
import { createDiscount, toDiscountInput } from '../../../../lib/commerce/discounts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	try {
		const payload = await readPayload(request);
		const discount = await createDiscount(toDiscountInput(payload));
		const target = '/cms/discounts?flash=created';
		return wantsJson ? json({ ok: true, id: discount.id, redirect: target }) : redirect(target);
	} catch (error) {
		const message = error instanceof AppError ? error.message : 'ساخت کد تخفیف ناموفق بود.';
		const status = error instanceof AppError ? error.status : 500;
		const field = error instanceof AppError ? error.field : undefined;
		return wantsJson
			? failure(message, status, field)
			: redirect(`/cms/discounts?error=${encodeURIComponent(message)}`);
	}
};
