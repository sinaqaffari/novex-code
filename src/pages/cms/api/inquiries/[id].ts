import type { APIRoute } from 'astro';
import { BackendError, deleteInquiry, updateInquiry, type InquiryStatus } from '../../../../lib/backend/inquiries.ts';
import { failure, json, readPayload, redirect } from '../../../../lib/cms/http.ts';
import { can } from '../../../../lib/cms/rbac.ts';

export const prerender = false;
export const POST: APIRoute = async ({ request, params, url, locals }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	try {
		const deleting = url.searchParams.get('action') === 'delete';
		if (!can(locals.cmsUser?.role ?? 'subscriber', deleting ? 'cms.inquiries:delete' : 'cms.inquiries:write')) return failure('دسترسی به درخواست‌ها مجاز نیست.', 403);
		const payload = await readPayload(request);
		if (deleting) {
			if (payload.confirm !== 'delete') throw new BackendError('confirmation_required', 400);
			await deleteInquiry(params.id ?? '');
			return wantsJson ? json({ ok: true }) : redirect('/cms/inquiries?flash=deleted');
		}
		const status = typeof payload.status === 'string' && ['new', 'read', 'archived'].includes(payload.status) ? payload.status as InquiryStatus : null;
		if (!status) throw new BackendError('invalid_status', 400);
		await updateInquiry(params.id ?? '', status);
		return wantsJson ? json({ ok: true }) : redirect('/cms/inquiries?flash=status-updated');
	} catch (error) {
		const status = error instanceof BackendError ? error.status : 503;
		const message = status === 404 ? 'درخواست پیدا نشد.' : status === 400 || status === 422 ? 'وضعیت درخواست معتبر نیست.' : 'به‌روزرسانی درخواست ممکن نشد؛ سرویس را بررسی کنید.';
		return wantsJson ? failure(message, status) : redirect(`/cms/inquiries?error=${encodeURIComponent(message)}`);
	}
};
