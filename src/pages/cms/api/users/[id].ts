import type { APIRoute } from 'astro';
import {
	getUser,
	updateUser,
	deleteUser,
	type UpdateUserInput,
} from '../../../../lib/cms/users';
import { asText, json, failure, readPayload } from '../../../../lib/cms/http';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
	const id = asText(params.id);
	const user = await getUser(id);
	if (!user) return failure('کاربر پیدا نشد.', 404);
	return json({ ok: true, user: { id: user.id, username: user.username, role: user.role, isActive: user.isActive, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt } });
};

export const PATCH: APIRoute = async ({ params, request }) => {
	const id = asText(params.id);
	const payload = await readPayload(request);
	const input: UpdateUserInput = {};
	if (payload.password !== undefined) input.password = asText(payload.password);
	if (payload.role !== undefined) input.role = payload.role as 'admin' | 'editor' | 'contributor' | 'subscriber';
	if (payload.isActive !== undefined) input.isActive = payload.isActive === true || payload.isActive === 'true';

	try {
		const user = await updateUser(id, input);
		return json({ ok: true, user: { id: user.id, username: user.username, role: user.role, isActive: user.isActive } });
	} catch (error) {
		return failure(error instanceof Error ? error.message : 'به‌روزرسانی کاربر انجام نشد.', 400);
	}
};

export const DELETE: APIRoute = async ({ params }) => {
	const id = asText(params.id);
	try {
		await deleteUser(id);
		return json({ ok: true });
	} catch (error) {
		return failure(error instanceof Error ? error.message : 'حذف کاربر انجام نشد.', 400);
	}
};
