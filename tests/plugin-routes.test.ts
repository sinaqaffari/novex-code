/** Bounded JSON input and output contract for plugin-owned API routes. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	MAX_PLUGIN_ROUTE_BODY_BYTES,
	MAX_PLUGIN_ROUTE_RESPONSE_BYTES,
	PluginRouteHttpError,
	pluginApiErrorResponse,
	pluginApiJsonResponse,
	readPluginRouteJsonBody,
} from '../src/lib/plugins/route-http.ts';
import { dispatchPluginApiRequest } from '../src/lib/plugins/route-dispatch.ts';
import type {
	PluginApi,
	PluginApiRouteAccess,
	PluginApiRouteHandler,
	PluginApiRouteMethod,
	PublicPluginApi,
} from '../src/lib/plugins/types.ts';
import type { PluginApiRequest, ResolvedPluginApiRoute } from '../src/lib/plugins/route-dispatch.ts';

const jsonRequest = (body: string, headers: Record<string, string> = {}) =>
	new Request('https://novex.example/cms/api/plugins/demo/route', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body,
	});

describe('Plugin API JSON transport', () => {
	it('accepts bounded plain JSON objects and rejects dangerous keys', async () => {
		assert.deepEqual(await readPluginRouteJsonBody(jsonRequest('{"title":"سلام","enabled":true,"items":[1,2]}')), {
			title: 'سلام',
			enabled: true,
			items: [1, 2],
		});
		await assert.rejects(
			readPluginRouteJsonBody(jsonRequest('{"__proto__":{"polluted":true}}')),
			(error: unknown) => error instanceof PluginRouteHttpError && error.status === 400,
		);
	});

	it('requires JSON object input and enforces the body byte limit while reading', async () => {
		await assert.rejects(
			readPluginRouteJsonBody(jsonRequest('[1,2]')),
			(error: unknown) => error instanceof PluginRouteHttpError && error.status === 400,
		);
		await assert.rejects(
			readPluginRouteJsonBody(jsonRequest('{"ok":true}', { 'content-type': 'text/plain' })),
			(error: unknown) => error instanceof PluginRouteHttpError && error.status === 415,
		);
		const large = JSON.stringify({ value: 'x'.repeat(MAX_PLUGIN_ROUTE_BODY_BYTES) });
		await assert.rejects(
			readPluginRouteJsonBody(jsonRequest(large)),
			(error: unknown) => error instanceof PluginRouteHttpError && error.status === 413,
		);
	});

	it('serializes JSON with no-store and refuses oversized results', async () => {
		const response = pluginApiJsonResponse({ items: ['one'] });
		assert.equal(response.status, 200);
		assert.match(response.headers.get('content-type') ?? '', /application\/json/);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
		assert.deepEqual(await response.json(), { items: ['one'] });
		assert.throws(
			() => pluginApiJsonResponse({ value: 'x'.repeat(MAX_PLUGIN_ROUTE_RESPONSE_BYTES) }),
			(error: unknown) => error instanceof PluginRouteHttpError && error.status === 500,
		);
	});

	it('returns explicit method policy without forwarding arbitrary response headers', async () => {
		const response = pluginApiErrorResponse(405, 'Method not allowed', ['GET']);
		assert.equal(response.status, 405);
		assert.equal(response.headers.get('allow'), 'GET');
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.equal(response.headers.get('set-cookie'), null);
		assert.deepEqual(await response.json(), { ok: false, message: 'Method not allowed' });
	});
});

const routeDefinition = (access: PluginApiRouteAccess, methods: PluginApiRouteMethod[] = ['GET']) => ({
	path: 'audit',
	access,
	methods,
});

function resolvedRoute(
	access: PluginApiRouteAccess,
	methods: PluginApiRouteMethod[],
	handler: PluginApiRouteHandler,
): ResolvedPluginApiRoute {
	return {
		manifest: { id: 'demo' },
		route: routeDefinition(access, methods),
		handler,
		api: access === 'public'
			? { getPublicPosts: async () => [] } as unknown as PublicPluginApi
			: {} as PluginApi,
	};
}

function apiInput(options: {
	access?: PluginApiRouteAccess;
	method?: string;
	user?: PluginApiRequest['user'];
	body?: string;
	search?: string;
} = {}): PluginApiRequest {
	const access = options.access ?? 'cms';
	const method = options.method ?? 'GET';
	const url = new URL(`https://novex.example/${access === 'cms' ? 'cms/' : ''}api/plugins/demo/audit${options.search ?? ''}`);
	const init: RequestInit = { method };
	if (options.body !== undefined) {
		init.headers = { 'content-type': 'application/json' };
		init.body = options.body;
	}
	return {
		pluginId: 'demo',
		path: 'audit',
		access,
		method,
		url,
		request: new Request(url, init),
		user: options.user,
	};
}

describe('Plugin API dispatch and authorization', () => {
	it('checks CMS session and role permission before resolving or invoking a route', async () => {
		let resolveCalls = 0;
		let handlerCalls = 0;
		const resolve = async () => {
			resolveCalls += 1;
			return resolvedRoute('cms', ['GET'], async () => {
				handlerCalls += 1;
				return { ok: true };
			});
		};

		const anonymous = await dispatchPluginApiRequest(apiInput(), resolve);
		assert.equal(anonymous.status, 401);
		const subscriber = await dispatchPluginApiRequest(apiInput({ user: { username: 'reader', role: 'subscriber' } }), resolve);
		assert.equal(subscriber.status, 403);
		assert.equal(resolveCalls, 0);
		assert.equal(handlerCalls, 0);

		const admin = await dispatchPluginApiRequest(apiInput({ user: { username: 'root', role: 'admin' } }), resolve);
		assert.equal(admin.status, 200);
		assert.deepEqual(await admin.json(), { ok: true });
		assert.equal(resolveCalls, 1);
		assert.equal(handlerCalls, 1);
	});

	it('passes only the declared public context and serves a public GET without a CMS user', async () => {
		let received: unknown;
		const resolve = async () => resolvedRoute('public', ['GET'], async (context) => {
			received = context;
			if (context.access !== 'public') throw new Error('Expected public context');
			return { posts: await context.api.getPublicPosts() };
		});
		const response = await dispatchPluginApiRequest(apiInput({ access: 'public' }), resolve);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { posts: [] });
		assert.deepEqual(Object.keys(received as object).sort(), ['access', 'api', 'method', 'url']);
		const methodNotAllowed = await dispatchPluginApiRequest(apiInput({ access: 'public', method: 'POST', body: '{}' }), resolve);
		assert.equal(methodNotAllowed.status, 405);
		assert.equal(methodNotAllowed.headers.get('allow'), 'GET, HEAD');
	});

	it('validates CMS POST JSON and gives the handler parsed body and authorized user', async () => {
		let received: unknown;
		const resolve = async () => resolvedRoute('cms', ['POST'], async (context) => {
			received = context;
			if (context.access !== 'cms') throw new Error('Expected CMS context');
			return { accepted: context.body?.title === 'سلام' };
		});
		const input = apiInput({
			method: 'POST',
			user: { username: 'root', role: 'admin' },
			body: '{"title":"سلام"}',
		});
		const response = await dispatchPluginApiRequest(input, resolve);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { accepted: true });
		assert.deepEqual((received as { body: unknown }).body, { title: 'سلام' });
		assert.deepEqual((received as { user: unknown }).user, { username: 'root', role: 'admin' });
	});

	it('supports bodyless HEAD responses and bounds query input before plugin resolution', async () => {
		let resolveCalls = 0;
		const resolve = async () => {
			resolveCalls += 1;
			return resolvedRoute('cms', ['GET'], async () => ({ ok: true }));
		};
		const head = await dispatchPluginApiRequest(apiInput({ method: 'HEAD', user: { username: 'root', role: 'admin' } }), resolve);
		assert.equal(head.status, 200);
		assert.equal(await head.text(), '');
		assert.equal(head.headers.get('content-type'), 'application/json; charset=utf-8');

		const tooLong = await dispatchPluginApiRequest(apiInput({
			user: { username: 'root', role: 'admin' },
			search: `?q=${'x'.repeat(2049)}`,
		}), resolve);
		assert.equal(tooLong.status, 414);
		assert.equal(resolveCalls, 1);
	});
});
