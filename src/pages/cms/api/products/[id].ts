import type { APIRoute } from 'astro';
import { AppError } from '../../../../lib/errors';
import { failure, json, readPayload, redirect } from '../../../../lib/cms/http';
import {
	deleteProduct,
	duplicateProduct,
	setProductStatus,
	toProductInput,
	updateProduct,
} from '../../../../lib/commerce/products';
import type { ProductStatus } from '../../../../lib/commerce/types';

export const prerender = false;

const notFound = (message: string) => new AppError(message, undefined, 404);

export const PUT: APIRoute = async ({ request, params }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	try {
		const id = decodeURIComponent(params.id ?? '');
		if (!id) throw notFound('شناسهٔ محصول مشخص نیست.');
		const payload = await readPayload(request);
		const product = await updateProduct(id, toProductInput(payload));
		const target = `/cms/products/${product.id}?flash=saved`;
		return wantsJson ? json({ ok: true, id: product.id, redirect: target }) : redirect(target);
	} catch (error) {
		const message = error instanceof AppError ? error.message : 'ذخیرهٔ محصول ناموفق بود.';
		const status = error instanceof AppError ? error.status : 500;
		const field = error instanceof AppError ? error.field : undefined;
		return wantsJson
			? failure(message, status, field)
			: redirect(`/cms/products?error=${encodeURIComponent(message)}`);
	}
};

export const POST: APIRoute = async ({ request, params }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	const action = new URL(request.url).searchParams.get('action') ?? '';
	const id = decodeURIComponent(params.id ?? '');

	try {
		if (!id) throw notFound('شناسهٔ محصول مشخص نیست.');

		if (action === 'delete') {
			await deleteProduct(id);
			const target = '/cms/products?flash=deleted';
			return wantsJson ? json({ ok: true, redirect: target }) : redirect(target);
		}

		if (action === 'duplicate') {
			const copy = await duplicateProduct(id);
			const target = `/cms/products/${copy.id}?flash=duplicated`;
			return wantsJson ? json({ ok: true, id: copy.id, redirect: target }) : redirect(target);
		}

		if (action === 'status') {
			const payload = await readPayload(request);
			const status = String(payload.status ?? '') as ProductStatus;
			if (!['active', 'draft', 'archived'].includes(status)) {
				throw new AppError('وضعیت محصول معتبر نیست.', 'status');
			}
			await setProductStatus(id, status);
			const target = '/cms/products?flash=status-updated';
			return wantsJson ? json({ ok: true, redirect: target }) : redirect(target);
		}

		throw new AppError('عملیات خواسته‌شده پشتیبانی نمی‌شود.', undefined, 400);
	} catch (error) {
		const message = error instanceof AppError ? error.message : 'عملیات ناموفق بود.';
		const status = error instanceof AppError ? error.status : 500;
		return wantsJson
			? failure(message, status)
			: redirect(`/cms/products?error=${encodeURIComponent(message)}`);
	}
};

export const DELETE: APIRoute = async ({ request, params }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	try {
		await deleteProduct(decodeURIComponent(params.id ?? ''));
		const target = '/cms/products?flash=deleted';
		return wantsJson ? json({ ok: true, redirect: target }) : redirect(target);
	} catch (error) {
		const message = error instanceof AppError ? error.message : 'حذف محصول ناموفق بود.';
		const status = error instanceof AppError ? error.status : 500;
		return wantsJson
			? failure(message, status)
			: redirect(`/cms/products?error=${encodeURIComponent(message)}`);
	}
};
