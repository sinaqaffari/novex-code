import type { APIRoute } from 'astro';
import { failure, json, readPayload, redirect } from '../../../../lib/cms/http.ts';
import { toPostInput } from '../../../../lib/cms/input.ts';
import { CmsError, createPost, listPosts } from '../../../../lib/cms/posts.ts';
import { can } from '../../../../lib/cms/rbac.ts';
import { mediaRequestOrigins } from '../../../../lib/urls.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');

	try {
		const payload = await readPayload(request);
		const input = toPostInput(payload);
		const role = locals.cmsUser?.role ?? 'subscriber';
		if (!can(role, 'cms.posts:write')) throw new CmsError('مجوز ساخت نوشته را ندارید.', undefined, 403);
		if (!input.draft && !can(role, 'cms.posts:publish')) {
			throw new CmsError('مجوز انتشار نوشته را ندارید؛ نوشته را به‌صورت پیش‌نویس ذخیره کنید.', 'draft', 403);
		}
		const id = await createPost(input, { origins: mediaRequestOrigins(request) });

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

export const GET: APIRoute = async ({ locals }) => {
	const posts = await listPosts();
	const visible = can(locals.cmsUser?.role ?? 'subscriber', 'cms.posts:write')
		? posts
		: posts.filter((post) => !post.draft);
	return json({ ok: true, posts: visible });
};
