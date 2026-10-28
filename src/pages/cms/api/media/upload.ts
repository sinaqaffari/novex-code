import type { APIRoute } from 'astro';
import { failure, json, redirect } from '../../../../lib/cms/http';
import { builderMediaReferenceFromPublicUrl } from '../../../../lib/builder/media-reference';
import { can } from '../../../../lib/cms/rbac';
import { saveUpload, validateUploadFile } from '../../../../lib/cms/media';
import { CmsError } from '../../../../lib/cms/posts';

export const prerender = false;

const MAX_FILES = 5;
const MAX_BATCH_BYTES = 16 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export const POST: APIRoute = async ({ request, locals }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.media:write')) {
		return wantsJson ? failure('نقش شما اجازهٔ بارگذاری رسانه را ندارد.', 403, 'permission') : redirect('/cms/login?next=%2Fcms%2Fmedia');
	}
	const contentLength = Number(request.headers.get('content-length') ?? 0);
	if (contentLength > MAX_BATCH_BYTES + MULTIPART_OVERHEAD_BYTES) {
		return wantsJson ? failure('حجم مجموع بارگذاری نمی‌تواند بیشتر از ۱۶ مگابایت باشد.', 413, 'file') : redirect('/cms/media?error=payload-too-large');
	}

	try {
		const form = await request.formData();
		const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);
		const single = form.get('file');
		if (single instanceof File) files.push(single);
		if (!files.length) throw new CmsError('فایلی برای بارگذاری انتخاب نشده است.', 'file');
		if (files.length > MAX_FILES) throw new CmsError(`در هر بار حداکثر ${MAX_FILES} تصویر بارگذاری کنید.`, 'file', 413);
		const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
		if (totalBytes > MAX_BATCH_BYTES) throw new CmsError('حجم مجموع بارگذاری نمی‌تواند بیشتر از ۱۶ مگابایت باشد.', 'file', 413);

		// Validate the whole batch before writing any file, avoiding partial uploads on a bad item.
		for (const file of files) await validateUploadFile(file);
		const uploaded = [];
		for (const file of files) uploaded.push(await saveUpload(file));

		if (wantsJson) {
			return json({
				ok: true,
				files: uploaded.map(({ name, publicUrl, previewUrl, bytes, modifiedAt, builtin }) => ({
					name,
					assetRef: builderMediaReferenceFromPublicUrl(publicUrl),
					publicUrl,
					previewUrl,
					bytes,
					modifiedAt,
					builtin,
				})),
			});
		}
		return redirect('/cms/media?flash=uploaded');
	} catch (error) {
		const message = error instanceof CmsError ? error.message : 'بارگذاری فایل ناموفق بود.';
		const status = error instanceof CmsError ? error.status : 500;
		if (wantsJson) return failure(message, status, 'file');
		return redirect(`/cms/media?error=${encodeURIComponent(message)}`);
	}
};
