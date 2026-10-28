import type { APIRoute } from 'astro';
import { createUser, listUsers } from '../../../../lib/cms/users';
import { asText, failure, json, readPayload, redirect } from '../../../../lib/cms/http';
import { isRole } from '../../../../lib/cms/rbac';

export const prerender = false;

export const GET: APIRoute = async () => {
	try {
		const users = await listUsers();
		return json({ ok: true, users });
	} catch (error) {
		return failure(error instanceof Error ? error.message : 'خواندن کاربران انجام نشد.', 500);
	}
};

export const POST: APIRoute = async ({ request }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	try {
		const payload = await readPayload(request);
		const username = asText(payload.username).trim();
		const password = asText(payload.password);
		const role = payload.role === undefined ? 'contributor' : payload.role;

		if (!username || !password) {
			return wantsJson
				? failure('نام کاربری و گذرواژه الزامی است.', 400)
				: redirect(`/cms/users?error=${encodeURIComponent('نام کاربری و گذرواژه الزامی است.')}`);
		}
		if (!isRole(role)) {
			return wantsJson
				? failure('نقش انتخاب‌شده معتبر نیست.', 400, 'role')
				: redirect(`/cms/users?error=${encodeURIComponent('نقش انتخاب‌شده معتبر نیست.')}`);
		}

		const user = await createUser({ username, password, role });
		return wantsJson
			? json({ ok: true, user: { id: user.id, username: user.username, role: user.role } }, 201)
			: redirect('/cms/users?flash=user-created');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'ایجاد کاربر انجام نشد.';
		return wantsJson
			? failure(message, 400)
			: redirect(`/cms/users?error=${encodeURIComponent(message)}`);
	}
};
