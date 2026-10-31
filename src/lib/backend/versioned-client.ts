import { BackendError, backendRequest } from './inquiries.ts';

export interface RemoteSnapshot {
	storeId: string;
	sourceHash: string;
	revision: number;
	snapshot: unknown;
}
export interface SnapshotClient {
	get(): Promise<RemoteSnapshot>;
	bootstrap(storeId: string, sourceHash: string, snapshot: unknown): Promise<void>;
	update(storeId: string, expectedRevision: number, snapshot: unknown): Promise<number>;
}

// Keep the complete encoded request below the Go service's 16 MiB limit.
const MAX_REQUEST_BYTES = 15 * 1024 * 1024;
export function checkSnapshotRequestSize(body: unknown): void {
	const encoded = JSON.stringify(body);
	if (Buffer.byteLength(encoded, 'utf8') > MAX_REQUEST_BYTES) throw new BackendError('snapshot_too_large', 413);
}

/** Paths are an internal allowlist, never supplied by page or plugin content. */
export function createSnapshotClient(path: '/v1/commerce' | '/v1/builder'): SnapshotClient {
	return {
		async get() {
			const response = await backendRequest(path);
			if (typeof response.storeId !== 'string' || !/^[a-f0-9]{32}$/.test(response.storeId) ||
				typeof response.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(response.sourceHash) ||
				!Number.isSafeInteger(response.revision) || (response.revision as number) < 0 ||
				!response.snapshot || typeof response.snapshot !== 'object' || Array.isArray(response.snapshot)) {
				throw new BackendError('invalid_response', 503);
			}
			return { storeId: response.storeId, sourceHash: response.sourceHash, revision: response.revision as number, snapshot: response.snapshot };
		},
		async bootstrap(storeId, sourceHash, snapshot) {
			const body = { storeId, sourceHash, snapshot };
			checkSnapshotRequestSize(body);
			const result = await backendRequest(`${path}/bootstrap`, { method: 'POST', body });
			if (result.revision !== 0 || typeof result.replayed !== 'boolean') throw new BackendError('invalid_response', 503);
		},
		async update(storeId, expectedRevision, snapshot) {
			const body = { storeId, expectedRevision, snapshot };
			checkSnapshotRequestSize(body);
			const result = await backendRequest(path, { method: 'PUT', body });
			if (!Number.isSafeInteger(result.revision) || result.revision !== expectedRevision + 1) throw new BackendError('invalid_response', 503);
			return result.revision as number;
		},
	};
}
