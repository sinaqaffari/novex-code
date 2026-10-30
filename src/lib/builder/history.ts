import { serializePageDocument } from './document.ts';
import type { PageDocument } from './types.ts';

export interface DocumentHistoryState {
	past: PageDocument[];
	present: PageDocument;
	future: PageDocument[];
	/** Selection belongs to each history boundary; selection alone makes no entry. */
	pastSelections: Array<string | null>;
	presentSelection: string | null;
	futureSelections: Array<string | null>;
	lastGroup?: { key: string; at: number };
}

export interface HistoryCommitOptions {
	selectionBefore?: string | null;
	selectionAfter?: string | null;
	/** Consecutive edits to the same control may share an undo boundary. */
	group?: string;
	now?: number;
}

const DEFAULT_HISTORY_LIMIT = 60;
const COALESCE_MS = 1000;

export function createDocumentHistory(document: PageDocument, selection: string | null = null): DocumentHistoryState {
	return { past: [], present: document, future: [], pastSelections: [], presentSelection: selection, futureSelections: [] };
}

export function commitDocument(
	state: DocumentHistoryState,
	document: PageDocument,
	limit = DEFAULT_HISTORY_LIMIT,
	options: HistoryCommitOptions = {},
): DocumentHistoryState {
	if (serializePageDocument(state.present) === serializePageDocument(document)) return state;
	const now = options.now ?? Date.now();
	const coalesce = Boolean(options.group && state.lastGroup?.key === options.group && now >= state.lastGroup.at && now - state.lastGroup.at <= COALESCE_MS && !state.future.length && state.past.length);
	const past = coalesce ? state.past : [...state.past, state.present];
	const selections = coalesce ? state.pastSelections : [...state.pastSelections, options.selectionBefore === undefined ? state.presentSelection : options.selectionBefore];
	const boundedLimit = Number.isSafeInteger(limit) ? Math.max(1, limit) : DEFAULT_HISTORY_LIMIT;
	return {
		past: past.slice(-boundedLimit),
		pastSelections: selections.slice(-boundedLimit),
		present: document,
		presentSelection: options.selectionAfter === undefined ? (options.selectionBefore === undefined ? state.presentSelection : options.selectionBefore) : options.selectionAfter,
		future: [],
		futureSelections: [],
		...(options.group ? { lastGroup: { key: options.group, at: now } } : {}),
	};
}

export function undoDocument(state: DocumentHistoryState, currentSelection = state.presentSelection): DocumentHistoryState {
	if (state.past.length === 0) return state;
	return {
		past: state.past.slice(0, -1),
		pastSelections: state.pastSelections.slice(0, -1),
		present: state.past.at(-1)!,
		presentSelection: state.pastSelections.at(-1) ?? null,
		future: [state.present, ...state.future],
		futureSelections: [currentSelection, ...state.futureSelections],
	};
}

export function redoDocument(state: DocumentHistoryState, currentSelection = state.presentSelection): DocumentHistoryState {
	if (state.future.length === 0) return state;
	return {
		past: [...state.past, state.present].slice(-DEFAULT_HISTORY_LIMIT),
		pastSelections: [...state.pastSelections, currentSelection].slice(-DEFAULT_HISTORY_LIMIT),
		present: state.future[0],
		presentSelection: state.futureSelections[0] ?? null,
		future: state.future.slice(1),
		futureSelections: state.futureSelections.slice(1),
	};
}
