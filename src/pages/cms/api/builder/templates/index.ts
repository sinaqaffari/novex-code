import { mediaRequestOrigins } from '../../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { can } from '../../../../../lib/cms/rbac.ts';
import { BuilderStoreError, listBuilderTemplates, saveBuilderTemplate } from '../../../../../lib/builder/store.ts';
import { listStarterTemplateSummaries } from '../../../../../lib/builder/templates.ts';
import { readBoundedRequestText } from '../../../../../lib/builder/request.ts';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:read')) return failure('اجازهٔ مشاهدهٔ قالب‌ها را ندارید.', 403);
	try {
		const starters = listStarterTemplateSummaries().map((summary) => ({
			id: summary.id, name: summary.label, description: summary.description, kind: summary.kind, source: 'starter', themeId: summary.themeId,
			...('image' in summary && typeof summary.image === 'string' ? { image: summary.image } : {}),
			...('category' in summary && typeof summary.category === 'string' ? { category: summary.category } : {}),
		}));
		const saved = (await listBuilderTemplates()).map((template) => ({ ...template, description: 'قالب ذخیره‌شدهٔ شما', source: 'saved' }));
		return json({ ok: true, templates: [...starters, ...saved] });
	} catch {
		return failure('خواندن قالب‌ها ممکن نشد.', 500);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ذخیرهٔ قالب را ندارید.', 403);
	try {
		const payload = await readJson(request);
		const name = typeof payload.name === 'string' ? payload.name : '';
		const template = await saveBuilderTemplate({ name, document: payload.document, origins: mediaRequestOrigins(request) });
		return json({ ok: true, template: { id: template.id, name: template.name, createdAt: template.createdAt, updatedAt: template.updatedAt } }, 201);
	} catch (error) {
		return reportError(error);
	}
};

async function readJson(request: Request): Promise<Record<string, unknown>> {
	if (!(request.headers.get('content-type') ?? '').includes('application/json')) throw new BuilderStoreError('درخواست باید JSON باشد.', 415, 'unsupported_content_type');
	const body = await readBoundedRequestText(request, 1_200_000);
	try {
		const parsed: unknown = JSON.parse(body);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
		throw new Error('Expected object');
	} catch {
		throw new BuilderStoreError('بدنهٔ JSON معتبر نیست.', 400, 'invalid_json');
	}
}

function reportError(error: unknown): Response {
	if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message, currentRevision: error.currentRevision }, error.status);
	return failure('ذخیرهٔ قالب انجام نشد.', 500);
}
