import type { APIRoute } from 'astro';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { can } from '../../../../../lib/cms/rbac.ts';
import { BuilderStoreError, deleteBuilderTemplate, getBuilderTemplate } from '../../../../../lib/builder/store.ts';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:read')) return failure('اجازهٔ مشاهدهٔ قالب را ندارید.', 403);
	try {
		const template = await getBuilderTemplate(params.id ?? '');
		if (!template) return failure('قالب پیدا نشد.', 404);
		return json({ ok: true, template });
	} catch (error) {
		return reportError(error);
	}
};

export const DELETE: APIRoute = async ({ params, locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ حذف قالب را ندارید.', 403);
	try {
		await deleteBuilderTemplate(params.id ?? '');
		return json({ ok: true });
	} catch (error) {
		return reportError(error);
	}
};

function reportError(error: unknown): Response {
	if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message }, error.status);
	return failure('عملیات قالب انجام نشد.', 500);
}
