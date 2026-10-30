import type { APIRoute } from 'astro';
import { can } from '../../../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../../../lib/cms/http.ts';
import { assetExists } from '../../../../../../lib/cms/media.ts';
import { isValidPageSlug } from '../../../../../../lib/builder/document.ts';
import { diagnosePageDocument } from '../../../../../../lib/builder/diagnostics.ts';

export const prerender = false;
const MAX_BYTES = 1_200_000;

/** Inspect the supplied unsaved snapshot without changing drafts or publishing. */
export const POST: APIRoute = async ({ params, locals, request }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ بررسی صفحه را ندارید.', 403);
	const slug = params.slug ?? '';
	if (!isValidPageSlug(slug)) return failure('نامک صفحه معتبر نیست.', 400);
	if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return failure('درخواست باید JSON باشد.', 415);
	if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return failure('درخواست بیش از اندازه بزرگ است.', 413);
	let size = 0;
	const chunks: Uint8Array[] = [];
	const reader = request.body?.getReader();
	if (!reader) return failure('بدنهٔ درخواست لازم است.', 400);
	try {
		while (true) {
			const { done, value } = await reader.read();
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
	if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.hasOwn(payload, 'document')) return failure('سند صفحه لازم است.', 400);
	try {
		const diagnostics = await diagnosePageDocument((payload as { document: unknown }).document, slug, assetExists);
		return json({ ok: true, diagnostics });
	} catch {
		return failure('سند برای بررسی معتبر نیست.', 422);
	}
};
