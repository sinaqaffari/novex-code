import type { APIRoute } from 'astro';
import { failure, json, redirect } from '../../../../lib/cms/http';
import { can } from '../../../../lib/cms/rbac';
import { deleteUpload } from '../../../../lib/cms/media';
import { CmsError } from '../../../../lib/cms/posts';

export const prerender = false;

export const DELETE: APIRoute = async ({ request, params, locals }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.media:delete')) {
		return wantsJson ? failure('نقش شما اجازهٔ حذف رسانه را ندارد.', 403, 'permission') : redirect('/cms/login?next=%2Fcms%2Fmedia');
	}
	try {
		await deleteUpload(params.name ?? '');
		return wantsJson
			? json({ ok: true, redirect: '/cms/media?flash=media-deleted' })
			: redirect('/cms/media?flash=media-deleted');
	} catch (error) {
		const message = error instanceof CmsError ? error.message : 'حذف فایل ناموفق بود.';
		const status = error instanceof CmsError ? error.status : 500;
		return wantsJson
			? failure(message, status, 'file')
			: redirect(`/cms/media?error=${encodeURIComponent(message)}`);
	}
};

export const POST: APIRoute = async (context) => DELETE(context);
