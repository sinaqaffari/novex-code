import { serializePageDocument } from './document.ts';
import type { PageDocument } from './types.ts';

export type AutosaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
export type AutosaveFunction = (document: PageDocument) => Promise<void>;
export type AutosaveStatusListener = (status: AutosaveStatus, error?: unknown) => void;

export class AutosaveConflictError extends Error {
	constructor(message = 'A newer page revision exists.') {
		super(message);
		this.name = 'AutosaveConflictError';
	}
}

/** Debounced, serial autosaving that keeps the newest local document on failure. */
export class AutosaveController {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private latest: PageDocument | null = null;
	private baseline = '';
	private inFlight: Promise<void> | null = null;
	private blockedError: unknown;
	private disposed = false;
	private readonly save: AutosaveFunction;
	private readonly onStatus: AutosaveStatusListener;
	private readonly delayMs: number;

	constructor(save: AutosaveFunction, onStatus: AutosaveStatusListener, delayMs = 700) {
		this.save = save;
		this.onStatus = onStatus;
		this.delayMs = delayMs;
	}

	initialize(document: PageDocument): void {
		this.clearTimer();
		this.latest = document;
		this.baseline = serializePageDocument(document);
		this.blockedError = undefined;
		this.onStatus('saved');
	}

	schedule(document: PageDocument): void {
		if (this.disposed) return;
		this.latest = document;
		if (!this.isDirty()) {
			this.blockedError = undefined;
			this.clearTimer();
			this.onStatus('saved');
			return;
		}
		if (this.blockedError instanceof AutosaveConflictError) {
			this.onStatus('conflict', this.blockedError);
			return;
		}
		if (this.blockedError) this.blockedError = undefined;
		this.onStatus('dirty');
		this.clearTimer();
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.flush().catch(() => undefined);
		}, this.delayMs);
	}

	async flush(): Promise<void> {
		this.clearTimer();
		if (this.disposed || !this.latest || !this.isDirty()) return;
		if (this.blockedError instanceof AutosaveConflictError) throw this.blockedError;
		if (this.inFlight) {
			await this.inFlight;
			if (this.isDirty()) return this.flush();
			return;
		}

		const snapshot = this.latest;
		const snapshotJson = serializePageDocument(snapshot);
		this.onStatus('saving');
		this.inFlight = this.save(snapshot)
			.then(() => {
				this.baseline = snapshotJson;
				this.blockedError = undefined;
				if (this.latest && serializePageDocument(this.latest) === this.baseline) this.onStatus('saved');
				else this.onStatus('dirty');
			})
			.catch((error: unknown) => {
				this.blockedError = error;
				this.onStatus(error instanceof AutosaveConflictError ? 'conflict' : 'error', error);
				throw error;
			})
			.finally(() => {
				this.inFlight = null;
				if (!this.disposed && !this.blockedError && this.isDirty() && this.timer === null) {
					this.timer = setTimeout(() => {
						this.timer = null;
						void this.flush().catch(() => undefined);
					}, this.delayMs);
				}
			});
		return this.inFlight;
	}

	retry(): Promise<void> {
		if (this.blockedError instanceof AutosaveConflictError) return Promise.reject(this.blockedError);
		this.blockedError = undefined;
		return this.flush();
	}

	isDirty(): boolean {
		return Boolean(this.latest && serializePageDocument(this.latest) !== this.baseline);
	}

	get error(): unknown {
		return this.blockedError;
	}

	cancel(): void {
		this.disposed = true;
		this.clearTimer();
	}

	private clearTimer(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
	}
}
