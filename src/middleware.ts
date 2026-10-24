import { defineMiddleware } from 'astro:middleware';
import { readSessionToken, SESSION_COOKIE } from './lib/cms/auth';
import { json } from './lib/cms/http';

const LOGIN_PATH = '/cms/login';

/** Everything under /cms is private — pages, JSON endpoints and media files. */
export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname, search } = context.url;

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
