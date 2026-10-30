import type { APIRoute } from 'astro';
import { failure, json, readPayload, redirect } from '../../../../lib/cms/http.ts';
import { toPostInput } from '../../../../lib/cms/input.ts';
import { CmsError, deletePost, duplicatePost, updatePost } from '../../../../lib/cms/posts.ts';
import { mediaRequestOrigins } from '../../../../lib/urls.ts';

export const prerender = false;

const idFrom = (params: Record<string, string | undefined>) => {
	const raw = params.id ?? '';
	if (!raw) throw new CmsError('شناسهٔ نوشته مشخص نیست.', undefined, 400);
	return decodeURIComponent(raw);
};

function handleError(error: unknown, wantsJson: boolean, fallbackPath: string): Response {
	if (error instanceof CmsError) {
		if (wantsJson) return failure(error.message, error.status, error.field);
		return redirect(`${fallbackPath}?error=${encodeURIComponent(error.message)}`);
	}
	const message = 'عملیات ناموفق بود.';
	return wantsJson ? failure(message, 500) : redirect(`${fallbackPath}?error=${encodeURIComponent(message)}`);
}

/** Save an existing post (the editor posts here). */
export const PUT: APIRoute = async ({ request, params, locals }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	let id = params.id ?? '';

	try {
		id = idFrom(params);
		const payload = await readPayload(request);
		const input = toPostInput(payload);
		const role = locals.cmsUser?.role ?? 'subscriber';
		const nextId = await updatePost(id, input, { role, origins: mediaRequestOrigins(request) });

		if (wantsJson) {
			return json({ ok: true, id: nextId, redirect: `/cms/posts/${nextId}?flash=saved` });
		}
		return redirect(`/cms/posts/${encodeURIComponent(nextId)}?flash=saved`);
	} catch (error) {
		return handleError(error, wantsJson, `/cms/posts/${encodeURIComponent(id)}`);
	}
};

export const POST: APIRoute = async ({ request, params }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	const action = new URL(request.url).searchParams.get('action') ?? 'duplicate';
	let id = params.id ?? '';

	try {
		id = idFrom(params);

		if (action === 'duplicate') {
			const nextId = await duplicatePost(id, { origins: mediaRequestOrigins(request) });
			if (wantsJson) return json({ ok: true, id: nextId, redirect: `/cms/posts/${nextId}` });
			return redirect(`/cms/posts/${encodeURIComponent(nextId)}?flash=duplicated`);
		}

		if (action === 'delete') {
			await deletePost(id);
			if (wantsJson) return json({ ok: true, redirect: '/cms/posts?flash=deleted' });
			return redirect('/cms/posts?flash=deleted');
		}

		throw new CmsError('عملیات خواسته‌شده پشتیبانی نمی‌شود.', undefined, 400);
	} catch (error) {
		return handleError(error, wantsJson, '/cms/posts');
	}
};

export const DELETE: APIRoute = async ({ request, params }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	try {
		const id = idFrom(params);
		await deletePost(id);
		return wantsJson
			? json({ ok: true, redirect: '/cms/posts?flash=deleted' })
			: redirect('/cms/posts?flash=deleted');
	} catch (error) {
		return handleError(error, wantsJson, '/cms/posts');
	}
};
