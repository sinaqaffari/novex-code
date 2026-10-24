/**
<<<<<<< HEAD
 * Panel authentication — a single administrator account, signed HMAC session
 * cookies, and a small in-memory brute-force brake.
 *
 * Credentials come from the environment:
 *   CMS_USERNAME       (default: admin)
 *   CMS_PASSWORD       (plain, convenient for local development)
 *   CMS_PASSWORD_HASH  (`scrypt:<saltHex>:<hashHex>`, preferred in production)
 *   CMS_SESSION_SECRET (signing key; a random one is generated per boot)
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
=======
 * احراز هویت پنل مدیریت — overeen با سیستم کاربر RBAC.
 *
 * Credentials از `data/users.json` می‌آیند (یک کاربر مدیر پیش‌فرض از محیط ساخته می‌شود).
 * نشست‌ها کوکی‌های امضاشده HMAC هستند، و سقف تلاش ناموفق بر اساس IP اعمال می‌شود.
 *
 * متغیرهای محیطی:
 *   CMS_USERNAME       (default: admin) — نام کاربری مدیر پیش‌فرض
 *   CMS_PASSWORD       (plain, local dev) — گذرواژهٔ مدیر پیش‌فرض
 *   CMS_PASSWORD_HASH  (`scrypt:<saltHex>:<hashHex>`, production)
 *   CMS_SESSION_SECRET (کلید امضا؛ در صورت عدم تنظیم، کلید موقت ساخته می‌شود)
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ensureDefaultAdmin, getUserByUsername, type User } from './users.ts';
>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)

export const SESSION_COOKIE = 'novex_cms_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // ۸ ساعت

const env = (key: string): string | undefined => {
	const value = process.env[key];
	return value && value.trim() !== '' ? value.trim() : undefined;
};

<<<<<<< HEAD
const ADMIN_USERNAME = env('CMS_USERNAME') ?? 'admin';
const ADMIN_PASSWORD = env('CMS_PASSWORD') ?? 'novex-admin';
const ADMIN_PASSWORD_HASH = env('CMS_PASSWORD_HASH');
const SESSION_SECRET = env('CMS_SESSION_SECRET') ?? randomBytes(32).toString('hex');

=======
const SESSION_SECRET = env('CMS_SESSION_SECRET') ?? randomBytes(32).toString('hex');

let adminBooted = false;

>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)
if (!env('CMS_SESSION_SECRET')) {
	console.warn(
		'[CMS] CMS_SESSION_SECRET تنظیم نشده است؛ کلید موقت ساخته شد و با هر بار راه‌اندازی، نشست‌ها باطل می‌شوند.',
	);
}
<<<<<<< HEAD
if (!env('CMS_PASSWORD') && !env('CMS_PASSWORD_HASH')) {
	console.warn(
		'[CMS] رمز پیش‌فرض فعال است (novex-admin). برای محیط عملیاتی CMS_PASSWORD یا CMS_PASSWORD_HASH را تنظیم کنید.',
	);
}
=======
>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)

export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const hash = scryptSync(password, salt, 64);
	return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function safeEqual(a: string, b: string): boolean {
	const bufferA = Buffer.from(a);
	const bufferB = Buffer.from(b);
	if (bufferA.length !== bufferB.length) return false;
	return timingSafeEqual(bufferA, bufferB);
}

<<<<<<< HEAD
function verifyPassword(password: string): boolean {
	if (ADMIN_PASSWORD_HASH) {
		const [scheme, saltHex, hashHex] = ADMIN_PASSWORD_HASH.split(':');
		if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
		const expected = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
		const actual = Buffer.from(hashHex, 'hex');
		return expected.length === actual.length && timingSafeEqual(expected, actual);
	}
	return safeEqual(password, ADMIN_PASSWORD);
}

=======
>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)
interface Attempt {
	count: number;
	lockedUntil: number;
}

const attempts = new Map<string, Attempt>();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

export function loginThrottleRemaining(ip: string): number {
	const record = attempts.get(ip);
	if (!record) return 0;
	return Math.max(0, record.lockedUntil - Date.now());
}

function registerFailure(ip: string): void {
	const record = attempts.get(ip) ?? { count: 0, lockedUntil: 0 };
	record.count += 1;
	if (record.count >= MAX_ATTEMPTS) {
		record.lockedUntil = Date.now() + LOCK_MS;
		record.count = 0;
	}
	attempts.set(ip, record);
}

export interface Credentials {
	username: string;
	password: string;
	ip: string;
}

<<<<<<< HEAD
export function verifyCredentials({ username, password, ip }: Credentials): {
	ok: boolean;
	message?: string;
} {
=======
export async function verifyCredentials({ username, password, ip }: Credentials): Promise<{
	ok: boolean;
	user?: User;
	message?: string;
}> {
>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)
	if (loginThrottleRemaining(ip) > 0) {
		return {
			ok: false,
			message: 'به دلیل تلاش‌های ناموفق، ورود موقتاً قفل شده است. چند دقیقه بعد دوباره امتحان کنید.',
		};
	}

<<<<<<< HEAD
	const usernameOk = safeEqual(username.trim().toLowerCase(), ADMIN_USERNAME.toLowerCase());
	const passwordOk = verifyPassword(password);

	if (!usernameOk || !passwordOk) {
=======
	// ادمین پیش‌فرض را از محیط بسازد (فقط یک بار در طول عمر پروسه).
	if (!adminBooted) {
		ensureDefaultAdmin().catch(() => undefined);
		adminBooted = true;
	}

	const user = await getUserByUsername(username);
	if (!user || !user.isActive) {
		registerFailure(ip);
		return { ok: false, message: 'نام کاربری یا گذرواژه نادرست است.' };
	}

	const passwordOk = verifyPassword(user.passwordHash, password);
	if (!passwordOk) {
>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)
		registerFailure(ip);
		return { ok: false, message: 'نام کاربری یا گذرواژه نادرست است.' };
	}

	attempts.delete(ip);
<<<<<<< HEAD
	return { ok: true };
=======
	return { ok: true, user };
}

/**
 * همیشه از طریق `users.verifyPassword` استفاده شود، نه مستقیماً از auth.
 * این توابع برای backward compatibility نگه داشته شده‌اند.
 */
