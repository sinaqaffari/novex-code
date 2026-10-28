import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
	clearOrderAccessFailures,
	createOrderAccessToken,
	normalizeOrderPhone,
	orderAccessRemaining,
	recordOrderAccessFailure,
	verifyOrderAccessToken,
} from '../src/lib/commerce/order-access.ts';

afterEach(() => {
	clearOrderAccessFailures('192.0.2.1');
	clearOrderAccessFailures('192.0.2.2');
});

describe('order lookup access', () => {
	it('normalizes Persian and Arabic digits before comparing phone numbers', () => {
		assert.equal(normalizeOrderPhone('۰۹۱۲-۳۴۵ ۶۷۸۹'), '09123456789');
		assert.equal(normalizeOrderPhone('٠٩١٢٣٤٥٦٧٨٩'), '09123456789');
	});

	it('issues a signed, expiring order token without placing the phone in the cookie', () => {
		const issuedAt = 3_000_000;
		const phone = '۰۹۱۲-۳۴۵ ۶۷۸۹';
		const token = createOrderAccessToken('NVX-1032', phone, issuedAt);

		assert.ok(token);
		assert.equal(token.includes('09123456789'), false);
		assert.equal(verifyOrderAccessToken(token, 'NVX-1032', '09123456789', issuedAt), true);
		assert.equal(verifyOrderAccessToken(token, 'NVX-1033', phone, issuedAt), false);
		assert.equal(verifyOrderAccessToken(token, 'NVX-1032', '09120000000', issuedAt), false);
		assert.equal(verifyOrderAccessToken(`${token}x`, 'NVX-1032', phone, issuedAt), false);
		assert.equal(verifyOrderAccessToken(token, 'NVX-1032', phone, issuedAt + 14 * 24 * 60 * 60 * 1000 + 1), false);
		assert.equal(verifyOrderAccessToken(token, 'NVX-1032', phone, issuedAt - 60_001), false);
	});

	it('temporarily blocks repeated failed lookups per client', () => {
		const now = 1_000_000;
		for (let attempt = 1; attempt < 5; attempt += 1) {
			assert.equal(recordOrderAccessFailure('192.0.2.1', now), 0);
		}

		assert.equal(recordOrderAccessFailure('192.0.2.1', now), 10 * 60 * 1000);
		assert.equal(orderAccessRemaining('192.0.2.1', now + 1), 10 * 60 * 1000 - 1);
		assert.equal(orderAccessRemaining('192.0.2.2', now + 1), 0);
	});

	it('allows lookup attempts again after the lock expires', () => {
		const now = 2_000_000;
		for (let attempt = 0; attempt < 5; attempt += 1) recordOrderAccessFailure('192.0.2.1', now);
		assert.equal(orderAccessRemaining('192.0.2.1', now + 10 * 60 * 1000), 0);
		assert.equal(recordOrderAccessFailure('192.0.2.1', now + 10 * 60 * 1000 + 1), 0);
	});

	it('clears failures after a valid lookup', () => {
		recordOrderAccessFailure('192.0.2.1');
		clearOrderAccessFailures('192.0.2.1');
		assert.equal(orderAccessRemaining('192.0.2.1'), 0);
	});
});
