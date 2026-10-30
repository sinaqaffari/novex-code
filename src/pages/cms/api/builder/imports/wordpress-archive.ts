import { mediaRequestOrigins } from '../../../../../lib/urls.ts';
import type { APIRoute } from 'astro';
import { can } from '../../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { AppError } from '../../../../../lib/errors.ts';
import { deleteUpload, saveKitUpload } from '../../../../../lib/cms/media.ts';
import { postUploadReferences } from '../../../../../lib/cms/blog-media.ts';
import { createDraftPostBatch } from '../../../../../lib/cms/posts.ts';
import { parseBuilderMediaReference } from '../../../../../lib/builder/media-reference.ts';
import { BuilderStoreError, installDraftPages } from '../../../../../lib/builder/store.ts';
import { readBoundedRequestForm } from '../../../../../lib/builder/request.ts';
import { createEmptyPageDocument } from '../../../../../lib/builder/document.ts';
import { inspectWordPressArchive, MAX_WORDPRESS_ARCHIVE_BYTES, type WordPressArchiveInspection } from '../../../../../lib/migrations/wordpress/archive.ts';
import { convertWxrItem, wxrToDraftPages } from '../../../../../lib/migrations/wordpress/wxr.ts';
import { wxrPostToBlogDraft, wxrToBlogDrafts, type WxrBlogDraft } from '../../../../../lib/migrations/wordpress/blog-post.ts';

export const prerender = false;

function assetsForPosts(archive: WordPressArchiveInspection, drafts: WxrBlogDraft[]) {
	const names = new Set(drafts.flatMap((draft) => [...postUploadReferences('', draft.body)]));
	const assets = new Map<string, WordPressArchiveInspection['assets'][number]>();
	for (const asset of archive.assets) {
		const reference = parseBuilderMediaReference(asset.destination);
		if (reference?.bucket === 'uploads' && names.has(reference.name)) assets.set(asset.destination, asset);
	}
	return [...assets.values()];
}

