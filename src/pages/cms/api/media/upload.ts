import type { APIRoute } from 'astro';
import { failure, json, redirect } from '../../../../lib/cms/http';
import { saveUpload } from '../../../../lib/cms/media';
import { CmsError } from '../../../../lib/cms/posts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');

	try {
		const form = await request.formData();
		const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);
		const single = form.get('file');

		if (single instanceof File) files.push(single);
		if (!files.length) throw new CmsError('فایلی برای بارگذاری انتخاب نشده است.', 'file');

		const uploaded = [];
		for (const file of files) uploaded.push(await saveUpload(file));

		if (wantsJson) return json({ ok: true, files: uploaded });
		return redirect('/cms/media?flash=uploaded');
	} catch (error) {
		const message = error instanceof CmsError ? error.message : 'بارگذاری فایل ناموفق بود.';
		const status = error instanceof CmsError ? error.status : 500;
		if (wantsJson) return failure(message, status, 'file');
		return redirect(`/cms/media?error=${encodeURIComponent(message)}`);
	}
};
