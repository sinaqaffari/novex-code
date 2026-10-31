import { createHmac, timingSafeEqual } from 'node:crypto';

export type InquiryKind = 'contact' | 'reservation' | 'consultation' | 'enrollment';
export type InquiryStatus = 'new' | 'read' | 'archived';
export interface Inquiry {
	id: string;
	pageSlug: string;
	nodeId: string;
	kind: InquiryKind;
	name: string;
	contact: string;
	message: string;
	status: InquiryStatus;
	createdAt: string;
	updatedAt: string;
}
export interface InquiryInput {
	requestId: string;
	pageSlug: string;
	nodeId: string;
	kind: InquiryKind;
	name: string;
	contact: string;
	message: string;
	clientHash: string;
}

export class BackendError extends Error {
	readonly code: string;
	readonly status: number;
	constructor(code: string, status: number) {
		super(code);
		this.name = 'BackendError';
		this.code = code;
		this.status = status;
	}
}

function configuration(): { origin: string; token: string } | null {
	const raw = process.env.NOVEX_BACKEND_URL?.trim();
	const token = process.env.NOVEX_BACKEND_TOKEN ?? '';
	if (!raw || token.length < 32) return null;
	try {
		const url = new URL(raw);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
		return { origin: url.origin, token };
	} catch { return null; }
}

export function inquiryBackendConfigured(): boolean { return configuration() !== null; }

/** The address is keyed and hashed; the Go database never receives the raw IP. */
export function inquiryClientHash(address: string): string {
	const config = configuration();
	if (!config) throw new BackendError('not_configured', 503);
	return createHmac('sha256', config.token).update(`inquiry-rate:${address}`).digest('hex');
}

export async function backendRequest(path: string, options: { method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown } = {}): Promise<Record<string, unknown>> {
	const config = configuration();
	if (!config) throw new BackendError('not_configured', 503);
	let response: Response;
	try {
		response = await fetch(`${config.origin}${path}`, {
			method: options.method ?? 'GET',
			headers: { authorization: `Bearer ${config.token}`, accept: 'application/json', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
			...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
			redirect: 'error', signal: AbortSignal.timeout(7000),
		});
	} catch { throw new BackendError('unavailable', 503); }
	let payload: unknown;
	try { payload = await response.json(); } catch { throw new BackendError('invalid_response', 503); }
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BackendError('invalid_response', 503);
	const result = payload as Record<string, unknown>;
	if (!response.ok || result.ok !== true) throw new BackendError(typeof result.code === 'string' ? result.code : 'unavailable', response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403 ? response.status : 503);
	return result;
}

export async function createInquiry(input: InquiryInput): Promise<{ id: string; replayed: boolean }> {
	const response = await backendRequest('/v1/inquiries', { method: 'POST', body: input });
	if (typeof response.id !== 'string' || !/^inq_[a-f0-9]{32}$/.test(response.id) || typeof response.replayed !== 'boolean') throw new BackendError('invalid_response', 503);
	return { id: response.id, replayed: response.replayed };
}

export async function listInquiries(options: { status?: InquiryStatus; offset?: number; limit?: number } = {}): Promise<{ items: Inquiry[]; hasMore: boolean }> {
	const params = new URLSearchParams();
	if (options.status) params.set('status', options.status);
	if (options.offset) params.set('offset', String(options.offset));
	if (options.limit) params.set('limit', String(options.limit));
	const response = await backendRequest(`/v1/inquiries?${params}`);
	if (!Array.isArray(response.items) || typeof response.hasMore !== 'boolean') throw new BackendError('invalid_response', 503);
	for (const item of response.items) {
		if (!item || typeof item !== 'object' || !['id','pageSlug','nodeId','kind','name','contact','message','status','createdAt','updatedAt'].every((key) => typeof (item as Record<string, unknown>)[key] === 'string')) throw new BackendError('invalid_response', 503);
	}
	for (const raw of response.items) {
		const item = raw as Inquiry;
		if (!/^inq_[a-f0-9]{32}$/.test(item.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.pageSlug) || item.pageSlug.length > 60 || !/^node_[A-Za-z0-9_-]{6,80}$/.test(item.nodeId) || !['contact','reservation','consultation','enrollment'].includes(item.kind) || !['new','read','archived'].includes(item.status)) throw new BackendError('invalid_response', 503);
	}
	return { items: response.items as Inquiry[], hasMore: response.hasMore };
}

export async function updateInquiry(id: string, status: InquiryStatus): Promise<void> {
	if (!/^inq_[a-f0-9]{32}$/.test(id) || !['new', 'read', 'archived'].includes(status)) throw new BackendError('invalid_status', 400);
	await backendRequest(`/v1/inquiries/${id}`, { method: 'PATCH', body: { status } });
}

export async function deleteInquiry(id: string): Promise<void> {
	if (!/^inq_[a-f0-9]{32}$/.test(id)) throw new BackendError('invalid_id', 400);
	await backendRequest(`/v1/inquiries/${id}`, { method: 'DELETE' });
}

export const INQUIRY_FEEDBACK_COOKIE = 'novex_inquiry_feedback';
export type InquiryFeedback = { slug: string; nodeId: string; result: 'sent' | 'invalid' | 'unavailable' | 'limited'; expires: number };

export function signInquiryFeedback(feedback: InquiryFeedback): string {
	const config = configuration();
	if (!config) throw new BackendError('not_configured', 503);
	const body = Buffer.from(JSON.stringify(feedback)).toString('base64url');
	const signature = createHmac('sha256', config.token).update(`inquiry-feedback:${body}`).digest('base64url');
	return `${body}.${signature}`;
}

export function readInquiryFeedback(value: string | undefined, slug: string): InquiryFeedback | null {
	const config = configuration();
	if (!config || !value || value.length > 2048) return null;
	const [body, signature, extra] = value.split('.');
	if (!body || !signature || extra !== undefined) return null;
	const expected = createHmac('sha256', config.token).update(`inquiry-feedback:${body}`).digest();
	let supplied: Buffer;
	try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
	if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
	try {
		const payload: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
		if (!payload || typeof payload !== 'object') return null;
		const p = payload as Partial<InquiryFeedback>;
		if (p.slug !== slug || typeof p.nodeId !== 'string' || !/^node_[A-Za-z0-9_-]{6,80}$/.test(p.nodeId) || !['sent','invalid','unavailable','limited'].includes(p.result ?? '') || typeof p.expires !== 'number' || p.expires < Date.now() || p.expires > Date.now() + 180000) return null;
		return p as InquiryFeedback;
	} catch { return null; }
}
