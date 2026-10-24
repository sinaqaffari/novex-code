import { defineMiddleware } from 'astro:middleware';
import { readSessionToken, SESSION_COOKIE } from './lib/cms/auth';
import { json } from './lib/cms/http';
import { ensurePluginsBooted } from './lib/plugins/registry';

const LOGIN_PATH = '/cms/login';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * نگهبان CSRF.
 *
 * محافظ داخلی آسترو (`security.checkOrigin`) نشانی درخواست را با مبدأ تثبیت‌شدهٔ
 * `localhost` می‌سنجد، پس پشت دامنهٔ واقعی یا پروکسی پیش‌نمایش همهٔ فرم‌ها را رد
 * می‌کند؛ به همین دلیل خاموش شده و همان قاعده اینجا با میزبان واقعی درخواست
 * (`Host` / `x-forwarded-host`) اجرا می‌شود.
 */
function isCrossSiteSubmission(request: Request): boolean {
	if (SAFE_METHODS.has(request.method.toUpperCase())) return false;

	const fetchSite = request.headers.get('sec-fetch-site');
	if (fetchSite === 'cross-site') return true;

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

/** Everything under /cms is private — pages, JSON endpoints and media files. */
export const onRequest = defineMiddleware(async (context, next) => {
	// افزونه‌ها یک بار در هر پروسه ثبت می‌شوند تا قلاب‌ها در همهٔ مسیرها فعال باشند.
	await ensurePluginsBooted();

	const { pathname, search } = context.url;

	// استاندارد امنیتی: هر درخواست تغییردهنده باید از همین مبدأ باشد.
	if (isCrossSiteSubmission(context.request)) {
		return json({ ok: false, message: 'درخواست از مبدأ نامعتبر رد شد.' }, 403);
	}

	if (!pathname.startsWith('/cms')) return next();

	const session = readSessionToken(context.cookies.get(SESSION_COOKIE)?.value);
	context.locals.cmsSession = session;

	const isLoginPage = pathname === LOGIN_PATH;
	const isLoginEndpoint = pathname === '/cms/api/login';

	if (!session && !isLoginPage && !isLoginEndpoint) {
		if (pathname.startsWith('/cms/api/') || pathname.startsWith('/cms/media/file/')) {
			return json({ ok: false, message: 'نشست شما منقضی شده است. دوباره وارد شوید.' }, 401);
		}
		const next = encodeURIComponent(`${pathname}${search}`);
		return context.redirect(`${LOGIN_PATH}?next=${next}`);
	}

	if (session && isLoginPage) return context.redirect('/cms');

	const response = await next();

	// Never let a CMS response linger in a shared cache.
	response.headers.set('cache-control', 'no-store, must-revalidate');
	response.headers.set('x-robots-tag', 'noindex, nofollow');
	return response;
});