export function verifyPassword(passwordHash: string, password: string): boolean {
	const [scheme, saltHex, hashHex] = passwordHash.split(':');
	if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
	const expected = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
	const actual = Buffer.from(hashHex, 'hex');
	return expected.length === actual.length && timingSafeEqual(expected, actual);
>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)
}

export interface SessionPayload {
	sub: string;
<<<<<<< HEAD
=======
	role?: string;
>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)
	iat: number;
	exp: number;
}

function sign(value: string): string {
	return createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

<<<<<<< HEAD
export function createSessionToken(username: string): { token: string; expiresAt: Date } {
=======
export function createSessionToken(
	username: string,
	role?: string,
): { token: string; expiresAt: Date } {
>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)
	const issuedAt = Date.now();
	const expiresAt = new Date(issuedAt + SESSION_TTL_MS);
	const payload: SessionPayload = {
		sub: username,
<<<<<<< HEAD
=======
		...(role ? { role } : {}),
>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)
		iat: issuedAt,
		exp: expiresAt.getTime(),
	};
	const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return { token: `${encoded}.${sign(encoded)}`, expiresAt };
}

export function readSessionToken(token: string | undefined): SessionPayload | null {
	if (!token) return null;
	const [encoded, signature] = token.split('.');
	if (!encoded || !signature) return null;
	if (!safeEqual(signature, sign(encoded))) return null;

	try {
		const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
		if (!payload?.sub || typeof payload.exp !== 'number') return null;
		if (payload.exp < Date.now()) return null;
		return payload;
	} catch {
		return null;
	}
}

const secureCookies = process.env.CMS_COOKIE_SECURE
	? process.env.CMS_COOKIE_SECURE === 'true'
	: process.env.NODE_ENV === 'production';

export const sessionCookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: secureCookies,
	maxAge: SESSION_TTL_MS / 1000,
};

export const clearedSessionCookieOptions = { ...sessionCookieOptions, maxAge: 0 };

<<<<<<< HEAD
export const ADMIN_NAME = ADMIN_USERNAME;
=======
export const ADMIN_NAME = env('CMS_USERNAME') ?? 'admin';
>>>>>>> eec85ad (بازنویسی UI پنل مدیریت — تمیز، راست‌به‌چپ، بدون زیربنای وردپرس)
