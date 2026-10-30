import { mediaRequestOrigins } from '../../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { can } from '../../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { listSiteKits, prepareSiteKit } from '../../../../../lib/builder/site-kits.ts';
import { verifySiteKitAssets } from '../../../../../lib/builder/site-kit-assets.ts';
import { readBoundedRequestText } from '../../../../../lib/builder/request.ts';
import { BuilderStoreError, reviewInstalledKitUpdate, updateInstalledKitDrafts } from '../../../../../lib/builder/store.ts';
import { assetExists } from '../../../../../lib/cms/media.ts';

export const prerender = false;
export const POST: APIRoute = async ({ locals, request }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ویرایش صفحه ندارید.', 403);
	try {
		if (!(request.headers.get('content-type') ?? '').includes('application/json')) return failure('درخواست باید JSON باشد.', 415);
		const text = await readBoundedRequestText(request, 160_000);
		let input: unknown; try { input = JSON.parse(text); } catch { return failure('JSON معتبر نیست.', 400); }
		if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('درخواست معتبر نیست.', 400);
		const value = input as Record<string, unknown>;
		if (typeof value.id !== 'string' || typeof value.prefix !== 'string' || (value.action !== undefined && value.action !== 'review') || (value.action !== 'review' && value.confirmUpdate !== true) || (value.action === 'review' && value.decision !== undefined) || Object.keys(value).some((key) => !['id', 'prefix', 'confirmUpdate', 'action', 'decision'].includes(key))) return failure('شناسه، پیشوند و تأیید لازم است.', 400);
		const kit = listSiteKits().find((item) => item.id === value.id);
		if (!kit) return failure('بسته پیدا نشد.', 404);
		if (!await verifySiteKitAssets(kit, assetExists)) return failure('دارایی بومی بسته پیدا نشد؛ هیچ صفحه‌ای تغییر نکرد.', 422);
		const documents = prepareSiteKit(kit, value.prefix);
		const provenance = { id: kit.id, version: kit.version, prefix: value.prefix };
		if (value.action === 'review') return json({ ok: true, review: await reviewInstalledKitUpdate(documents, provenance) });
		const records = await updateInstalledKitDrafts(documents, provenance, value.decision, { origins: mediaRequestOrigins(request) });
		return json({ ok: true, pages: records.map(({ slug, revision }) => ({ slug, revision })) });
	} catch (error) {
		if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message, ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }, error.status);
		return failure('به‌روزرسانی بسته انجام نشد. هیچ محتوایی تغییر نکرد.', 422);
	}
};
