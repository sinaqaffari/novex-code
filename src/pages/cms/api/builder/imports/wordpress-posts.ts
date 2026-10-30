import { mediaRequestOrigins } from '../../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { AppError } from '../../../../../lib/errors.ts';
import { can } from '../../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { assetExists } from '../../../../../lib/cms/media.ts';
import { createDraftPostBatch } from '../../../../../lib/cms/posts.ts';
import { BuilderStoreError } from '../../../../../lib/builder/store.ts';
import { readBoundedRequestText } from '../../../../../lib/builder/request.ts';
import { parseBuilderMediaReference } from '../../../../../lib/builder/media-reference.ts';
import { parseMigrationMediaMap } from '../../../../../lib/migrations/media-map.ts';
import { inspectWxr } from '../../../../../lib/migrations/wordpress/wxr.ts';
import { wxrToBlogDrafts } from '../../../../../lib/migrations/wordpress/blog-post.ts';

export const prerender = false;
const MAX_BYTES = 3_000_000;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Reinspect a bounded WXR locally and create actual CMS drafts, never publish. */
export const POST: APIRoute = async ({ locals, request }) => {
	const role = locals.cmsUser?.role ?? 'subscriber';
	if (!can(role, 'cms.posts:write')) return failure('اجازهٔ ساخت نوشته ندارید.', 403);
	if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return failure('درخواست باید JSON باشد.', 415);
	try {
		let payload: unknown;
		try { payload = JSON.parse(await readBoundedRequestText(request, MAX_BYTES)); }
		catch (error) { if (error instanceof BuilderStoreError) throw error; return failure('بدنهٔ JSON معتبر نیست.', 400); }
		if (!record(payload) || Object.keys(payload).some((key) => !['xml', 'prefix', 'mediaMap', 'confirmCreate'].includes(key)) || typeof payload.xml !== 'string' || typeof payload.prefix !== 'string' || payload.confirmCreate !== true) return failure('فایل WXR، پیشوند و تأیید ساخت نوشته لازم است.', 400);
		const mapping = parseMigrationMediaMap(payload.mediaMap ?? {});
		if (mapping.size && !can(role, 'cms.media:read')) return failure('برای استفاده از نگاشت، مجوز خواندن رسانه لازم است.', 403);
		for (const target of new Set(mapping.values())) {
			const ref = parseBuilderMediaReference(target)!;
			if (!await assetExists(ref.bucket === 'uploads' ? `uploads/${ref.name}` : ref.name)) throw new AppError('یکی از رسانه‌های مقصد در کتابخانه پیدا نشد؛ هیچ نوشته‌ای ساخته نشد.', 'mediaMap', 409);
		}
		const inspection = inspectWxr(payload.xml);
		const drafts = wxrToBlogDrafts(inspection, payload.prefix, mapping);
		const ids = await createDraftPostBatch(drafts.map(({ warnings: _warnings, ...draft }) => draft), { origins: mediaRequestOrigins(request) });
		return json({ ok: true, posts: ids.map((id) => ({ id })) }, 201);
	} catch (error) {
		if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message }, error.status);
		if (error instanceof AppError) return json({ ok: false, code: error.status >= 500 ? 'post_batch_uncertain' : 'post_batch_rejected', message: error.message, ...(error.field ? { field: error.field } : {}) }, error.status);
		return json({ ok: false, code: 'invalid_wxr_post_batch', message: error instanceof Error ? error.message : 'ورود نوشته‌ها انجام نشد.' }, 422);
	}
};
