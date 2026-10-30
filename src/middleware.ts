import { defineMiddleware } from 'astro:middleware';
import { readSessionToken, SESSION_COOKIE } from './lib/cms/auth';
import { json } from './lib/cms/http';
import { ensurePluginsBooted } from './lib/plugins/registry';
import { can } from './lib/cms/rbac';
import { cmsLandingPage, requiredCmsPermission } from './lib/cms/access';
import { getUserByUsername } from './lib/cms/users';

const LOGIN_PATH = '/cms/login';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard: compare the browser Origin with the trusted request host. The
 * Astro adapter pins URL.host to localhost behind proxies, so use forwarded host.
 */
function isCrossSiteSubmission(request: Request): boolean {
	if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
	if (request.headers.get('sec-fetch-site') === 'cross-site') return true;

	const origin = request.headers.get('origin');
	if (!origin) return false;
	const rawHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
	const host = rawHost?.split(',')[0]?.trim().toLowerCase();
	if (!host) return false;

	try {
		return new URL(origin).host.toLowerCase() !== host;
	} catch {
		return true;
	}
}

function noStore(response: Response): Response {
	response.headers.set('cache-control', 'no-store, must-revalidate');
	response.headers.set('x-robots-tag', 'noindex, nofollow');
	return response;
}

/** Every /cms page and API is private; route-specific permissions are checked here. */
export const onRequest = defineMiddleware(async (context, next) => {
	// Remove the legacy cookie that stored a customer's raw phone number.
	if (context.cookies.has('novex_last_order')) context.cookies.delete('novex_last_order', { path: '/' });

	await ensurePluginsBooted();

	const { pathname, search } = context.url;
	if (isCrossSiteSubmission(context.request)) {
		return noStore(json({ ok: false, message: 'درخواست از مبدأ نامعتبر رد شد.' }, 403));
	}

	if (!pathname.startsWith('/cms')) return next();

	let session = readSessionToken(context.cookies.get(SESSION_COOKIE)?.value);
	let user: Awaited<ReturnType<typeof getUserByUsername>> = null;
	if (session) {
		try {
			user = await getUserByUsername(session.sub);
		} catch {
			context.locals.cmsSession = null;
			context.locals.cmsUser = null;
			return noStore(json({ ok: false, message: 'خواندن حساب کاربری ممکن نشد.' }, 503));
		}
		if (!user?.isActive) session = null;
	}
	if (!session && context.cookies.has(SESSION_COOKIE)) {
		context.cookies.delete(SESSION_COOKIE, { path: '/' });
	}
	context.locals.cmsSession = session;
	context.locals.cmsUser = session && user ? { username: user.username, role: user.role } : null;

	const isLoginPage = pathname === LOGIN_PATH;
	const isLoginEndpoint = pathname === '/cms/api/login';

	if (!session && !isLoginPage && !isLoginEndpoint) {
		if (pathname.startsWith('/cms/api/') || pathname.startsWith('/cms/media/file/')) {
			return noStore(json({ ok: false, message: 'نشست شما منقضی شده است. دوباره وارد شوید.' }, 401));
		}
		const nextUrl = encodeURIComponent(`${pathname}${search}`);
		return noStore(context.redirect(`${LOGIN_PATH}?next=${nextUrl}`));
	}

	if (session && isLoginPage) {
		const role = context.locals.cmsUser?.role ?? 'subscriber';
		return noStore(context.redirect(cmsLandingPage(role)));
	}

	if (session) {
		const role = context.locals.cmsUser?.role ?? 'subscriber';
		const required = requiredCmsPermission({
			pathname,
			method: context.request.method,
			action: context.url.searchParams.get('action'),
		});
		if (required && !can(role, required)) {
			return noStore(json({ ok: false, message: 'دسترسی به این بخش برای نقش شما مجاز نیست.' }, 403));
		}
	}

	const response = await next();
	return pathname.startsWith('/cms') ? noStore(response) : response;
});
