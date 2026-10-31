import type { APIRoute, APIContext } from 'astro';
import { getPublishedPage } from '../../lib/builder/store.ts';
import { isValidPageSlug } from '../../lib/builder/document.ts';
import { findNode } from '../../lib/builder/operations.ts';
import { BackendError, createInquiry, inquiryBackendConfigured, inquiryClientHash, INQUIRY_FEEDBACK_COOKIE, signInquiryFeedback, type InquiryFeedback } from '../../lib/backend/inquiries.ts';

export const prerender = false;
const LIMIT = 16384;
const allowed = new Set(['slug', 'nodeId', 'requestId', 'name', 'contact', 'message', 'website']);

async function boundedPayload(request: Request): Promise<Record<string, string> | null> {
	const length = Number(request.headers.get('content-length') ?? 0);
	if (!Number.isFinite(length) || length > LIMIT || !request.body) return null;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.byteLength;
			if (size > LIMIT) { await reader.cancel(); return null; }
			chunks.push(part.value);
		}
		const joined = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
		const text = new TextDecoder('utf-8', { fatal: true }).decode(joined);
		const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
		let entries: Array<[string, unknown]>;
		if (contentType === 'application/x-www-form-urlencoded') entries = [...new URLSearchParams(text).entries()];
		else if (contentType === 'application/json') {
			const parsed: unknown = JSON.parse(text);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
			entries = Object.entries(parsed);
		} else return null;
		const payload: Record<string, string> = Object.create(null) as Record<string, string>;
		for (const [key, value] of entries) {
			if (!allowed.has(key) || typeof value !== 'string' || Object.hasOwn(payload, key)) return null;
			payload[key] = value;
		}
		return payload;
	} catch { return null; }
}

function validText(value: string, min: number, max: number, multiline = false): boolean {
	const length = [...value].length;
	return length >= min && length <= max && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value);
}

function response(context: APIContext, slug: string, nodeId: string, result: InquiryFeedback['result'], status: number, code: string, extra: Record<string, unknown> = {}): Response {
	const json = (context.request.headers.get('accept') ?? '').includes('application/json');
	if (json) return new Response(JSON.stringify({ ok: result === 'sent', code, ...extra }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
	if (!isValidPageSlug(slug) || !/^node_[A-Za-z0-9_-]{6,80}$/.test(nodeId) || !inquiryBackendConfigured()) {
		return new Response('ارسال درخواست ممکن نیست. لطفاً پیکربندی سرویس و اطلاعات فرم را بررسی کنید.', { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
	}
	const value = signInquiryFeedback({ slug, nodeId, result, expires: Date.now() + 120000 });
	const forwardedProto = context.request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
	context.cookies.set(INQUIRY_FEEDBACK_COOKIE, value, { path: '/', httpOnly: true, sameSite: 'lax', secure: context.url.protocol === 'https:' || forwardedProto === 'https', maxAge: 120 });
	return new Response(null, { status: 303, headers: { location: `/pages/${encodeURIComponent(slug)}#${encodeURIComponent(nodeId)}`, 'cache-control': 'no-store' } });
}

export const POST: APIRoute = async (context) => {
	const payload = await boundedPayload(context.request);
	const slug = payload?.slug ?? '';
	const nodeId = payload?.nodeId ?? '';
	if (!payload || !isValidPageSlug(slug) || !/^node_[A-Za-z0-9_-]{6,80}$/.test(nodeId) || !/^[a-f0-9]{32}$/.test(payload.requestId ?? '') || payload.website) {
		return response(context, slug, nodeId, 'invalid', 400, 'invalid_request');
	}
	const name = (payload.name ?? '').trim();
	const contact = (payload.contact ?? '').trim();
	const message = (payload.message ?? '').trim();
	if (!validText(name, 2, 120) || !validText(contact, 3, 160) || !validText(message, 2, 2000, true)) return response(context, slug, nodeId, 'invalid', 422, 'invalid_fields');
	try {
		// Only an actual form in a published document can accept submissions.
		const published = await getPublishedPage(slug);
		const node = published && findNode(published.document.nodes, nodeId);
		if (!node || node.type !== 'InquiryForm') return response(context, slug, nodeId, 'invalid', 404, 'form_not_published');
		let address = 'unknown';
		try { address = context.clientAddress || 'unknown'; } catch { /* No reliable peer address in this adapter. */ }
		const saved = await createInquiry({ requestId: payload.requestId, pageSlug: slug, nodeId, kind: node.props.kind, name, contact, message, clientHash: inquiryClientHash(address) });
		return response(context, slug, nodeId, 'sent', 201, 'saved', { id: saved.id, replayed: saved.replayed });
	} catch (error) {
		if (error instanceof BackendError) {
			if (error.status === 429) return response(context, slug, nodeId, 'limited', 429, error.code);
			if (error.status >= 400 && error.status < 500) return response(context, slug, nodeId, 'invalid', error.status, error.code);
		}
		return response(context, slug, nodeId, 'unavailable', 503, 'backend_unavailable');
	}
};
