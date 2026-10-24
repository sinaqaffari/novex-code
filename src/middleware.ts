import { defineMiddleware } from 'astro:middleware';
import { readSessionToken, SESSION_COOKIE } from './lib/cms/auth';
import { json } from './lib/cms/http';
import { ensurePluginsBooted } from './lib/plugins/registry';
import type { Permission } from './lib/cms/rbac';

const LOGIN_PATH = '/cms/login';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * مسیرهایی که نیاز به مجوز خاص دارند — فقط برای متغیرهای غیر Get.
 * کلید: پیش‌وند مسیر، مقدار: مجوز مورد نیاز.
 */
const PATH_PERMISSIONS: Array<{ prefix: string; permission: Permission }> = [
	{ prefix: '/cms/users', permission: 'cms.users:write' },
	{ prefix: '/cms/api/users', permission: 'cms.users:write' },
	{ prefix: '/cms/plugins', permission: 'cms.plugins:write' },
	{ prefix: '/cms/api/plugins', permission: 'cms.plugins:write' },
	{ prefix: '/cms/settings', permission: 'cms.settings:write' },
	{ prefix: '/cms/api/settings', permission: 'cms.settings:write' },
	{ prefix: '/cms/posts', permission: 'cms.posts:write' },
	{ prefix: '/cms/api/posts', permission: 'cms.posts:write' },
	{ prefix: '/cms/products', permission: 'commerce.products:write' },
	{ prefix: '/cms/api/products', permission: 'commerce.products:write' },
	{ prefix: '/cms/orders', permission: 'commerce.orders:write' },
	{ prefix: '/cms/api/orders', permission: 'commerce.orders:write' },
];

/**
 * نگهبان CSRF.
 *
 * محافظ داخلی آسترو (`security.checkOrigin`) نشانی درخواست را با مبدأ تثبیت‌شدهٔ
 * `localhost` می‌سنجد، پس پشت دامنهٔ واقعی یا پروکسی پیش‌نمایش همهٔ فرم‌ها را رد
 * می‌کند؛ به همین دلیل خاموش شده و همین قاعده با میزبان واقعی درخواست اجرا می‌شود.
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

/** هر چیز زیر `/cms` خصوصی است — صفحات، endpointهای JSON و فایل‌های رسانه‌ای. */
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
	context.locals.cmsUser = session
		? { username: session.sub, role: (session.role ?? 'subscriber') as import('./lib/cms/rbac').Role }
		: null;

	const isLoginPage = pathname === LOGIN_PATH;
	const isLoginEndpoint = pathname === '/cms/api/login';

	if (!session && !isLoginPage && !isLoginEndpoint) {
		if (pathname.startsWith('/cms/api/') || pathname.startsWith('/cms/media/file/')) {
			return json({ ok: false, message: 'نشست شما منقضی شده است. دوباره وارد شوید.' }, 401);
		}
		const nextUrl = encodeURIComponent(`${pathname}${search}`);
		return context.redirect(`${LOGIN_PATH}?next=${nextUrl}`);
	}

	if (session && isLoginPage) return context.redirect('/cms');

	// بررسی مجوز RBAC برای مسیرهای حساس (فقط متغیرهای غیر خواندنی)
	if (session && !SAFE_METHODS.has(context.request.method.toUpperCase())) {
		const required = PATH_PERMISSIONS.find((p) => pathname.startsWith(p.prefix))?.permission;
		if (required) {
			const userRole = session.role as import('./lib/cms/rbac').Role;
			const { can } = await import('./lib/cms/rbac');
			if (!can(userRole, required)) {
				return json(
					{ ok: false, message: 'دسترسی به این بخش برای نقش شما مجاز نیست.' },
					403,
				);
			}
		}
	}

	const response = await next();

	// هرگز پاسخ CMS را در کش اشتراکی نگه‌دار.
	response.headers.set('cache-control', 'no-store, must-revalidate');
	response.headers.set('x-robots-tag', 'noindex, nofollow');
	return response;
});
