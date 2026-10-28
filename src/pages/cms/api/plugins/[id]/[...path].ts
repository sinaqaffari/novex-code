import type { APIRoute } from 'astro';
import { handlePluginApiRequest } from '../../../../../lib/plugins/route-controller';

export const prerender = false;

const handle: APIRoute = async ({ params, request, url, locals }) =>
	handlePluginApiRequest({
		pluginId: params.id ?? '',
		path: params.path ?? '',
		access: 'cms',
		method: request.method,
		url,
		request,
		user: locals.cmsUser,
	});

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
