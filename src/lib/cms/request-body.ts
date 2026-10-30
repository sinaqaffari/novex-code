export class RequestBodyError extends Error {
	readonly code: 'payload_too_large' | 'unreadable_body';
	constructor(code: 'payload_too_large' | 'unreadable_body') {
		super(code);
		this.code = code;
		this.name = 'RequestBodyError';
	}
}

/** Read a request with an enforced byte limit, regardless of Content-Length. */
export async function readBoundedRequestBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
	if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new RequestBodyError('payload_too_large');
	const reader = request.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new RequestBodyError('payload_too_large');
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		return bytes;
	} catch (error) {
		if (error instanceof RequestBodyError) throw error;
		throw new RequestBodyError('unreadable_body');
	} finally {
		reader.releaseLock();
	}
}
