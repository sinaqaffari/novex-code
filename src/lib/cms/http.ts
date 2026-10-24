import type { APIContext } from 'astro';

export type JsonPayload = Record<string, unknown>;

/** JSON response with no-store caching (the panel is always live data). */
export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
		},
	});
}

export function failure(message: string, status = 400, field?: string): Response {
	return json({ ok: false, message, field }, status);
}

/** Read a JSON, form-encoded or multipart body into a plain object. */
export async function readPayload(request: Request): Promise<JsonPayload> {
	const contentType = request.headers.get('content-type') ?? '';

	if (contentType.includes('application/json')) {
		try {
			const parsed = await request.json();
			return parsed && typeof parsed === 'object' ? (parsed as JsonPayload) : {};
		} catch {
			return {};
		}
	}

	if (contentType.includes('form') || contentType === '') {
		const form = await request.formData();
		return Object.fromEntries(form.entries());
	}

	return {};
}

export function asText(value: unknown, fallback = ''): string {
	if (value === null || value === undefined) return fallback;
	return String(value);
}

export function asBoolean(value: unknown): boolean {
	return value === true || value === 'true' || value === 'on' || value === '1';
}

/** Post/Redirect/Get helper for progressive-enhancement forms. */
export function redirect(location: string, status = 303): Response {
	return new Response(null, { status, headers: { location } });
}

export function wantsJson(context: APIContext): boolean {
	const accept = context.request.headers.get('accept') ?? '';
	return accept.includes('application/json') || context.url.pathname.endsWith('.json');
}
