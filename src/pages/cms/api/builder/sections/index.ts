import { mediaRequestOrigins } from '../../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { can } from '../../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { createSharedSection, listSharedSections } from '../../../../../lib/builder/store.ts';
import { readSectionRequest, sectionError, sectionPayload } from '../../../../../lib/builder/section-api.ts';

export const prerender = false;
export const GET: APIRoute = async ({ locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:read')) return failure('اجازهٔ مشاهدهٔ بخش‌ها را ندارید.', 403);
	try { return json({ ok: true, sections: await listSharedSections() }); } catch (error) { return sectionError(error); }
};
export const POST: APIRoute = async ({ locals, request }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ذخیرهٔ بخش را ندارید.', 403);
	try {
		const input = await readSectionRequest(request);
		if (typeof input.name !== 'string' || !('node' in input) || Object.keys(input).some((key) => key !== 'name' && key !== 'node' && key !== 'breakpoints')) return failure('نام و سند بخش لازم است.', 400);
		return json({ ok: true, section: sectionPayload(await createSharedSection(input.name, input.node, input.breakpoints, mediaRequestOrigins(request))) }, 201);
	} catch (error) { return sectionError(error); }
};
