import type { ValidationDiagnostic } from './diagnostics.ts';

export class BuilderStoreError extends Error {
	readonly status: number;
	readonly code: string;
	readonly currentRevision?: number;
	readonly diagnostics?: ValidationDiagnostic[];

	constructor(message: string, status: number, code: string, currentRevision?: number, diagnostics?: ValidationDiagnostic[]) {
		super(message);
		this.name = 'BuilderStoreError';
		this.status = status;
		this.code = code;
		this.currentRevision = currentRevision;
		this.diagnostics = diagnostics;
	}
}
