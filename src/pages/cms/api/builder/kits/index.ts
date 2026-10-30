import type { APIRoute } from 'astro';
import { can } from '../../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { listSiteKits, prepareSiteKit } from '../../../../../lib/builder/site-kits.ts';
import { assetExists } from '../../../../../lib/cms/media.ts';
import { verifySiteKitAssets } from '../../../../../lib/builder/site-kit-assets.ts';
import { BuilderStoreError, installDraftPages } from '../../../../../lib/builder/store.ts';

export const prerender = false;
export const GET: APIRoute = async ({ locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:read')) return failure('اجازهٔ مشاهدهٔ بسته‌ها را ندارید.', 403);
	return json({ ok: true, kits: listSiteKits() });
};
export const POST: APIRoute = async ({ locals, request }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ساخت صفحه را ندارید.', 403);
	try {
		if (!(request.headers.get('content-type') ?? '').includes('application/json')) return failure('درخواست باید JSON باشد.', 415);
		if (Number(request.headers.get('content-length') ?? 0) > 4096) return failure('درخواست بیش از اندازه بزرگ است.', 413);
		const text = await request.text();
		if (new TextEncoder().encode(text).byteLength > 4096) return failure('درخواست بیش از اندازه بزرگ است.', 413);
		let value: unknown; try { value = JSON.parse(text); } catch { return failure('JSON معتبر نیست.', 400); }
		if (!value || typeof value !== 'object' || Array.isArray(value)) return failure('درخواست معتبر نیست.', 400);
		const payload = value as Record<string, unknown>;
		if (typeof payload.id !== 'string' || typeof payload.prefix !== 'string') return failure('شناسه و پیشوند لازم است.', 400);
		const kit = listSiteKits().find((item) => item.id === payload.id);
		if (!kit) return failure('بسته پیدا نشد.', 404);
		if (!await verifySiteKitAssets(kit, assetExists)) return failure('دارایی بومی بسته پیدا نشد؛ هیچ صفحه‌ای ساخته نشد.', 422);
		const records = await installDraftPages(prepareSiteKit(kit, payload.prefix));
		return json({ ok: true, pages: records.map(({ slug, revision }) => ({ slug, revision })) }, 201);
	} catch (error) {
		if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message }, error.status);
		return failure('نصب بسته انجام نشد. پیشوند و سازگاری بسته را بررسی کنید.', 422);
	}
};
