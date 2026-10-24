import type { APIRoute } from 'astro';
import { failure, json, readPayload, redirect } from '../../../../lib/cms/http';
import { toPostInput } from '../../../../lib/cms/input';
import { CmsError, createPost, listPosts } from '../../../../lib/cms/posts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');

	try {
		const payload = await readPayload(request);
		const id = await createPost(toPostInput(payload));

		if (wantsJson) return json({ ok: true, id, redirect: `/cms/posts/${id}?flash=created` });
		return redirect(`/cms/posts/${encodeURIComponent(id)}?flash=created`);
	} catch (error) {
		const message = error instanceof CmsError ? error.message : 'ساخت نوشته ناموفق بود.';
		const field = error instanceof CmsError ? error.field : undefined;
		const status = error instanceof CmsError ? error.status : 500;

		if (wantsJson) return failure(message, status, field);
		return redirect(`/cms/posts/new?error=${encodeURIComponent(message)}`);
	}
};

export const GET: APIRoute = async () => {
	const posts = await listPosts();
	return json({ ok: true, posts });
};
