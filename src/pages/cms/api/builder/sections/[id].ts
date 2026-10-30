import { mediaRequestOrigins } from '../../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { can } from '../../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { getSharedSection, updateSharedSection } from '../../../../../lib/builder/store.ts';
import { readSectionRequest, sectionError, sectionPayload } from '../../../../../lib/builder/section-api.ts';

export const prerender = false;
export const GET: APIRoute = async ({ locals, params }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:read')) return failure('اجازهٔ مشاهدهٔ بخش را ندارید.', 403);
	try {
		const section = await getSharedSection(params.id ?? '');
		return section ? json({ ok: true, section: sectionPayload(section) }) : failure('بخش مشترک پیدا نشد.', 404);
	} catch (error) { return sectionError(error); }
};
export const PUT: APIRoute = async ({ locals, params, request }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ویرایش بخش را ندارید.', 403);
	try {
		const input = await readSectionRequest(request);
		if (typeof input.expectedRevision !== 'number' || !('node' in input) || Object.keys(input).some((key) => key !== 'expectedRevision' && key !== 'node' && key !== 'breakpoints')) return failure('نسخه و سند بخش لازم است.', 400);
		const section = await updateSharedSection(params.id ?? '', input.expectedRevision, input.node, input.breakpoints, mediaRequestOrigins(request));
		return json({ ok: true, section: sectionPayload(section) });
	} catch (error) { return sectionError(error); }
};
