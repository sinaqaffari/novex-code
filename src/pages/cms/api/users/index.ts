import type { APIRoute } from 'astro';
import { listUsers, createUser } from '../../../../lib/cms/users';
import { asText, json, failure, readPayload } from '../../../../lib/cms/http';

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
	const payload = await readPayload(request);
	const username = asText(payload.username);
	const password = asText(payload.password);
	const role = (payload.role as 'admin' | 'editor' | 'contributor' | 'subscriber') ?? 'contributor';

	if (!username || !password) {
		return failure('نام کاربری و گذرواژه الزامی است.', 400);
	}

	try {
		const user = await createUser({ username, password, role });
		return json(
			{ ok: true, user: { id: user.id, username: user.username, role: user.role } },
			201,
		);
	} catch (error) {
		return failure(error instanceof Error ? error.message : 'ایجاد کاربر انجام نشد.', 400);
	}
};
