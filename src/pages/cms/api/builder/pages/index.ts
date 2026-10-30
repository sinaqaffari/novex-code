import type { APIRoute } from 'astro';
import { can } from '../../../../../lib/cms/rbac.ts';
import { BuilderStoreError, listBuilderPages, saveDraftPage } from '../../../../../lib/builder/store.ts';
import { createEmptyPageDocument, isValidPageSlug } from '../../../../../lib/builder/document.ts';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { readBoundedRequestForm, readBoundedRequestText } from '../../../../../lib/builder/request.ts';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:read')) return failure('اجازهٔ مشاهدهٔ صفحه‌ها را ندارید.', 403);
	try {
		return json({ ok: true, pages: await listBuilderPages() });
	} catch {
		return failure('خواندن صفحه‌ها ممکن نشد.', 500);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ساخت صفحه را ندارید.', 403);
	try {
		const payload = await readPayload(request);
		const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
		if (!isValidPageSlug(slug)) return failure('نامک باید با حروف کوچک انگلیسی، عدد و خط تیره نوشته شود.', 400, 'slug');
		const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : 'صفحهٔ تازه';
		const expectedRevision = payload.expectedRevision === undefined ? 0 : Number(payload.expectedRevision);
		const record = await saveDraftPage({
			slug,
			expectedRevision,
			document: createEmptyPageDocument(slug, title),
		});
		if (acceptsJson(request)) return json({ ok: true, slug, revision: record.revision, document: record.draft }, 201);
		return new Response(null, { status: 303, headers: { location: `/cms/builder/${encodeURIComponent(slug)}?created=1` } });
	} catch (error) {
		return reportError(error);
	}
};

async function readPayload(request: Request): Promise<Record<string, unknown>> {
	const contentType = request.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		const body = await readText(request);
		try {
			const parsed: unknown = JSON.parse(body);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
			throw new Error('The request body must be a JSON object.');
		} catch {
			throw new BuilderStoreError('بدنهٔ JSON معتبر نیست.', 400, 'invalid_json');
		}
	}
	if (contentType.includes('form') || !contentType) return Object.fromEntries((await readBoundedRequestForm(request, 1_200_000)).entries());
	throw new BuilderStoreError('نوع محتوای درخواست پشتیبانی نمی‌شود.', 415, 'unsupported_content_type');
}

async function readText(request: Request): Promise<string> {
	return readBoundedRequestText(request, 1_200_000);
}

function acceptsJson(request: Request): boolean {
	return (request.headers.get('accept') ?? '').includes('application/json');
}

function reportError(error: unknown): Response {
	if (error instanceof BuilderStoreError) {
		return json({ ok: false, code: error.code, message: error.message, currentRevision: error.currentRevision }, error.status);
	}
	return failure('ساخت صفحه انجام نشد.', 500);
}
