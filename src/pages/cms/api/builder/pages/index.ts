import type { APIRoute } from 'astro';
import { can } from '../../../../../lib/cms/rbac.ts';
import { BuilderStoreError, listBuilderPages, saveDraftPage } from '../../../../../lib/builder/store.ts';
import { createEmptyPageDocument, isValidPageSlug } from '../../../../../lib/builder/document.ts';
import { applyTemplate, getStarterTemplate } from '../../../../../lib/builder/templates.ts';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { readBoundedRequestForm, readBoundedRequestText } from '../../../../../lib/builder/request.ts';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:read')) return failure('اجازهٔ مشاهدهٔ صفحه‌ها را ندارید.', 403);
	try {
		return json({ ok: true, pages: await listBuilderPages() });
	} catch (error) {
		if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message }, error.status);
		return failure('خواندن صفحه‌ها ممکن نشد.', 500);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ساخت صفحه را ندارید.', 403);
	let payload: Record<string, unknown> = {};
	try {
		payload = await readPayload(request);
		const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
		if (!isValidPageSlug(slug)) throw new BuilderStoreError('نامک باید با حروف کوچک انگلیسی، عدد و خط تیره نوشته شود.', 400, 'slug');
		const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : 'صفحهٔ تازه';
		if (title.length > 100 || /[\u0000-\u001f\u007f]/.test(title)) throw new BuilderStoreError('عنوان صفحه معتبر نیست یا بیش از ۱۰۰ نویسه دارد.', 400, 'title');
		// This endpoint creates pages; an arbitrary revision must never turn it into an overwrite.
		if (payload.expectedRevision !== undefined && Number(payload.expectedRevision) !== 0) throw new BuilderStoreError('ساخت صفحه فقط برای نامک تازه مجاز است.', 400, 'invalid_revision');
		let document = createEmptyPageDocument(slug, title);
		const hasTemplate = payload.templateId !== undefined && payload.templateId !== '';
		const hasSection = payload.sectionId !== undefined && payload.sectionId !== '';
		if (hasTemplate && hasSection) throw new BuilderStoreError('یک صفحه یا یک بخش برای شروع انتخاب کنید، نه هر دو.', 400, 'invalid_template');
		if (hasTemplate || hasSection) {
			const id = hasTemplate ? payload.templateId : payload.sectionId;
			if (typeof id !== 'string' || id.length > 60) throw new BuilderStoreError('طرح انتخابی معتبر نیست.', 400, 'invalid_template');
			const template = getStarterTemplate(id);
			if (!template || template.kind !== (hasTemplate ? 'page' : 'section')) throw new BuilderStoreError(hasTemplate ? 'قالب صفحه پیدا نشد.' : 'بخش آماده پیدا نشد.', 404, 'template_not_found');
			document = applyTemplate(template.document, document);
		}
		const record = await saveDraftPage({ slug, expectedRevision: 0, document });
		if (acceptsJson(request)) return json({ ok: true, slug, revision: record.revision, document: record.draft }, 201);
		return new Response(null, { status: 303, headers: { location: `/cms/builder/${encodeURIComponent(slug)}?created=1` } });
	} catch (error) {
		// A revision conflict here means the requested new slug already exists;
		// unlike an editor save conflict, reloading the form cannot resolve it.
		const reported = error instanceof BuilderStoreError && error.code === 'revision_conflict'
			? new BuilderStoreError('صفحه‌ای با این نامک وجود دارد؛ نامک دیگری انتخاب کنید.', error.status, error.code, error.currentRevision)
			: error;
		if (!acceptsJson(request) && reported instanceof BuilderStoreError) {
			const params = new URLSearchParams({ error: reported.message });
			for (const key of ['templateId', 'sectionId', 'title', 'slug'] as const) {
				if (typeof payload[key] === 'string') params.set(key === 'templateId' ? 'template' : key === 'sectionId' ? 'section' : key, payload[key].slice(0, 100));
			}
			return new Response(null, { status: 303, headers: { location: `/cms/pages/new?${params}` } });
		}
		return reportError(reported);
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