/** Review or install local WXR and its raster media. No source-site requests occur. */
export const POST: APIRoute = async ({ locals, request }) => {
	const role = locals.cmsUser?.role ?? 'subscriber';
	if (!can(role, 'cms.pages:write')) return failure('اجازهٔ ویرایش صفحه ندارید.', 403);
	const created: string[] = [];
	try {
		if (!(request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) return failure('درخواست باید فرم چندبخشی باشد.', 415);
		const form = await readBoundedRequestForm(request, MAX_WORDPRESS_ARCHIVE_BYTES + 64 * 1024);
		const allowed = ['action', 'archive', 'prefix', 'preferElementor', 'confirm'];
		if ([...form.keys()].some((key) => !allowed.includes(key)) || allowed.some((key) => form.getAll(key).length > 1)) return failure('فیلدهای فرم معتبر نیستند.', 400);
		const action = form.get('action'); const file = form.get('archive');
		if ((action !== 'inspect' && action !== 'install' && action !== 'install-posts') || !(file instanceof File) || !file.size || file.size > MAX_WORDPRESS_ARCHIVE_BYTES) return failure('فایل ZIP و عملیات معتبر لازم است.', 400);
		const archive = await inspectWordPressArchive(new Uint8Array(await file.arrayBuffer()));
		if (action === 'inspect') {
			const postDrafts: WxrBlogDraft[] = [];
			const items = archive.inspection.items.map((item) => {
				let elementorWarnings: string[] = []; let elementorError = '';
				let htmlWarnings: string[] = [];
				try { htmlWarnings = convertWxrItem(item, createEmptyPageDocument('wxr-archive-preview'), false, archive.mediaMap).warnings.map((warning) => `${warning.sourceId}: ${warning.message}`); }
				catch (error) { htmlWarnings = [error instanceof Error ? error.message : 'تبدیل HTML ممکن نشد.']; }
				if (item.elementorData) {
					try { elementorWarnings = convertWxrItem(item, createEmptyPageDocument('wxr-archive-preview'), true, archive.mediaMap).warnings.map((warning) => `${warning.sourceId}: ${warning.message}`); }
					catch (error) { elementorError = error instanceof Error ? error.message : 'تبدیل Elementor ممکن نشد.'; }
				}
				let blogWarnings: string[] = []; let blogError = '';
				if (item.type === 'post') {
					try { const draft = wxrPostToBlogDraft(item, archive.mediaMap); postDrafts.push(draft); blogWarnings = draft.warnings; }
					catch (error) { blogError = error instanceof Error ? error.message : 'تبدیل نوشته ممکن نشد.'; }
				}
				return { title: item.title, type: item.type, warnings: [...item.warnings, ...htmlWarnings], hasElementor: Boolean(item.elementorData), elementorWarnings, elementorError, blogWarnings, blogError };
			});
			return json({ ok: true, summary: { version: archive.inspection.version, items, ignored: archive.inspection.ignored, assetCount: archive.assets.length, postAssetCount: assetsForPosts(archive, postDrafts).length, matchedAttachments: archive.matchedAttachments, unmatchedAttachments: archive.unmatchedAttachments } });
		}
		if (form.get('confirm') !== 'true' || typeof form.get('prefix') !== 'string' || !['true', 'false'].includes(String(form.get('preferElementor')))) return failure('پیشوند، شیوهٔ تبدیل و تأیید صریح لازم است.', 400);
		if (action === 'install-posts') {
			if (!can(role, 'cms.posts:write')) return failure('اجازهٔ ساخت نوشته ندارید.', 403);
			if (form.get('preferElementor') !== 'false') return failure('ورود نوشته از HTML وردپرس انجام می‌شود، نه طرح Elementor.', 400);
			const drafts = wxrToBlogDrafts(archive.inspection, String(form.get('prefix')), archive.mediaMap);
			const assets = assetsForPosts(archive, drafts);
			if (assets.length && !can(role, 'cms.media:write')) return failure('برای ورود تصویرهای نوشته مجوز بارگذاری رسانه لازم است.', 403);
			for (const asset of assets) {
				const saved = await saveKitUpload(asset.file);
				if (!saved.reused) created.push(saved.name);
				if (asset.destination !== `media://uploads/${saved.name}`) throw new Error('شناسهٔ رسانهٔ بسته مطابقت ندارد.');
			}
			const ids = await createDraftPostBatch(drafts.map(({ warnings: _warnings, ...draft }) => draft), { origins: mediaRequestOrigins(request) });
			return json({ ok: true, posts: ids.map((id) => ({ id })), uploaded: created.length, reused: assets.length - created.length, createdUploads: created }, 201);
		}
		if (archive.assets.length && !can(role, 'cms.media:write')) return failure('برای ورود تصویرها مجوز بارگذاری رسانه لازم است.', 403);
		const documents = wxrToDraftPages(archive.inspection, String(form.get('prefix')), form.get('preferElementor') === 'true', archive.mediaMap);
		for (const asset of archive.assets) {
			const saved = await saveKitUpload(asset.file);
			if (!saved.reused) created.push(saved.name);
			if (asset.destination !== `media://uploads/${saved.name}`) throw new Error('شناسهٔ رسانهٔ بسته مطابقت ندارد.');
		}
		const pages = await installDraftPages(documents, undefined, { requireAssets: true, origins: mediaRequestOrigins(request) });
		return json({ ok: true, pages: pages.map(({ slug, revision }) => ({ slug, revision })), uploaded: created.length, reused: archive.assets.length - created.length, createdUploads: created }, 201);
	} catch (error) {
		const retained: string[] = [];
		for (const name of new Set(created)) {
			try { await deleteUpload(name); } catch (cleanupError) { if (!(cleanupError instanceof AppError) || cleanupError.status !== 404) retained.push(name); }
		}
		const message = error instanceof Error ? error.message : 'بستهٔ وردپرس معتبر نیست.';
		if (retained.length) return json({ ok: false, code: 'archive_rollback_retained', message: `${message} برخی رسانه‌های تازه به‌دلیل استفاده یا خطا نگه داشته شدند.`, retainedUploads: retained }, 409);
		if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message }, error.status);
		if (error instanceof AppError) return json({ ok: false, code: 'invalid_archive_asset', message }, error.status);
		return json({ ok: false, code: 'invalid_archive', message }, 422);
	}
};
