import { mediaRequestOrigins } from '../../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { can } from '../../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { assetExists } from '../../../../../lib/cms/media.ts';
import { prepareSiteKit, validateSiteKit } from '../../../../../lib/builder/site-kits.ts';
import { verifySiteKitAssets } from '../../../../../lib/builder/site-kit-assets.ts';
import { readBoundedRequestText } from '../../../../../lib/builder/request.ts';
import { BuilderStoreError, installDraftPages, reviewInstalledKitUpdate, updateInstalledKitDrafts } from '../../../../../lib/builder/store.ts';

export const prerender = false;

/** JSON data only; no archive extraction, remote fetch, executable code or automatic publication. */
export const POST: APIRoute = async ({ locals, request }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ویرایش صفحه ندارید.', 403);
	try {
		if (!(request.headers.get('content-type') ?? '').includes('application/json')) return failure('درخواست باید JSON باشد.', 415);
		const text = await readBoundedRequestText(request, 3_200_000);
		let raw: unknown; try { raw = JSON.parse(text); } catch { return failure('JSON معتبر نیست.', 400); }
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return failure('درخواست معتبر نیست.', 400);
		const input = raw as Record<string, unknown>;
		if ((input.action !== 'install' && input.action !== 'update' && input.action !== 'review') || typeof input.prefix !== 'string' || Object.keys(input).some((key) => !['confirm', 'action', 'prefix', 'kit', 'decision'].includes(key)) || (input.action !== 'review' && input.confirm !== true) || (input.action !== 'update' && input.decision !== undefined)) return failure('بسته، پیشوند، عملیات و تأیید لازم است.', 400);
		const kit = validateSiteKit(input.kit);
		if (!await verifySiteKitAssets(kit, assetExists)) return failure('دارایی محلی بسته پیدا نشد؛ هیچ صفحه‌ای تغییر نکرد.', 422);
		const documents = prepareSiteKit(kit, input.prefix);
		const provenance = { id: kit.id, version: kit.version, prefix: input.prefix };
		if (input.action === 'review') return json({ ok: true, review: await reviewInstalledKitUpdate(documents, provenance) });
		const pages = input.action === 'install' ? await installDraftPages(documents, provenance, { origins: mediaRequestOrigins(request) }) : await updateInstalledKitDrafts(documents, provenance, input.decision, { origins: mediaRequestOrigins(request) });
		return json({ ok: true, pages: pages.map(({ slug, revision }) => ({ slug, revision })) }, input.action === 'install' ? 201 : 200);
	} catch (error) {
		if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message, ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }, error.status);
		return failure(error instanceof Error ? error.message : 'بسته معتبر نیست؛ هیچ صفحه‌ای تغییر نکرد.', 422);
	}
};
