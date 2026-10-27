import { can, type Permission, type Role } from '../cms/rbac.ts';
import { isPluginApiRoutePath } from './validation.ts';
import {
	MAX_PLUGIN_ROUTE_QUERY_CHARS,
	PluginRouteHttpError,
	pluginApiErrorResponse,
	pluginApiJsonResponse,
	readPluginRouteJsonBody,
} from './route-http.ts';
import type {
	PluginApi,
	PluginApiRoute,
	PluginApiRouteAccess,
	PluginApiRouteHandler,
	PluginApiRouteMethod,
	PluginApiRouteContext,
	PublicPluginApi,
} from './types.ts';

const NOT_FOUND = 'API افزونه پیدا نشد.';
const INTERNAL_ERROR = 'اجرای API افزونه ناموفق بود.';
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PluginApiRequest {
	pluginId: string;
	path: string;
	access: PluginApiRouteAccess;
	method: string;
	url: URL;
	request: Request;
	user?: { username: string; role: Role } | null;
}

export interface ResolvedPluginApiRoute {
	manifest: { id: string };
	route: PluginApiRoute;
	handler: PluginApiRouteHandler;
	api: PluginApi | PublicPluginApi;
}

export type PluginApiRouteResolver = (input: {
	pluginId: string;
	path: string;
	access: PluginApiRouteAccess;
}) => Promise<ResolvedPluginApiRoute | null>;

function responseForRequest(input: PluginApiRequest, response: Response): Response {
	return input.method.toUpperCase() === 'HEAD'
		? new Response(null, { status: response.status, headers: response.headers })
		: response;
}

function errorResponse(input: PluginApiRequest, status: number, message: string, allow?: string[]): Response {
	return responseForRequest(input, pluginApiErrorResponse(status, message, allow));
}

function logRouteFailure(pluginId: string, path: string): void {
	// Deliberately do not log plugin error messages or request data; either may contain secrets.
	console.error(`[plugins] API route failed for ${(pluginId + '/' + path).slice(0, 160)}`);
}

export async function dispatchPluginApiRequest(
	input: PluginApiRequest,
	resolve: PluginApiRouteResolver,
): Promise<Response> {
	if (!PLUGIN_ID_PATTERN.test(input.pluginId) || !isPluginApiRoutePath(input.path)) {
		return errorResponse(input, 404, NOT_FOUND);
	}
	if (input.url.search.length > MAX_PLUGIN_ROUTE_QUERY_CHARS) {
		return errorResponse(input, 414, 'پارامترهای نشانی API بیش از حد مجاز هستند.');
	}

	const requestMethod = input.method.toUpperCase();
	const method = requestMethod === 'HEAD' ? 'GET' : requestMethod;
	let user: { username: string; role: Role } | null = null;
	if (input.access === 'cms') {
		user = input.user ?? null;
		if (!user) return errorResponse(input, 401, 'برای استفاده از این API باید وارد پنل شوید.');
		const permission: Permission = method === 'GET' ? 'cms.plugins:read' : 'cms.plugins:write';
		if (!can(user.role, permission)) {
			return errorResponse(input, 403, 'دسترسی لازم برای استفاده از این API را ندارید.');
		}
	}

	let resolved: ResolvedPluginApiRoute | null;
	try {
		resolved = await resolve({ pluginId: input.pluginId, path: input.path, access: input.access });
	} catch {
		logRouteFailure(input.pluginId, input.path);
		return errorResponse(input, 500, INTERNAL_ERROR);
	}
	if (!resolved || resolved.manifest.id !== input.pluginId || resolved.route.path !== input.path || resolved.route.access !== input.access) {
		return errorResponse(input, 404, NOT_FOUND);
	}

	const allowedMethods: string[] = [...resolved.route.methods];
	if (resolved.route.methods.includes('GET')) allowedMethods.push('HEAD');
	if (!resolved.route.methods.includes(method as PluginApiRouteMethod)) {
		return errorResponse(input, 405, 'روش درخواست برای این API اعلام نشده است.', allowedMethods);
	}

	let body: Record<string, unknown> | undefined;
	if (method === 'POST') {
		try {
			body = await readPluginRouteJsonBody(input.request);
		} catch (error) {
			if (error instanceof PluginRouteHttpError) return errorResponse(input, error.status, error.message);
			return errorResponse(input, 400, 'خواندن بدنهٔ درخواست ممکن نشد.');
		}
	}

	let result: unknown;
	try {
		const context: PluginApiRouteContext = input.access === 'public'
			? {
					access: 'public',
					method: 'GET',
					url: input.url,
					api: resolved.api as Extract<PluginApiRouteContext, { access: 'public' }>['api'],
				}
			: {
					access: 'cms',
					method: method as PluginApiRouteMethod,
					url: input.url,
					...(body !== undefined ? { body } : {}),
					user: user!,
					api: resolved.api as Extract<PluginApiRouteContext, { access: 'cms' }>['api'],
				};
		result = await resolved.handler(context);
	} catch {
		logRouteFailure(input.pluginId, input.path);
		return errorResponse(input, 500, INTERNAL_ERROR);
	}

	try {
		return responseForRequest(input, pluginApiJsonResponse(result));
	} catch {
		logRouteFailure(input.pluginId, input.path);
		return errorResponse(input, 500, INTERNAL_ERROR);
	}
}
