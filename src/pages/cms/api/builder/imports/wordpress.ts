import type { APIRoute } from 'astro';
import { can } from '../../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../../lib/cms/http.ts';
import { BuilderStoreError, installDraftPages } from '../../../../../lib/builder/store.ts';
import { validatePageDocument } from '../../../../../lib/builder/document.ts';

export const prerender = false;
const MAX_BYTES = 1_200_000;

/** Accept only already converted canonical documents. No source code or remote assets are run. */
export const POST: APIRoute = async ({ locals, request }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ساخت صفحه ندارید.', 403);
	if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return failure('درخواست باید JSON باشد.', 415);
	if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return failure('درخواست بیش از اندازه بزرگ است.', 413);
	const reader = request.body?.getReader();
	if (!reader) return failure('بدنهٔ درخواست لازم است.', 400);
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_BYTES) { await reader.cancel(); return failure('درخواست بیش از اندازه بزرگ است.', 413); }
			chunks.push(value);
		}
	} catch { return failure('خواندن درخواست ممکن نشد.', 400); }
	let payload: unknown;
	try {
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch { return failure('بدنهٔ JSON معتبر نیست.', 400); }
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return failure('درخواست معتبر نیست.', 400);
	const body = payload as Record<string, unknown>;
	if (body.confirmCreate !== true) return failure('تأیید ساخت پیش‌نویس‌ها لازم است.', 400);
	if (!Array.isArray(body.documents) || !body.documents.length || body.documents.length > 20) return failure('تعداد صفحه‌ها معتبر نیست.', 422);
	try {
		const documents = body.documents.map((document) => validatePageDocument(document));
		const records = await installDraftPages(documents);
		return json({ ok: true, pages: records.map(({ slug, revision }) => ({ slug, revision })) }, 201);
	} catch (error) {
		if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message }, error.status);
		return failure('سند واردشده معتبر نیست؛ هیچ صفحه‌ای ساخته نشد.', 422);
	}
};
