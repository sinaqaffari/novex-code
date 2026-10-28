import type { APIRoute, AstroCookies } from 'astro';
import { clearedSessionCookieOptions, SESSION_COOKIE } from '../../../lib/cms/auth';
import { json, redirect } from '../../../lib/cms/http';

export const prerender = false;

const signOut = (cookies: AstroCookies) => {
	cookies.delete(SESSION_COOKIE, { ...clearedSessionCookieOptions, path: '/' });
};

export const POST: APIRoute = async ({ cookies, request }) => {
	signOut(cookies);
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	return wantsJson
		? json({ ok: true, redirect: '/cms/login' })
		: redirect('/cms/login?flash=logged-out');
};

export const GET: APIRoute = async ({ cookies }) => {
	signOut(cookies);
	return redirect('/cms/login');
};
