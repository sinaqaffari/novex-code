import { mediaRequestOrigins } from '../../../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { can } from '../../../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../../../lib/cms/http.ts';
import { synchronizeSharedSection } from '../../../../../../lib/builder/store.ts';
import { readSectionRequest, sectionError } from '../../../../../../lib/builder/section-api.ts';

export const prerender = false;
export const POST: APIRoute = async ({ locals, params, request }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ویرایش بخش را ندارید.', 403);
	try {
		const input = await readSectionRequest(request);
		if (input.confirm !== true || typeof input.expectedRevision !== 'number' || Object.keys(input).some((key) => key !== 'confirm' && key !== 'expectedRevision')) return failure('نسخه و تأیید همگام‌سازی لازم است.', 400);
		const pages = await synchronizeSharedSection(params.id ?? '', input.expectedRevision, mediaRequestOrigins(request));
		return json({ ok: true, pages: pages.map(({ slug, revision }) => ({ slug, revision })) });
	} catch (error) { return sectionError(error); }
};
