/** SEO plugin complements the storefront's own metadata without claiming a live search result. */

import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { pages, register } from '../plugins/seo-meta/index.ts';
import { addFilter, applyFilters, removePluginHooks, type HookCallback } from '../src/lib/plugins/hooks.ts';
import type { PluginApi } from '../src/lib/plugins/types.ts';

function pluginApi(options: Record<string, unknown> = {}): PluginApi {
	const registerFilter: PluginApi['addFilter'] = (hook, callback, priority = 10) => {
		addFilter(hook, callback as HookCallback, priority, 'seo-meta');
	};
	const getOption: PluginApi['getOption'] = <T = unknown>(key: string, fallback?: T) =>
		(options[key] ?? fallback) as T;

	return {
		id: 'seo-meta',
		addFilter: registerFilter,
		getOption,
	} as unknown as PluginApi;
}

afterEach(() => removePluginHooks('seo-meta'));

it('adds canonical, Twitter and JSON-LD metadata without duplicating the host Open Graph tags', async () => {
	const api = pluginApi({ twitterHandle: '@novex_code', enableJsonLd: true });
	register(api);

	const base = [
		'<meta property="og:title" content="عنوان صفحه" />',
		'<meta property="og:description" content="توضیح صفحه" />',
	].join('\n');
	const result = await applyFilters<string>('site.head', base, {
		title: 'عنوان صفحه',
		description: 'توضیح صفحه',
		url: 'https://store.example.test/blog/article',
		type: 'article',
		image: 'https://store.example.test/media/cover.png',
		publishedAt: '2026-10-28T00:00:00Z',
		siteName: 'نووکس‌کد',
		indexable: true,
	});

	assert.equal((result.match(/property="og:title"/g) ?? []).length, 1);
	assert.equal((result.match(/property="og:description"/g) ?? []).length, 1);
	assert.equal((result.match(/rel="canonical"/g) ?? []).length, 1);
	assert.match(result, /name="twitter:card" content="summary_large_image"/);
	assert.match(result, /name="twitter:site" content="@novex_code"/);
	assert.match(result, /"@type":"BlogPosting"/);
});

it('does not add SEO markup to noindex pages and safely encodes untrusted metadata', async () => {
	const api = pluginApi({ twitterHandle: '<script>', enableJsonLd: true });
	register(api);

	const base = '<meta property="og:title" content="host" />';
	const privateHead = await applyFilters<string>('site.head', base, {
		title: 'private order',
		url: 'https://store.example.test/order/private',
		indexable: false,
	});
	assert.equal(privateHead, base);

	const publicHead = await applyFilters<string>('site.head', base, {
		title: '</script><script>alert(1)</script>',
		description: 'title',
		url: 'https://store.example.test/article',
		type: 'article',
		siteName: 'نووکس‌کد',
		indexable: true,
	});
	assert.doesNotMatch(publicHead, /<script>alert\(1\)<\/script>/);
	assert.doesNotMatch(publicHead, /name="twitter:site" content="&lt;script&gt;"/);
	assert.ok(publicHead.includes('\\u003c/script\\u003e'));
});

it('renders a real plugin status panel from the persisted options', async () => {
	const html = await pages.settings(pluginApi({ twitterHandle: '@novex_code', enableJsonLd: false }));
	assert.match(html, /وضعیت سئوی صفحات/);
	assert.match(html, /@novex_code/);
	assert.match(html, /غیرفعال/);
	assert.match(html, /ویرایش تنظیمات سئو/);
});
