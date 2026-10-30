import { readBoundedRequestBytes, RequestBodyError } from '../cms/request-body.ts';
import { BuilderStoreError } from './store.ts';

/** Bound JSON streams, including requests without a reliable Content-Length. */
export async function readBoundedRequestText(request: Request, maxBytes: number): Promise<string> {
	try {
		const bytes = await readBoundedRequestBytes(request, maxBytes);
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		if (error instanceof RequestBodyError && error.code === 'payload_too_large') {
			throw new BuilderStoreError('بدنهٔ درخواست بیش از اندازه بزرگ است.', 413, 'payload_too_large');
		}
		throw new BuilderStoreError('خواندن بدنهٔ درخواست ممکن نشد.', 400, 'invalid_json');
	}
}

/** Bound form-encoded and multipart page-creation requests before parsing. */
export async function readBoundedRequestForm(request: Request, maxBytes: number): Promise<FormData> {
	try {
		const bytes = await readBoundedRequestBytes(request, maxBytes);
		return await new Response(bytes, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
	} catch (error) {
		if (error instanceof RequestBodyError && error.code === 'payload_too_large') {
			throw new BuilderStoreError('بدنهٔ درخواست بیش از اندازه بزرگ است.', 413, 'payload_too_large');
		}
		throw new BuilderStoreError('خواندن فرم درخواست ممکن نشد.', 400, 'invalid_form');
	}
}
