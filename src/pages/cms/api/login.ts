import type { APIRoute } from 'astro';
import {
	createSessionToken,
	SESSION_COOKIE,
	sessionCookieOptions,
	verifyCredentials,
} from '../../../lib/cms/auth';
import { asText, failure, json, readPayload, redirect } from '../../../lib/cms/http';

export const prerender = false;

function clientIp(request: Request, fallback?: string): string {
	const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
	return forwarded || fallback || 'local';
}

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
	const payload = await readPayload(request);
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');

	const username = asText(payload.username);
	const password = asText(payload.password);
	const next = asText(payload.next, '/cms');
	const safeNext = next.startsWith('/cms') ? next : '/cms';

	if (!username || !password) {
		const message = 'نام کاربری و گذرواژه را وارد کنید.';
		return wantsJson
			? failure(message, 400, 'password')
			: redirect(`/cms/login?error=${encodeURIComponent(message)}`);
	}

	let ip = 'local';
	try {
		ip = clientIp(request, clientAddress);
	} catch {
		ip = clientIp(request);
	}

	const result = await verifyCredentials({ username, password, ip });
	if (!result.ok) {
		const message = result.message ?? 'ورود ناموفق بود.';
		return wantsJson
			? failure(message, 401)
			: redirect(`/cms/login?error=${encodeURIComponent(message)}`);
	}

	const { token, expiresAt } = createSessionToken(username, result.user?.role);
	cookies.set(SESSION_COOKIE, token, sessionCookieOptions);

	return wantsJson
		? json({
				ok: true,
				redirect: safeNext,
				expiresAt: expiresAt.toISOString(),
				user: { username: result.user?.username, role: result.user?.role },
		  })
		: redirect(safeNext);
};
