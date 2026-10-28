/** The SMS adapter rejects invalid inputs before attempting a paid provider request. */

import assert from 'node:assert/strict';
import { it } from 'node:test';
import { pages, sendOtp, sendSms } from '../plugins/kaveh-neg-sms/index.ts';
import type { PluginApi } from '../src/lib/plugins/types.ts';

it('does not call the provider for invalid recipients or an unset OTP template', async () => {
	const originalFetch = globalThis.fetch;
	let providerCalls = 0;
	globalThis.fetch = (async () => {
		providerCalls += 1;
		throw new Error('Unexpected provider request');
	}) as typeof fetch;

	const api = {
		id: 'kaveh-neg-sms',
		getSecret: () => 'test-key',
		getOption: (_key: string, fallback: unknown) => fallback,
	} as unknown as PluginApi;

	try {
		const sms = await sendSms(api, 'not-a-phone', 'متن آزمون');
		const otp = await sendOtp(api, '09123456789', '123456', 'sms');

		assert.equal(sms.ok, false);
		assert.match(sms.message ?? '', /شمارهٔ گیرنده/);
		assert.equal(otp.ok, false);
		assert.match(otp.message ?? '', /نام قالب/);
		assert.equal(providerCalls, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

it('explains in the CMS panel that activation does not send SMS automatically', async () => {
	const api = {
		id: 'kaveh-neg-sms',
		getSecret: () => undefined,
		getOption: (_key: string, fallback: unknown) => fallback,
		hasSecret: () => false,
	} as unknown as PluginApi;

	const html = await pages.settings(api);
	assert.match(html, /هیچ پیامکی نمی‌فرستد/);
	assert.match(html, /گردش‌کار خرید/);
	assert.match(html, /نام قالب Verify Lookup/);
	assert.doesNotMatch(html, /NVX-[A-Z0-9-]+|30005000000000/);
});
