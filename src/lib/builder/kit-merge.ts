import { validatePageDocument } from './document.ts';
import type { PageDocument } from './types.ts';

const MISSING = Symbol('missing');
type Value = unknown | typeof MISSING;
const record = (value: Value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const equal = (left: Value, right: Value): boolean => left === MISSING || right === MISSING ? left === right : JSON.stringify(left) === JSON.stringify(right);
const has = (object: Record<string, unknown>, key: string): Value => Object.hasOwn(object, key) ? object[key] : MISSING;

export type KitFieldChoice = 'local' | 'incoming';
export type KitConflictKind = 'field' | 'structural' | 'order' | 'formatted';
export interface KitFieldConflict { path: string; kind: KitConflictKind; base: string; local: string; incoming: string }
export type KitMergeResult = { ok: true; document: PageDocument } | { ok: false; conflicts: string[]; fields: KitFieldConflict[]; truncated: boolean };

function reviewValue(value: Value, structured: boolean): string | null {
	if (value === MISSING) return '∅ (موجود نیست)';
	if (!structured && value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
	const serialized = JSON.stringify(value);
	return typeof serialized === 'string' && serialized.length <= 2_000 ? serialized : null;
}

/**
 * Merge independent fields and stable-ID collections. Bounded structural and
 * formatted conflicts can be explicitly resolved; oversized conflicts fail closed.
 */
export function mergeKitDocument(baseInput: PageDocument, localInput: PageDocument, incomingInput: PageDocument, choices: ReadonlyMap<string, KitFieldChoice> = new Map()): KitMergeResult {
	const base = validatePageDocument(baseInput);
	const local = validatePageDocument(localInput, base.slug);
	const incoming = validatePageDocument(incomingInput, base.slug);
	const conflicts: string[] = [];
	const fields: KitFieldConflict[] = [];
	let truncated = false;
	function conflict(path: string, baseValue: Value, localValue: Value, incomingValue: Value, kind: KitConflictKind = 'field'): Value {
		const location = path || 'document';
		const structured = kind !== 'field' || [baseValue, localValue, incomingValue].some((value) => record(value) || Array.isArray(value));
		const actualKind: KitConflictKind = kind === 'field' && structured ? 'structural' : kind;
		const base = reviewValue(baseValue, structured);
		const local = reviewValue(localValue, structured);
		const incoming = reviewValue(incomingValue, structured);
		if (base !== null && local !== null && incoming !== null) {
			const choice = choices.get(location);
			if (choice === 'local') return localValue;
			if (choice === 'incoming') return incomingValue;
		}
		if (conflicts.length < 100) {
			conflicts.push(location);
			if (base !== null && local !== null && incoming !== null) fields.push({ path: location, kind: actualKind, base, local, incoming });
		} else truncated = true;
		return localValue;
	}
	function merge(baseValue: Value, localValue: Value, incomingValue: Value, path: string): Value {
		if (equal(localValue, baseValue)) return incomingValue;
		if (equal(incomingValue, baseValue) || equal(localValue, incomingValue)) return localValue;
		if (Array.isArray(baseValue) && Array.isArray(localValue) && Array.isArray(incomingValue)) {
			const ids = (items: unknown[]) => items.map((item) => record(item) && typeof item.id === 'string' ? item.id : null);
			const rawBase = ids(baseValue); const rawLocal = ids(localValue); const rawIncoming = ids(incomingValue);
			const valid = (items: Array<string | null>): items is string[] => items.every((id) => Boolean(id)) && new Set(items).size === items.length;
			if (!valid(rawBase) || !valid(rawLocal) || !valid(rawIncoming)) return conflict(path, baseValue, localValue, incomingValue, 'structural');
			const baseIds = rawBase; const localIds = rawLocal; const incomingIds = rawIncoming;
			const baseMap = new Map(baseIds.map((id, index) => [id, baseValue[index]]));
			const localMap = new Map(localIds.map((id, index) => [id, localValue[index]]));
			const incomingMap = new Map(incomingIds.map((id, index) => [id, incomingValue[index]]));
			const values = new Map<string, Value>();
			for (const id of new Set([...baseIds, ...localIds, ...incomingIds])) {
				const baseItem = baseMap.has(id) ? baseMap.get(id) : MISSING;
				const localItem = localMap.has(id) ? localMap.get(id) : MISSING;
				const incomingItem = incomingMap.has(id) ? incomingMap.get(id) : MISSING;
				const value = merge(baseItem, localItem, incomingItem, `${path}[id=${id}]`);
				if (value !== MISSING) values.set(id, value);
			}
			const survivingBase = baseIds.filter((id) => values.has(id));
			const localOrder = localIds.filter((id) => baseMap.has(id) && values.has(id));
			const incomingOrder = incomingIds.filter((id) => baseMap.has(id) && values.has(id));
			const localReordered = !equal(localOrder, survivingBase);
			const incomingReordered = !equal(incomingOrder, survivingBase);
			const resolveOrder = (): Value => {
				// The choice selects relative order, not whole collections. All merged
				// values and independent insertions remain in the result.
				const selected = conflict(`${path}.order`, baseIds, localIds, incomingIds, 'order');
				const primary = selected === incomingIds ? incomingIds : localIds;
				const secondary = primary === incomingIds ? localIds : incomingIds;
				const ordered = primary.filter((id) => values.has(id));
				for (let index = 0; index < secondary.length; index++) {
					const id = secondary[index];
					if (!values.has(id) || ordered.includes(id)) continue;
					let position = -1;
					for (let previous = index - 1; previous >= 0; previous--) {
						const anchor = ordered.indexOf(secondary[previous]);
						if (anchor >= 0) { position = anchor + 1; break; }
					}
					if (position < 0) {
						for (let next = index + 1; next < secondary.length; next++) {
							const anchor = ordered.indexOf(secondary[next]);
							if (anchor >= 0) { position = anchor; break; }
						}
					}
					ordered.splice(position < 0 ? ordered.length : position, 0, id);
				}
				return ordered.map((id) => values.get(id)!);
			};
			if (localReordered && incomingReordered && !equal(localOrder, incomingOrder)) return resolveOrder();
			const chosenBase = localReordered ? localOrder : incomingReordered ? incomingOrder : survivingBase;
			const edges = new Map([...values.keys()].map((id) => [id, new Set<string>()]));
			const indegree = new Map([...values.keys()].map((id) => [id, 0]));
			const edge = (left: string, right: string) => { const next = edges.get(left)!; if (left !== right && !next.has(right)) { next.add(right); indegree.set(right, indegree.get(right)! + 1); } };
			for (let i = 1; i < chosenBase.length; i++) edge(chosenBase[i - 1], chosenBase[i]);
			for (const sequence of [localIds, incomingIds]) {
				const present = sequence.filter((id) => values.has(id));
				for (let i = 1; i < present.length; i++) if (!baseMap.has(present[i - 1]) || !baseMap.has(present[i])) edge(present[i - 1], present[i]);
			}
			const priority = [...new Set([...localIds, ...incomingIds, ...baseIds])];
			const ordered: string[] = [];
			while (ordered.length < values.size) {
				const next = priority.find((id) => indegree.get(id) === 0);
				if (!next) return resolveOrder();
				ordered.push(next); indegree.delete(next);
				for (const following of edges.get(next)!) indegree.set(following, indegree.get(following)! - 1);
			}
			return ordered.map((id) => values.get(id)!);
		}
		if (record(baseValue) && record(localValue) && record(incomingValue)) {
			// Do not mix edits across component replacements or linked section snapshots.
			if (('type' in baseValue && (localValue.type !== baseValue.type || incomingValue.type !== baseValue.type)) || 'sharedSection' in localValue || 'sharedSection' in incomingValue) return conflict(path, baseValue, localValue, incomingValue, 'structural');
			const keys = new Set([...Object.keys(baseValue), ...Object.keys(localValue), ...Object.keys(incomingValue)]);
			const result: Record<string, unknown> = {};
			// Ranges are positions in their corresponding text, so they must never be
			// independently combined with text from another version. List item hrefs
			// are coupled too, to prevent combining whole-item and inline links.
			for (const [textKey, marksKey, name] of [['text', 'marks', 'formattedText'], ['title', 'titleMarks', 'formattedTitle'], ['body', 'bodyMarks', 'formattedBody']] as const) {
				if (![baseValue, localValue, incomingValue].every((value) => typeof value[textKey] === 'string') || ![baseValue, localValue, incomingValue].some((value) => Object.hasOwn(value, marksKey))) continue;
				const withHref = textKey === 'text' && [baseValue, localValue, incomingValue].every((value) => typeof value.href === 'string');
				const content = (value: Record<string, unknown>) => ({ text: value[textKey], marks: value[marksKey] ?? [], ...(withHref ? { href: value.href } : {}) });
				const baseContent = content(baseValue); const localContent = content(localValue); const incomingContent = content(incomingValue);
				if (!equal(localContent, baseContent) && !equal(incomingContent, baseContent) && !equal(localContent, incomingContent)) {
					const selected = conflict(`${path}.${name}`, baseContent, localContent, incomingContent, 'formatted') as Record<string, unknown>;
					result[textKey] = selected.text;
					if (Array.isArray(selected.marks) && selected.marks.length) result[marksKey] = selected.marks;
					if (withHref) result.href = selected.href;
					keys.delete(textKey); keys.delete(marksKey); if (withHref) keys.delete('href');
				}
			}
			for (const key of keys) {
				const value = merge(has(baseValue, key), has(localValue, key), has(incomingValue, key), path ? `${path}.${key}` : key);
				if (value !== MISSING) result[key] = value;
			}
			return result;
		}
		return conflict(path, baseValue, localValue, incomingValue);
	}
	const merged = merge(base, local, incoming, '');
	if (conflicts.length) return { ok: false, conflicts, fields, truncated };
	try { return { ok: true, document: validatePageDocument(merged, base.slug) }; }
	catch { return { ok: false, conflicts: ['document'], fields: [], truncated: false }; }
}
