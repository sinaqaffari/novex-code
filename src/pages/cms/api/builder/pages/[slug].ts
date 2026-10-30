import { mediaRequestOrigins } from '../../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { can } from '../../../../../lib/cms/rbac.ts';
import { BuilderStoreError, getDraftPage, publishPage, saveDraftPage } from '../../../../../lib/builder/store.ts';
import { isValidPageSlug } from '../../../../../lib/builder/document.ts';
import { readBoundedRequestText } from '../../../../../lib/builder/request.ts';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:read')) return failure('اجازهٔ مشاهدهٔ این صفحه را ندارید.', 403);
	const slug = params.slug ?? '';
	if (!isValidPageSlug(slug)) return failure('نامک صفحه معتبر نیست.', 400);
	try {
		const record = await getDraftPage(slug);
		return json({
			ok: true,
			slug,
			revision: record.revision,
			updatedAt: record.updatedAt,
			publishedAt: record.publishedAt ?? null,
			publishedRevision: record.publishedRevision ?? null,
			document: record.draft,
		});
	} catch (error) {
		return reportError(error);
	}
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ویرایش صفحه را ندارید.', 403);
	const slug = params.slug ?? '';
	if (!isValidPageSlug(slug)) return failure('نامک صفحه معتبر نیست.', 400);
	try {
		const payload = await readPayload(request);
		const record = await saveDraftPage({
			slug,
			expectedRevision: parseRevision(payload.expectedRevision),
			document: payload.document,
			origins: mediaRequestOrigins(request),
		});
		return json({ ok: true, revision: record.revision, updatedAt: record.updatedAt, document: record.draft });
	} catch (error) {
		return reportError(error);
	}
};

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:publish')) return failure('نقش شما اجازهٔ انتشار صفحه را ندارد.', 403);
	const slug = params.slug ?? '';
	if (!isValidPageSlug(slug)) return failure('نامک صفحه معتبر نیست.', 400);
	try {
		const payload = await readPayload(request);
		const record = await publishPage({
			slug,
			expectedRevision: parseRevision(payload.expectedRevision),
			document: payload.document,
			allowHostCode: can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:publishCode'),
			acknowledgeExecutableCode: payload.acknowledgeExecutableCode === true,
			origins: mediaRequestOrigins(request),
		});
		return json({
			ok: true,
			revision: record.revision,
			publishedRevision: record.publishedRevision,
			publishedAt: record.publishedAt,
			publicUrl: `/pages/${encodeURIComponent(slug)}`,
		});
	} catch (error) {
		return reportError(error);
	}
};

async function readPayload(request: Request): Promise<Record<string, unknown>> {
	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.includes('application/json')) throw new BuilderStoreError('درخواست باید JSON باشد.', 415, 'unsupported_content_type');
	const body = await readBoundedRequestText(request, 1_200_000);
	try {
		const parsed: unknown = JSON.parse(body);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object.');
		return parsed as Record<string, unknown>;
	} catch {
		throw new BuilderStoreError('بدنهٔ JSON معتبر نیست.', 400, 'invalid_json');
	}
}

function parseRevision(value: unknown): number {
	const revision = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
	if (!Number.isSafeInteger(revision) || revision < 0) throw new BuilderStoreError('شمارهٔ نسخه معتبر نیست.', 400, 'invalid_revision');
	return revision;
}

function reportError(error: unknown): Response {
	if (error instanceof BuilderStoreError) {
		return json({ ok: false, code: error.code, message: error.message, currentRevision: error.currentRevision, ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }, error.status);
	}
	return failure('عملیات صفحه‌ساز انجام نشد.', 500);
}
