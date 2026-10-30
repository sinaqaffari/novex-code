import { mediaRequestOrigins } from '../../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { can } from '../../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { assetExists, deleteUpload, saveKitUpload } from '../../../../../lib/cms/media.ts';
import { AppError } from '../../../../../lib/errors.ts';
import { parseBuilderMediaReference } from '../../../../../lib/builder/media-reference.ts';
import { prepareSiteKit } from '../../../../../lib/builder/site-kits.ts';
import { inspectSiteKitArchive, MAX_KIT_ARCHIVE_BYTES } from '../../../../../lib/builder/site-kit-archive.ts';
import { readBoundedRequestForm } from '../../../../../lib/builder/request.ts';
import { BuilderStoreError, installDraftPages, reviewInstalledKitUpdate, updateInstalledKitDrafts } from '../../../../../lib/builder/store.ts';

export const prerender = false;

/** Bounded data-only ZIP packages; entries are never extracted by archive path. */
export const POST: APIRoute = async ({ locals, request }) => {
	const role = locals.cmsUser?.role ?? 'subscriber';
	if (!can(role, 'cms.pages:write')) return failure('اجازهٔ ویرایش صفحه ندارید.', 403);
	const created: string[] = [];
	try {
		if (!(request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) return failure('درخواست باید فرم چندبخشی باشد.', 415);
		const form = await readBoundedRequestForm(request, MAX_KIT_ARCHIVE_BYTES + 256 * 1024);
		if ([...form.keys()].some((key) => !['action', 'archive', 'prefix', 'confirm', 'decision'].includes(key)) || ['action', 'archive', 'prefix', 'confirm', 'decision'].some((key) => form.getAll(key).length > 1)) return failure('فیلدهای فرم معتبر نیستند.', 400);
		const action = form.get('action');
		const file = form.get('archive');
		if ((action !== 'inspect' && action !== 'install' && action !== 'update' && action !== 'review') || !(file instanceof File) || !file.size || file.size > MAX_KIT_ARCHIVE_BYTES) return failure('فایل ZIP و عملیات معتبر لازم است.', 400);
		const inspected = await inspectSiteKitArchive(new Uint8Array(await file.arrayBuffer()));
		const { kit, assets } = inspected;
		if (action === 'inspect') {
			return json({ ok: true, kit: { id: kit.id, name: kit.name, version: kit.version, pages: kit.pages.map(({ suffix, title }) => ({ suffix, title })), assetCount: assets.length } });
		}
		if (typeof form.get('prefix') !== 'string' || (action !== 'review' && form.get('confirm') !== 'true') || (action !== 'update' && form.has('decision'))) return failure('پیشوند و تأیید صریح لازم است.', 400);
		if (action !== 'review' && assets.length && !can(role, 'cms.media:write')) return failure('برای نصب تصویرهای بسته مجوز بارگذاری رسانه لازم است.', 403);
		let decision: unknown;
		if (form.has('decision')) {
			const raw = form.get('decision');
			if (typeof raw !== 'string' || raw.length > 160_000) return failure('تصمیم بررسی معتبر نیست.', 400);
			try { decision = JSON.parse(raw); } catch { return failure('تصمیم بررسی معتبر نیست.', 400); }
		}
		const documents = prepareSiteKit(kit, String(form.get('prefix')));
		for (const asset of kit.assets) {
			const ref = parseBuilderMediaReference(asset)!;
			if (ref.bucket === 'assets' && !await assetExists(ref.name)) return failure('دارایی بومی بسته پیدا نشد؛ هیچ صفحه‌ای تغییر نکرد.', 422);
		}
		const provenance = { id: kit.id, version: kit.version, prefix: String(form.get('prefix')) };
		if (action === 'review') return json({ ok: true, review: await reviewInstalledKitUpdate(documents, provenance) });
		for (const asset of assets) {
			const saved = await saveKitUpload(asset.file);
			if (!saved.reused) created.push(saved.name);
			if (asset.destination !== `media://uploads/${saved.name}`) throw new Error('شناسهٔ دارایی بسته مطابقت ندارد.');
		}
		const pages = action === 'install' ? await installDraftPages(documents, provenance, { origins: mediaRequestOrigins(request) }) : await updateInstalledKitDrafts(documents, provenance, decision, { origins: mediaRequestOrigins(request) });
		return json({ ok: true, pages: pages.map(({ slug, revision }) => ({ slug, revision })), uploaded: created.length, reused: assets.length - created.length, createdUploads: created }, action === 'install' ? 201 : 200);
	} catch (error) {
		// Remove only files created by this request, with the normal locked usage
		// check. A concurrent reference prevents deletion; report retained files.
		const retained: string[] = [];
		for (const name of new Set(created)) {
			try { await deleteUpload(name); } catch (cleanupError) { if (!(cleanupError instanceof AppError) || cleanupError.status !== 404) retained.push(name); }
		}
		const message = error instanceof Error ? error.message : 'بسته معتبر نیست؛ صفحه‌ای تغییر نکرد.';
		if (retained.length) return json({ ok: false, code: 'archive_rollback_retained', message: `${message} برخی دارایی‌های تازه به‌دلیل استفاده یا خطا نگه داشته شدند.`, retainedUploads: retained }, 409);
		if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message, ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }, error.status);
		if (error instanceof AppError) return json({ ok: false, code: 'invalid_archive_asset', message }, error.status);
		return json({ ok: false, code: 'invalid_archive', message }, 422);
	}
};
