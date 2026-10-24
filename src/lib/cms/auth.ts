/**
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

export const SESSION_COOKIE = 'novex_cms_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // ۸ ساعت

const env = (key: string): string | undefined => {
	const value = process.env[key];
	return value && value.trim() !== '' ? value.trim() : undefined;
};

const ADMIN_USERNAME = env('CMS_USERNAME') ?? 'admin';
const ADMIN_PASSWORD = env('CMS_PASSWORD') ?? 'novex-admin';
const ADMIN_PASSWORD_HASH = env('CMS_PASSWORD_HASH');
const SESSION_SECRET = env('CMS_SESSION_SECRET') ?? randomBytes(32).toString('hex');

if (!env('CMS_SESSION_SECRET')) {
	console.warn(
		'[CMS] CMS_SESSION_SECRET تنظیم نشده است؛ کلید موقت ساخته شد و با هر بار راه‌اندازی، نشست‌ها باطل می‌شوند.',
	);
}
if (!env('CMS_PASSWORD') && !env('CMS_PASSWORD_HASH')) {
	console.warn(
		'[CMS] رمز پیش‌فرض فعال است (novex-admin). برای محیط عملیاتی CMS_PASSWORD یا CMS_PASSWORD_HASH را تنظیم کنید.',
	);
}

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

export function verifyCredentials({ username, password, ip }: Credentials): {
	ok: boolean;
	message?: string;
} {
	if (loginThrottleRemaining(ip) > 0) {
		return {
			ok: false,
			message: 'به دلیل تلاش‌های ناموفق، ورود موقتاً قفل شده است. چند دقیقه بعد دوباره امتحان کنید.',
		};
	}

	const usernameOk = safeEqual(username.trim().toLowerCase(), ADMIN_USERNAME.toLowerCase());
	const passwordOk = verifyPassword(password);

	if (!usernameOk || !passwordOk) {
		registerFailure(ip);
		return { ok: false, message: 'نام کاربری یا گذرواژه نادرست است.' };
	}

	attempts.delete(ip);
	return { ok: true };
}

export interface SessionPayload {
	sub: string;
	iat: number;
	exp: number;
}

function sign(value: string): string {
	return createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

export function createSessionToken(username: string): { token: string; expiresAt: Date } {
	const issuedAt = Date.now();
	const expiresAt = new Date(issuedAt + SESSION_TTL_MS);
	const payload: SessionPayload = {
		sub: username,
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

export const ADMIN_NAME = ADMIN_USERNAME;
