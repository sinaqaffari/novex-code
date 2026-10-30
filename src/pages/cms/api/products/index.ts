import type { APIRoute } from 'astro';
import { AppError } from '../../../../lib/errors';
import { failure, json, readPayload, redirect } from '../../../../lib/cms/http';
import { createProduct, toProductInput } from '../../../../lib/commerce/products';
import { mediaRequestOrigins } from '../../../../lib/urls';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');

	try {
		const payload = await readPayload(request);
		const product = await createProduct(toProductInput(payload), { origins: mediaRequestOrigins(request) });
		const target = `/cms/products/${product.id}?flash=created`;

		return wantsJson ? json({ ok: true, id: product.id, redirect: target }) : redirect(target);
	} catch (error) {
		const message = error instanceof AppError ? error.message : 'ساخت محصول ناموفق بود.';
		const status = error instanceof AppError ? error.status : 500;
		const field = error instanceof AppError ? error.field : undefined;

		return wantsJson
			? failure(message, status, field)
			: redirect(`/cms/products/new?error=${encodeURIComponent(message)}`);
	}
};
