import type { APIRoute } from 'astro';
import { AppError } from '../../../../lib/errors';
import { failure, json, redirect } from '../../../../lib/cms/http';
import { deleteDiscount, toggleDiscount } from '../../../../lib/commerce/discounts';

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	const action = new URL(request.url).searchParams.get('action') ?? '';
	const id = decodeURIComponent(params.id ?? '');

	try {
		if (action === 'toggle') {
			await toggleDiscount(id);
			const target = '/cms/discounts?flash=status-updated';
			return wantsJson ? json({ ok: true, redirect: target }) : redirect(target);
		}
		if (action === 'delete') {
			await deleteDiscount(id);
			const target = '/cms/discounts?flash=deleted';
			return wantsJson ? json({ ok: true, redirect: target }) : redirect(target);
		}
		throw new AppError('عملیات خواسته‌شده پشتیبانی نمی‌شود.', undefined, 400);
	} catch (error) {
		const message = error instanceof AppError ? error.message : 'عملیات ناموفق بود.';
		const status = error instanceof AppError ? error.status : 500;
		return wantsJson
			? failure(message, status)
			: redirect(`/cms/discounts?error=${encodeURIComponent(message)}`);
	}
};

export const DELETE: APIRoute = async ({ request, params }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	try {
		await deleteDiscount(decodeURIComponent(params.id ?? ''));
		const target = '/cms/discounts?flash=deleted';
		return wantsJson ? json({ ok: true, redirect: target }) : redirect(target);
	} catch (error) {
		const message = error instanceof AppError ? error.message : 'حذف کد ناموفق بود.';
		const status = error instanceof AppError ? error.status : 500;
		return wantsJson
			? failure(message, status)
			: redirect(`/cms/discounts?error=${encodeURIComponent(message)}`);
	}
};
