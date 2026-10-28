import { serializePageDocument } from './document.ts';
import type { PageDocument } from './types.ts';

export interface DocumentHistoryState {
	past: PageDocument[];
	present: PageDocument;
	future: PageDocument[];
}

const DEFAULT_HISTORY_LIMIT = 60;

export function createDocumentHistory(document: PageDocument): DocumentHistoryState {
	return { past: [], present: document, future: [] };
}

export function commitDocument(
	state: DocumentHistoryState,
	document: PageDocument,
	limit = DEFAULT_HISTORY_LIMIT,
): DocumentHistoryState {
	if (serializePageDocument(state.present) === serializePageDocument(document)) return state;
	const past = [...state.past, state.present];
	return {
		past: past.slice(Math.max(0, past.length - limit)),
		present: document,
		future: [],
	};
}

export function undoDocument(state: DocumentHistoryState): DocumentHistoryState {
	if (state.past.length === 0) return state;
	const previous = state.past.at(-1)!;
	return {
		past: state.past.slice(0, -1),
		present: previous,
		future: [state.present, ...state.future],
	};
}

export function redoDocument(state: DocumentHistoryState): DocumentHistoryState {
	if (state.future.length === 0) return state;
	const [next, ...future] = state.future;
	return {
		past: [...state.past, state.present].slice(-DEFAULT_HISTORY_LIMIT),
		present: next,
		future,
	};
}
