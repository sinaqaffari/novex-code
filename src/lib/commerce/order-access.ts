import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeDigits } from './validation.ts';

interface AttemptWindow {
	count: number;
	startedAt: number;
	lockedUntil: number;
}

const attempts = new Map<string, AttemptWindow>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 10 * 60 * 1000;
export const ORDER_ACCESS_COOKIE = 'novex_order_access';
export const ORDER_ACCESS_TTL_SECONDS = 14 * 24 * 60 * 60;
const ORDER_ACCESS_TTL_MS = ORDER_ACCESS_TTL_SECONDS * 1000;
const ORDER_ACCESS_SECRET =
	process.env.NOVEX_ORDER_ACCESS_SECRET?.trim() ||
	process.env.CMS_SESSION_SECRET?.trim() ||
	randomBytes(32).toString('hex');

export const orderAccessCookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: process.env.CMS_COOKIE_SECURE
		? process.env.CMS_COOKIE_SECURE === 'true'
		: process.env.NODE_ENV === 'production',
	maxAge: ORDER_ACCESS_TTL_SECONDS,
};

export function normalizeOrderPhone(value: string): string {
	const normalized = normalizeDigits(value).trim();
	const digits = normalized.replace(/\D/g, '');
	return digits || normalized.toLocaleLowerCase();
}

function orderAccessSignature(orderNumber: string, phone: string, issuedAt: number): string {
	return createHmac('sha256', ORDER_ACCESS_SECRET)
		.update(`novex-order-access:v1\n${orderNumber}\n${normalizeOrderPhone(phone)}\n${issuedAt}`)
		.digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** Creates a time-limited, signed token; the customer phone is not stored in the cookie. */
export function createOrderAccessToken(orderNumber: string, phone: string, now = Date.now()): string {
	const number = orderNumber.trim().toUpperCase();
	if (!number || !normalizeOrderPhone(phone)) return '';
	const encodedNumber = Buffer.from(number).toString('base64url');
	return `v1.${now}.${encodedNumber}.${orderAccessSignature(number, phone, now)}`;
}

/** Verifies that a signed token belongs to this order and its currently registered phone. */
export function verifyOrderAccessToken(
	token: string | undefined,
	orderNumber: string,
	phone: string,
	now = Date.now(),
): boolean {
	if (!token || !orderNumber || !normalizeOrderPhone(phone)) return false;
	const [version, issuedAtValue, encodedNumber, signature, extra] = token.split('.');
	if (version !== 'v1' || !issuedAtValue || !encodedNumber || !signature || extra !== undefined) return false;

	const issuedAt = Number(issuedAtValue);
	if (!Number.isSafeInteger(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > ORDER_ACCESS_TTL_MS) return false;

	const decodedNumber = Buffer.from(encodedNumber, 'base64url').toString('utf8');
	const canonicalNumber = orderNumber.trim().toUpperCase();
	if (!decodedNumber || Buffer.from(decodedNumber).toString('base64url') !== encodedNumber || decodedNumber !== canonicalNumber) {
		return false;
	}

	return safeEqual(signature, orderAccessSignature(canonicalNumber, phone, issuedAt));
}

export function orderAccessRemaining(key: string, now = Date.now()): number {
	const entry = attempts.get(key);
	if (!entry) return 0;
	if (entry.lockedUntil > now) return entry.lockedUntil - now;
	if (now - entry.startedAt >= WINDOW_MS) {
		attempts.delete(key);
		return 0;
	}
	return 0;
}

export function recordOrderAccessFailure(key: string, now = Date.now()): number {
	const current = attempts.get(key);
	const entry = !current || now - current.startedAt >= WINDOW_MS
		? { count: 0, startedAt: now, lockedUntil: 0 }
		: current;
	entry.count += 1;
	if (entry.count >= MAX_ATTEMPTS) entry.lockedUntil = now + LOCK_MS;
	attempts.set(key, entry);

	if (attempts.size > 4096) {
		for (const [candidate, value] of attempts) {
			if (value.lockedUntil <= now && now - value.startedAt >= WINDOW_MS) attempts.delete(candidate);
		}
	}

	return Math.max(0, entry.lockedUntil - now);
}

export function clearOrderAccessFailures(key: string): void {
	attempts.delete(key);
}
