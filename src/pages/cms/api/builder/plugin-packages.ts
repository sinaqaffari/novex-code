import { mediaRequestOrigins } from '../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { can, type Role } from '../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../lib/cms/http.ts';
import { readBoundedRequestText } from '../../../../lib/builder/request.ts';
import { BuilderStoreError, changeDeclarativePluginPackage, installDeclarativePluginPackage, listDeclarativePluginPackages } from '../../../../lib/builder/store.ts';

export const prerender = false;
const allowed = (role: Role | undefined, write = false) => can(role ?? 'subscriber', write ? 'cms.plugins:write' : 'cms.plugins:read');

export const GET: APIRoute = async ({ locals }) => {
	if (!allowed(locals.cmsUser?.role)) return failure('اجازهٔ مشاهدهٔ بسته‌ها را ندارید.', 403);
	try { return json({ ok: true, packages: await listDeclarativePluginPackages() }); } catch (error) { return report(error); }
};

async function body(request: Request): Promise<Record<string, unknown>> {
	if (!(request.headers.get('content-type') ?? '').includes('application/json')) throw new BuilderStoreError('درخواست باید JSON باشد.', 415, 'unsupported_content_type');
	const text = await readBoundedRequestText(request, 520_000);
	let raw: unknown; try { raw = JSON.parse(text); } catch { throw new BuilderStoreError('JSON معتبر نیست.', 400, 'invalid_json'); }
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BuilderStoreError('درخواست معتبر نیست.', 400, 'invalid_request');
	return raw as Record<string, unknown>;
}
function revision(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function report(error: unknown): Response {
	if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message, ...(error.currentRevision ? { currentRevision: error.currentRevision } : {}) }, error.status);
	return failure(error instanceof Error ? error.message : 'بسته معتبر نیست.', 422);
}

export const POST: APIRoute = async ({ locals, request }) => {
	if (!allowed(locals.cmsUser?.role, true)) return failure('اجازهٔ نصب بسته ندارید.', 403);
	try {
		const input = await body(request);
		if (Object.keys(input).some((key) => !['action', 'confirm', 'package', 'expectedRevision'].includes(key)) || input.confirm !== true || (input.action !== 'install' && input.action !== 'update') || (input.action === 'update' && !revision(input.expectedRevision))) return failure('عملیات و تأیید معتبر لازم است.', 400);
		const record = await installDeclarativePluginPackage(input.package, input.action, revision(input.expectedRevision) ? input.expectedRevision : undefined, mediaRequestOrigins(request));
		return json({ ok: true, record }, input.action === 'install' ? 201 : 200);
	} catch (error) { return report(error); }
};

export const PATCH: APIRoute = async ({ locals, request }) => {
	if (!allowed(locals.cmsUser?.role, true)) return failure('اجازهٔ تغییر بسته ندارید.', 403);
	try {
		const input = await body(request);
		if (Object.keys(input).some((key) => !['id', 'expectedRevision', 'active'].includes(key)) || typeof input.id !== 'string' || !revision(input.expectedRevision) || typeof input.active !== 'boolean') return failure('درخواست تغییر معتبر نیست.', 400);
		await changeDeclarativePluginPackage(input.id, input.expectedRevision, input.active);
		return json({ ok: true });
	} catch (error) { return report(error); }
};

export const DELETE: APIRoute = async ({ locals, request }) => {
	if (!allowed(locals.cmsUser?.role, true)) return failure('اجازهٔ حذف بسته ندارید.', 403);
	try {
		const input = await body(request);
		if (Object.keys(input).some((key) => !['id', 'expectedRevision', 'confirm'].includes(key)) || typeof input.id !== 'string' || !revision(input.expectedRevision) || input.confirm !== true) return failure('تأیید حذف و نسخهٔ معتبر لازم است.', 400);
		await changeDeclarativePluginPackage(input.id, input.expectedRevision, null);
		return json({ ok: true });
	} catch (error) { return report(error); }
};
