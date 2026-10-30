import { failure, json } from '../cms/http.ts';
import { readBoundedRequestText } from './request.ts';
import { BuilderStoreError } from './store.ts';
import { sectionFragment, type SharedSectionRecord } from './shared-sections.ts';

export async function readSectionRequest(request: Request): Promise<Record<string, unknown>> {
	if (!(request.headers.get('content-type') ?? '').includes('application/json')) throw new BuilderStoreError('درخواست باید JSON باشد.', 415, 'unsupported_content_type');
	const text = await readBoundedRequestText(request, 160_000);
	let input: unknown;
	try { input = JSON.parse(text); } catch { throw new BuilderStoreError('JSON معتبر نیست.', 400, 'invalid_json'); }
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BuilderStoreError('درخواست معتبر نیست.', 400, 'invalid_json');
	return input as Record<string, unknown>;
}

export function sectionPayload(section: SharedSectionRecord) {
	const { id, name, revision, updatedAt } = section;
	return { id, name, revision, updatedAt, fragment: sectionFragment(section) };
}

export function sectionError(error: unknown): Response {
	if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message, ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}) }, error.status);
	return failure('عملیات بخش مشترک انجام نشد.', 500);
}
