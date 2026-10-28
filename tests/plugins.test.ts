/** Focused plugin manifest, capability, hook, setting and persisted-state contracts. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	compareSemVer,
	isPluginApiRoutePath,
	isSemVer,
	parsePluginSettingValue,
	readonlySetView,
	validateHookRegistration,
	validatePluginManifest,
} from '../src/lib/plugins/validation.ts';
import { parsePluginStateContent, validatePluginState } from '../src/lib/plugins/store.ts';
import { hasPluginSecret, pluginSecretEnvironmentName, readPluginSecret } from '../src/lib/plugins/secrets.ts';
import { createLazyModuleCache } from '../src/lib/plugins/lazy-module.ts';
import { addAction, addFilter, applyFilters, doAction, removePluginHooks } from '../src/lib/plugins/hooks.ts';
import type { PluginManifest, PluginSetting } from '../src/lib/plugins/types.ts';

const plugins = ['content-audit', 'kaveh-neg-sms', 'persian-tools', 'seo-meta', 'zarinpal-gateway'];

describe('Plugin manifest contract', () => {
	for (const id of plugins) {
		it(`accepts the ${id} manifest against API v1`, () => {
			const raw = JSON.parse(readFileSync(join(process.cwd(), 'plugins', id, 'plugin.json'), 'utf8'));
			assert.deepEqual(validatePluginManifest(raw, id), []);
		});
	}

	it('rejects folder-id mismatch, unknown API versions, capabilities, and undeclared payment access', () => {
		const raw = JSON.parse(readFileSync(join(process.cwd(), 'plugins/zarinpal-gateway/plugin.json'), 'utf8'));
		assert.ok(validatePluginManifest({ ...raw, id: 'another-id' }, 'zarinpal-gateway').some((issue) => issue.includes('id')));
		assert.ok(validatePluginManifest({ ...raw, apiVersion: 99 }, 'zarinpal-gateway').some((issue) => issue.includes('apiVersion')));
		assert.ok(validatePluginManifest({ ...raw, capabilities: ['root:access'] }, 'zarinpal-gateway').some((issue) => issue.includes('ناشناخته')));
		assert.ok(validatePluginManifest({ ...raw, capabilities: ['cms:widgets', 'options:read', 'options:write', 'admin:page'] }, 'zarinpal-gateway').some((issue) => issue.includes('commerce:payments')));
	});

	it('validates declared CMS and public routes with least-privilege capabilities', () => {
		const raw = JSON.parse(readFileSync(join(process.cwd(), 'plugins/content-audit/plugin.json'), 'utf8'));
		assert.deepEqual(validatePluginManifest(raw, 'content-audit'), []);

		const publicRoute = {
			...raw,
			capabilities: [...raw.capabilities, 'api:public'],
			routes: [...raw.routes, { path: 'feed/articles', access: 'public', methods: ['GET'] }],
		};
		assert.deepEqual(validatePluginManifest(publicRoute, 'content-audit'), []);
		assert.ok(validatePluginManifest({
			...publicRoute,
			capabilities: publicRoute.capabilities.filter((capability: string) => capability !== 'api:public'),
		}, 'content-audit').some((issue) => issue.includes('api:public')));
		assert.ok(validatePluginManifest({
			...raw,
			routes: [{ path: 'audit', access: 'cms', methods: ['DELETE'] }],
		}, 'content-audit').some((issue) => issue.includes('پشتیبانی نمی‌شود')));
		assert.ok(validatePluginManifest({
			...raw,
			routes: [{ path: '../audit', access: 'cms', methods: ['GET'] }],
		}, 'content-audit').some((issue) => issue.includes('مسیر نسبی')));
		assert.ok(validatePluginManifest({
			...raw,
			routes: [...raw.routes, raw.routes[0]],
		}, 'content-audit').some((issue) => issue.includes('تکراری')));
	});

	it('allows only short static route paths without traversal or encoded segments', () => {
		assert.equal(isPluginApiRoutePath('audit/items-v2'), true);
		assert.equal(isPluginApiRoutePath('../audit'), false);
		assert.equal(isPluginApiRoutePath('audit/%2e%2e'), false);
		assert.equal(isPluginApiRoutePath('/audit'), false);
		assert.equal(isPluginApiRoutePath('audit/'), false);
	});

	it('rejects public visibility for secret settings', () => {
		const raw = JSON.parse(readFileSync(join(process.cwd(), 'plugins/kaveh-neg-sms/plugin.json'), 'utf8'));
		const settings = raw.settings.map((setting: Record<string, unknown>) =>
			setting.secret === true ? { ...setting, public: true } : setting,
		);
		assert.ok(validatePluginManifest({ ...raw, settings }, 'kaveh-neg-sms').some((issue) => issue.includes('نمی‌تواند public باشد')));
	});

	it('rejects duplicate or invalid settings and dependency cycles at the self-edge', () => {
		const raw = JSON.parse(readFileSync(join(process.cwd(), 'plugins/content-audit/plugin.json'), 'utf8'));
		const duplicateSetting = raw.settings[0];
		assert.ok(validatePluginManifest({ ...raw, settings: [duplicateSetting, duplicateSetting] }, 'content-audit').some((issue) => issue.includes('تکراری')));
		assert.ok(validatePluginManifest({ ...raw, requiresPlugins: ['content-audit'] }, 'content-audit').some((issue) => issue.includes('خودش')));
		assert.ok(validatePluginManifest({ ...raw, settings: [{ key: '../bad', label: 'Bad', type: 'text' }] }, 'content-audit').some((issue) => issue.includes('key')));
	});

	it('requires secrets:read for secret settings and forbids secret defaults', () => {
		const raw = JSON.parse(readFileSync(join(process.cwd(), 'plugins/kaveh-neg-sms/plugin.json'), 'utf8'));
		const missingCapability = raw.capabilities.filter((capability: string) => capability !== 'secrets:read');
		assert.ok(validatePluginManifest({ ...raw, capabilities: missingCapability }, 'kaveh-neg-sms').some((issue) => issue.includes('secrets:read')));
		const settings = raw.settings.map((setting: Record<string, unknown>) => setting.key === 'apiKey' ? { ...setting, default: 'plaintext' } : setting);
		assert.ok(validatePluginManifest({ ...raw, settings }, 'kaveh-neg-sms').some((issue) => issue.includes('default')));
	});
});

describe('Plugin lazy module loading', () => {
	it('discovers implementation modules without eager evaluation', () => {
		const registry = readFileSync(join(process.cwd(), 'src/lib/plugins/registry.ts'), 'utf8');
		const implementationGlob = registry.match(/const codeModules = import\.meta\.glob\(([^)]*)\)/)?.[1];
		assert.ok(implementationGlob, 'the plugin implementation glob should remain explicit');
		assert.match(implementationGlob, /['"]\/plugins\/\*\/index\.ts['"]/);
		assert.doesNotMatch(implementationGlob, /eager\s*:\s*true/);
		assert.match(registry, /loadModule:\s*\(\)\s*=>\s*Promise<PluginModule>/);
		assert.match(registry, /pluginModules\.load\(entry\.id/);
	});

	it('imports on demand, coalesces concurrent requests, and caches successful modules', async () => {
		const cache = createLazyModuleCache<{ name: string }>();
		let calls = 0;
		let resolveModule!: (module: { name: string }) => void;
		const importer = () => {
			calls += 1;
			return new Promise<{ name: string }>((resolve) => { resolveModule = resolve; });
		};

		assert.equal(cache.get('inactive'), undefined);
		assert.equal(calls, 0);
		const first = cache.load('content-audit', importer);
		const concurrent = cache.load('content-audit', importer);
		assert.equal(calls, 1);
		assert.equal(cache.get('content-audit'), undefined);

		const module = { name: 'content-audit' };
		resolveModule(module);
		assert.strictEqual(await first, module);
		assert.strictEqual(await concurrent, module);
		assert.strictEqual(cache.get('content-audit'), module);
		assert.strictEqual(await cache.load('content-audit', async () => {
			calls += 1;
			return { name: 'unexpected duplicate' };
		}), module);
		assert.equal(calls, 1);
	});
});

describe('Plugin secret delivery', () => {
	it('uses a plugin-scoped environment key and only exposes presence separately', () => {
		const key = pluginSecretEnvironmentName('kaveh-neg-sms', 'apiKey');
		assert.equal(key, 'NOVEX_PLUGIN_KAVEH_NEG_SMS_API_KEY');
		const previous = process.env[key];
		try {
			delete process.env[key];
			assert.equal(hasPluginSecret('kaveh-neg-sms', 'apiKey'), false);
			process.env[key] = 'test-secret';
			assert.equal(hasPluginSecret('kaveh-neg-sms', 'apiKey'), true);
			assert.equal(readPluginSecret('kaveh-neg-sms', 'apiKey'), 'test-secret');
		} finally {
			if (previous === undefined) delete process.env[key];
			else process.env[key] = previous;
		}
		assert.throws(() => pluginSecretEnvironmentName('../plugin', 'apiKey'), /معتبر/);
	});
});

describe('Plugin capability views', () => {
	it('cannot be mutated through the Set API or its forEach callback', () => {
		const capabilities = readonlySetView(['cms:widgets' as const]);
		assert.equal(capabilities.has('cms:widgets'), true);
		assert.throws(() => (capabilities as Set<string>).add('commerce:payments'), /فقط‌خواندنی/);
		assert.throws(() => capabilities.forEach((_value, _same, exposed) => (exposed as Set<string>).clear()), /فقط‌خواندنی/);
		assert.equal(capabilities.has('commerce:payments' as never), false);
	});
});

describe('Plugin hook authorization contract', () => {
	const raw = JSON.parse(readFileSync(join(process.cwd(), 'plugins/zarinpal-gateway/plugin.json'), 'utf8')) as PluginManifest;

	it('allows only declared payment filters with the commerce:payments capability', () => {
		assert.equal(validateHookRegistration(raw, 'shop.payment.verify', 'filter'), 'commerce:payments');
		assert.throws(() => validateHookRegistration(raw, 'shop.payment.verify', 'action'), /فقط از نوع filter/);
		assert.throws(() => validateHookRegistration(raw, 'shop.payment.refund', 'filter'), /تعریف نشده/);
		assert.throws(() => validateHookRegistration({ ...raw, hooks: [] }, 'shop.payment.verify', 'filter'), /اعلام نشده/);
		assert.throws(() => validateHookRegistration({ ...raw, capabilities: [] }, 'shop.payment.verify', 'filter'), /commerce:payments/);
	});
});

describe('Hook runtime fault policy', () => {
	it('isolates presentation failures but fails closed for payment failures', async () => {
		addFilter('site.head', () => {
			throw new Error('render failure');
		}, 10, 'test-presentation-error');
		addFilter('shop.payment.verify', () => {
			throw new Error('verification failure');
		}, 10, 'test-payment-error');
		try {
			assert.equal(await applyFilters('site.head', '<meta>'), '<meta>');
			await assert.rejects(applyFilters('shop.payment.verify', null), /verification failure/);
		} finally {
			removePluginHooks('test-presentation-error');
			removePluginHooks('test-payment-error');
		}
	});

	it('rejects invalid priorities and continues after action handler failures', async () => {
		assert.throws(() => addFilter('site.head', () => '', Number.NaN, 'test-priority'), /اولویت/);
		let nextHandlerRan = false;
		addAction('test.action', () => { throw new Error('action failure'); }, 10, 'test-action-error');
		addAction('test.action', () => { nextHandlerRan = true; }, 20, 'test-action-next');
		try {
			await doAction('test.action');
			assert.equal(nextHandlerRan, true);
		} finally {
			removePluginHooks('test-action-error');
			removePluginHooks('test-action-next');
		}
	});
});

describe('Plugin setting validation', () => {
	const quantity: PluginSetting = { key: 'maxItems', label: 'Items', type: 'number', min: 1, max: 10 };
	const text: PluginSetting = { key: 'sender', label: 'Sender', type: 'text', minLength: 3, maxLength: 8 };
	const enabled: PluginSetting = { key: 'enabled', label: 'Enabled', type: 'switch' };

	it('parses supported values and enforces range, step and length on the server contract', () => {
		assert.equal(parsePluginSettingValue(quantity, '5'), 5);
		assert.equal(parsePluginSettingValue(enabled, 'true'), true);
		assert.equal(parsePluginSettingValue(enabled, 'false'), false);
		assert.equal(parsePluginSettingValue(text, '  nov  '), 'nov');
		assert.throws(() => parsePluginSettingValue(quantity, '11'), /حداکثر/);
		assert.throws(() => parsePluginSettingValue(quantity, '2.5'), /گام/);
		assert.throws(() => parsePluginSettingValue(text, 'xy'), /حداقل/);
		assert.throws(() => parsePluginSettingValue(text, '123456789'), /بلند/);
		assert.throws(() => parsePluginSettingValue(enabled, 'maybe'), /روشن یا خاموش/);
	});
});

describe('SemVer compatibility', () => {
	it('compares release and prerelease precedence correctly', () => {
		assert.equal(isSemVer('2.0.0-rc.1'), true);
		assert.equal(isSemVer('v2.0'), false);
		assert.ok(compareSemVer('2.0.0', '2.0.0-rc.1') > 0);
		assert.ok(compareSemVer('2.0.0-alpha.2', '2.0.0-alpha.10') < 0);
		assert.equal(compareSemVer('2.0.0+build.1', '2.0.0+build.2'), 0);
	});
});

describe('Plugin state integrity', () => {
	it('accepts an empty current state and preserves valid settings', () => {
		assert.deepEqual(validatePluginState({ version: 1, active: [], options: {} }), {
			version: 1,
			active: [],
			options: {},
		});
		assert.deepEqual(validatePluginState({
			version: 1,
			active: ['seo-meta'],
			options: { 'seo-meta': { twitterHandle: '@novex', enableJsonLd: true } },
		}), {
			version: 1,
			active: ['seo-meta'],
			options: { 'seo-meta': { twitterHandle: '@novex', enableJsonLd: true } },
		});
	});

	it('reports corrupt JSON without treating it as an empty plugin state', () => {
		assert.throws(() => parsePluginStateContent('{broken', 'test/plugins.json'), /خراب است/);
	});

	it('fails closed on malformed state instead of normalizing it to empty', () => {
		assert.throws(() => validatePluginState({ version: 1, active: ['../bad'], options: {} }), /نامعتبر/);
		assert.throws(() => validatePluginState({ version: 1, active: ['seo-meta', 'seo-meta'], options: {} }), /تکراری/);
		assert.throws(() => validatePluginState({ version: 2, active: [], options: {} }), /پشتیبانی/);
		assert.throws(() => validatePluginState({ version: 1, active: [], options: [] }), /شیء/);
		const unsafeKey = JSON.parse('{"version":1,"active":[],"options":{"seo-meta":{"__proto__":"unsafe"}}}');
		assert.throws(() => validatePluginState(unsafeKey), /تنظیم/);
	});
});
