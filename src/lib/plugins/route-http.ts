/** Bounded JSON transport for manifest-declared plugin API routes. */

export const MAX_PLUGIN_ROUTE_BODY_BYTES = 64 * 1024;
export const MAX_PLUGIN_ROUTE_RESPONSE_BYTES = 256 * 1024;
export const MAX_PLUGIN_ROUTE_QUERY_CHARS = 2 * 1024;

export class PluginRouteHttpError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
		this.name = 'PluginRouteHttpError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeJsonValue(value: unknown, depth = 0, budget = { nodes: 0 }): boolean {
	budget.nodes += 1;
	if (budget.nodes > 4096 || depth > 16) return false;
	if (value === null || typeof value === 'boolean') return true;
	if (typeof value === 'string') return value.length <= MAX_PLUGIN_ROUTE_BODY_BYTES;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) {
		return value.length <= 1024 && value.every((item) => isSafeJsonValue(item, depth + 1, budget));
	}
	if (!isRecord(value)) return false;

	const entries = Object.entries(value);
	if (entries.length > 256) return false;
	return entries.every(([key, item]) =>
		key.length <= 120 &&
		!['__proto__', 'prototype', 'constructor'].includes(key) &&
		isSafeJsonValue(item, depth + 1, budget),
	);
}

/** POST bodies are deliberately JSON-only, shallow, object-shaped, and size-bounded. */
export async function readPluginRouteJsonBody(request: Request): Promise<Record<string, unknown>> {
	const declaredLength = request.headers.get('content-length');
	if (declaredLength !== null) {
		if (!/^\d+$/.test(declaredLength)) throw new PluginRouteHttpError(400, 'طول بدنهٔ درخواست معتبر نیست.');
		if (Number(declaredLength) > MAX_PLUGIN_ROUTE_BODY_BYTES) {
			throw new PluginRouteHttpError(413, 'بدنهٔ درخواست بیش از حد مجاز است.');
		}
	}

	const mediaType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
	if (mediaType !== 'application/json') {
		throw new PluginRouteHttpError(415, 'بدنهٔ API افزونه باید JSON باشد.');
	}
	if (!request.body) throw new PluginRouteHttpError(400, 'بدنهٔ JSON درخواست خالی است.');

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_PLUGIN_ROUTE_BODY_BYTES) {
				await reader.cancel().catch(() => undefined);
				throw new PluginRouteHttpError(413, 'بدنهٔ درخواست بیش از حد مجاز است.');
			}
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof PluginRouteHttpError) throw error;
		throw new PluginRouteHttpError(400, 'خواندن بدنهٔ درخواست ممکن نشد.');
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		throw new PluginRouteHttpError(400, 'JSON درخواست معتبر نیست.');
	}
	if (!isRecord(parsed) || !isSafeJsonValue(parsed)) {
		throw new PluginRouteHttpError(400, 'ساختار JSON درخواست پشتیبانی نمی‌شود.');
	}
	return parsed;
}

/** JSON-only responses prevent plugins from setting cookies or arbitrary HTTP headers. */
export function pluginApiJsonResponse(value: unknown): Response {
	let body: string;
	try {
		body = JSON.stringify(value === undefined ? null : value) ?? 'null';
	} catch {
		throw new PluginRouteHttpError(500, 'پاسخ API افزونه قابل تبدیل به JSON نیست.');
	}
	if (new TextEncoder().encode(body).byteLength > MAX_PLUGIN_ROUTE_RESPONSE_BYTES) {
		throw new PluginRouteHttpError(500, 'پاسخ API افزونه از اندازهٔ مجاز بیشتر است.');
	}
	return new Response(body, {
		status: 200,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff',
		},
	});
}

export function pluginApiErrorResponse(status: number, message: string, allow?: string[]): Response {
	const headers = new Headers({
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff',
	});
	if (allow?.length) headers.set('allow', allow.join(', '));
	return new Response(JSON.stringify({ ok: false, message }), { status, headers });
}
