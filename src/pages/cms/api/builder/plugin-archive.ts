import { mediaRequestOrigins } from '../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { can } from '../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../lib/cms/http.ts';
import { AppError } from '../../../../lib/errors.ts';
import { deleteUpload, saveKitUpload } from '../../../../lib/cms/media.ts';
import { BuilderStoreError, installDeclarativePluginPackage } from '../../../../lib/builder/store.ts';
import { readBoundedRequestForm } from '../../../../lib/builder/request.ts';
import { inspectDeclarativePluginArchive, MAX_PLUGIN_ARCHIVE_BYTES } from '../../../../lib/builder/declarative-plugin-archive.ts';

export const prerender = false;

/** Re-inspect the ZIP on confirmed installation; never extract archive paths. */
export const POST: APIRoute = async ({ locals, request }) => {
	const role = locals.cmsUser?.role ?? 'subscriber';
	if (!can(role, 'cms.plugins:write')) return failure('اجازهٔ نصب بسته ندارید.', 403);
	const created: string[] = [];
	try {
		if (!(request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) return failure('درخواست باید فرم چندبخشی باشد.', 415);
		const form = await readBoundedRequestForm(request, MAX_PLUGIN_ARCHIVE_BYTES + 64 * 1024);
		if ([...form.keys()].some((key) => !['archive', 'action', 'confirm', 'expectedRevision'].includes(key)) || ['archive', 'action', 'confirm', 'expectedRevision'].some((key) => form.getAll(key).length > 1) || form.getAll('archive').length !== 1) return failure('فیلدهای فرم معتبر نیستند.', 400);
		const action = form.get('action') ?? 'inspect';
		const file = form.get('archive');
		if ((action !== 'inspect' && action !== 'install' && action !== 'update') || !(file instanceof File) || !file.size || file.size > MAX_PLUGIN_ARCHIVE_BYTES) return failure('فایل ZIP و عملیات معتبر لازم است.', 400);
		const inspected = await inspectDeclarativePluginArchive(new Uint8Array(await file.arrayBuffer()));
		if (action === 'inspect') return json({ ok: true, package: inspected.package, readme: inspected.readme, assetCount: inspected.assets.length });
		const revisionText = form.get('expectedRevision');
		const revision = typeof revisionText === 'string' && /^[1-9][0-9]*$/.test(revisionText) ? Number(revisionText) : undefined;
		if (form.get('confirm') !== 'true' || (action === 'update' && (!Number.isSafeInteger(revision) || !revision))) return failure('تأیید و نسخهٔ معتبر لازم است.', 400);
		if (inspected.assets.length && !can(role, 'cms.media:write')) return failure('برای نصب دارایی‌های بسته مجوز رسانه لازم است.', 403);
		for (const asset of inspected.assets) {
			const saved = await saveKitUpload(asset.file);
			if (!saved.reused) created.push(saved.name);
			if (asset.destination !== `media://uploads/${saved.name}`) throw new Error('شناسهٔ دارایی بسته مطابقت ندارد.');
		}
		const installed = await installDeclarativePluginPackage(inspected.package, action, revision, mediaRequestOrigins(request));
		return json({ ok: true, record: installed, uploaded: created.length, reused: inspected.assets.length - created.length, createdUploads: created }, action === 'install' ? 201 : 200);
	} catch (error) {
		const retained: string[] = [];
		for (const name of new Set(created)) {
			try { await deleteUpload(name); } catch (cleanupError) { if (!(cleanupError instanceof AppError) || cleanupError.status !== 404) retained.push(name); }
		}
		const message = error instanceof Error ? error.message : 'بسته معتبر نیست.';
		if (retained.length) return json({ ok: false, code: 'archive_rollback_retained', message: `${message} برخی دارایی‌های تازه به‌دلیل استفاده یا خطا نگه داشته شدند.`, retainedUploads: retained }, 409);
		if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message, ...(error.currentRevision ? { currentRevision: error.currentRevision } : {}) }, error.status);
		if (error instanceof AppError) return json({ ok: false, code: 'invalid_archive_asset', message }, error.status);
		return json({ ok: false, code: 'invalid_archive', message }, 422);
	}
};
