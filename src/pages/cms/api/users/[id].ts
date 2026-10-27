import type { APIRoute } from 'astro';
import { deleteUser, getUser, updateUser, type UpdateUserInput } from '../../../../lib/cms/users';
import { asBoolean, asText, failure, json, readPayload, redirect } from '../../../../lib/cms/http';
import { isRole } from '../../../../lib/cms/rbac';

export const prerender = false;

const wantsJson = (request: Request) =>
	(request.headers.get('accept') ?? '').includes('application/json');

export const GET: APIRoute = async ({ params }) => {
	const id = asText(params.id);
	const user = await getUser(id);
	if (!user) return failure('کاربر پیدا نشد.', 404);
	return json({
		ok: true,
		user: {
			id: user.id,
			username: user.username,
			role: user.role,
			isActive: user.isActive,
			createdAt: user.createdAt,
			lastLoginAt: user.lastLoginAt,
		},
	});
};

const update: APIRoute = async ({ params, request }) => {
	const id = asText(params.id);
	try {
		const payload = await readPayload(request);
		const input: UpdateUserInput = {};
		if (payload.password !== undefined) input.password = asText(payload.password);
		if (payload.role !== undefined) {
			if (!isRole(payload.role)) {
				return wantsJson(request)
					? failure('نقش انتخاب‌شده معتبر نیست.', 400, 'role')
					: redirect(`/cms/users?error=${encodeURIComponent('نقش انتخاب‌شده معتبر نیست.')}`);
			}
			input.role = payload.role;
		}
		if (payload.isActive !== undefined) input.isActive = asBoolean(payload.isActive);

		const user = await updateUser(id, input);
		return wantsJson(request)
			? json({ ok: true, user: { id: user.id, username: user.username, role: user.role, isActive: user.isActive } })
			: redirect('/cms/users?flash=user-updated');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'به‌روزرسانی کاربر انجام نشد.';
		return wantsJson(request)
			? failure(message, 400)
			: redirect(`/cms/users?error=${encodeURIComponent(message)}`);
	}
};

const remove: APIRoute = async ({ params, request }) => {
	const id = asText(params.id);
	try {
		await deleteUser(id);
		return wantsJson(request) ? json({ ok: true }) : redirect('/cms/users?flash=user-deleted');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'حذف کاربر انجام نشد.';
		return wantsJson(request)
			? failure(message, 400)
			: redirect(`/cms/users?error=${encodeURIComponent(message)}`);
	}
};

export const PATCH: APIRoute = update;
export const DELETE: APIRoute = remove;

/** Native forms cannot submit PATCH/DELETE, so honor the existing _method field. */
export const POST: APIRoute = async (context) => {
	try {
		const payload = await readPayload(context.request.clone());
		const method = asText(payload._method).toUpperCase();
		if (method === 'PATCH') return update(context);
		if (method === 'DELETE') return remove(context);
		return failure('روش عملیات معتبر نیست.', 400);
	} catch {
		return failure('خواندن درخواست کاربر انجام نشد.', 400);
	}
};
