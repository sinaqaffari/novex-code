import type { APIRoute } from 'astro';
import { can } from '../../../../lib/cms/rbac';
import { failure, json } from '../../../../lib/cms/http';
import { builderMediaReferenceFromPublicUrl } from '../../../../lib/builder/media-reference';
import { listMedia } from '../../../../lib/cms/media';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.media:read')) {
		return failure('اجازهٔ مشاهدهٔ کتابخانهٔ رسانه را ندارید.', 403);
	}
	try {
		const media = (await listMedia())
			.map(({ name, publicUrl, previewUrl, bytes, modifiedAt, builtin }) => ({
				name,
				assetRef: builderMediaReferenceFromPublicUrl(publicUrl),
				publicUrl,
				previewUrl,
				bytes,
				modifiedAt,
				builtin,
			}))
			.filter((item) => item.assetRef !== null);
		return json({ ok: true, media });
	} catch {
		return failure('خواندن کتابخانهٔ رسانه ممکن نشد.', 500);
	}
};
