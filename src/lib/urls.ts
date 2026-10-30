/**
 * مبدأ عمومی سایت.
 *
 * آداپتور Node نشانی درخواست را برای امنیت به `localhost` تثبیت می‌کند
 * (`createRequestFromNodeRequest`)، پس `Astro.url.origin` پشت دامنهٔ واقعی یا
 * پروکسی پیش‌نمایش درست نیست. ترتیب اولویت:
 *
 * 1. `SITE_URL` — تنظیم صریح برای محیط عملیاتی
 * 2. `x-forwarded-host` / `Host` — همان میزبانی که مرورگر دیده است
 * 3. `localhost` — آخرین راه‌حل برای محیط توسعه
 */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** نخستین مقدار یک هدر که ممکن است فهرست‌شده باشد (`a, b`). */
function firstValue(request: Request, name: string): string | null {
	const raw = request.headers.get(name);
	if (!raw) return null;
	const value = raw.split(',')[0]?.trim().toLowerCase();
	return value ? value : null;
}

/** میزبان معتبر درخواست، بدون پروتکل. */
export function requestHost(request: Request): string | null {
	return firstValue(request, 'x-forwarded-host') ?? firstValue(request, 'host');
}

/** پروتکل عمومی؛ پروکسی معمولاً `x-forwarded-proto` را ست می‌کند. */
function requestProtocol(request: Request, host: string): string {
	const forwarded = firstValue(request, 'x-forwarded-proto');
	if (forwarded === 'http' || forwarded === 'https') return forwarded;
	return LOCAL_HOST.test(host) ? 'http' : 'https';
}

/** مبدأ کامل و بدون اسلش پایانی، مثل `https://novex.example`. */
export function publicOrigin(request: Request): string {
	const configured = process.env.SITE_URL?.trim();
	if (configured) return configured.replace(/\/+$/, '');

	const host = requestHost(request);
	if (!host) return 'http://localhost';

	return `${requestProtocol(request, host)}://${host}`;
}

/** Public and server-observed origins for recognizing same-site absolute media.
 * They only classify URLs; they are never used to make a network request. */
export function mediaRequestOrigins(request: Request): string[] {
	const host = requestHost(request);
	return [publicOrigin(request), new URL(request.url).origin, ...(host ? [`${requestProtocol(request, host)}://${host}`] : [])];
}

/** نشانی مطلق یک مسیر، برای canonical و og:url. */
export function absoluteUrl(request: Request, pathname: string): string {
	const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
	return `${publicOrigin(request)}${path}`;
}

/** Only publish well-formed HTTPS links supplied in editable site settings. */
export function safeExternalUrl(value: unknown): string | null {
	if (typeof value !== 'string' || !value.trim()) return null;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
		return url.href;
	} catch {
		return null;
	}
}
