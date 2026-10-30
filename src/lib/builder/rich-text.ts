import { safeHref } from './link-safety.ts';
import type { TextMark } from './types.ts';

export const MAX_TEXT_MARKS = 100;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Offsets are UTF-16 positions, as used by textarea selections and JavaScript strings. */
export function isTextBoundary(text: string, offset: number): boolean {
	return Number.isInteger(offset) && offset >= 0 && offset <= text.length && !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
}

/** Strictly validate and canonicalize safe, nonempty inline ranges. */
export function normalizeTextMarks(text: string, input: unknown): TextMark[] {
	if (!Array.isArray(input) || input.length > MAX_TEXT_MARKS) throw new Error(`Text formatting must have at most ${MAX_TEXT_MARKS} ranges.`);
	const marks: TextMark[] = input.map((value: unknown) => {
		if (!isRecord(value) || (value.kind !== 'bold' && value.kind !== 'italic' && value.kind !== 'link')) throw new Error('Text formatting range is invalid.');
		const kind = value.kind as TextMark['kind'];
		const allowed = kind === 'link' ? ['kind', 'start', 'end', 'href'] : ['kind', 'start', 'end'];
		if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Text formatting range has an unsupported property.');
		if (typeof value.start !== 'number' || typeof value.end !== 'number' || !isTextBoundary(text, value.start) || !isTextBoundary(text, value.end) || value.start >= value.end) throw new Error('Text formatting range is outside the text or splits a Unicode character.');
		if (kind === 'link') {
			if (typeof value.href !== 'string' || !safeHref(value.href)) throw new Error('Text link must be a safe HTTP(S), internal or fragment URL.');
			return { kind, start: value.start, end: value.end, href: value.href.trim() };
		}
		return { kind, start: value.start, end: value.end };
	});

	const result: TextMark[] = [];
	for (const kind of ['bold', 'italic', 'link'] as const) {
		const ordered = marks.filter((mark) => mark.kind === kind).sort((a, b) => a.start - b.start || a.end - b.end);
		for (const mark of ordered) {
			const previous = result.at(-1);
			if (previous?.kind === kind && mark.start <= previous.end) {
				if (previous.kind === 'link' && mark.kind === 'link' && previous.href !== mark.href) {
					if (mark.start < previous.end) throw new Error('Text links cannot overlap.');
					result.push(mark);
				} else previous.end = Math.max(previous.end, mark.end);
			} else result.push(mark);
		}
	}
	return result.sort((a, b) => a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind));
}

export interface TextRun { text: string; bold: boolean; italic: boolean; href?: string }

/** Renderers consume text runs, never source HTML or arbitrary attributes. */
export function textRuns(text: string, marks: readonly TextMark[] = []): TextRun[] {
	const valid = normalizeTextMarks(text, marks);
	const boundaries = [...new Set([0, text.length, ...valid.flatMap((mark) => [mark.start, mark.end])])].sort((a, b) => a - b);
	const runs: TextRun[] = [];
	for (let index = 1; index < boundaries.length; index++) {
		const start = boundaries[index - 1];
		const end = boundaries[index];
		if (start === end) continue;
		const active = valid.filter((mark) => mark.start <= start && mark.end >= end);
		const link = active.find((mark): mark is Extract<TextMark, { kind: 'link' }> => mark.kind === 'link');
		const run: TextRun = { text: text.slice(start, end), bold: active.some((mark) => mark.kind === 'bold'), italic: active.some((mark) => mark.kind === 'italic'), ...(link ? { href: link.href } : {}) };
		const previous = runs.at(-1);
		if (previous && previous.bold === run.bold && previous.italic === run.italic && previous.href === run.href) previous.text += run.text;
		else runs.push(run);
	}
	return runs;
}

/** Preserve unaffected ranges across a single replacement derived from a text edit.
 * Inserted text inherits a mark only when the entire replaced range was inside it. */
export function adjustTextMarks(previousText: string, nextText: string, marks: readonly TextMark[] = []): TextMark[] {
	const valid = normalizeTextMarks(previousText, marks);
	if (previousText === nextText || !valid.length) return valid;
	let start = 0;
	while (start < previousText.length && start < nextText.length && previousText[start] === nextText[start]) start++;
	while (start > 0 && (!isTextBoundary(previousText, start) || !isTextBoundary(nextText, start))) start--;
	let oldEnd = previousText.length;
	let newEnd = nextText.length;
	while (oldEnd > start && newEnd > start && previousText[oldEnd - 1] === nextText[newEnd - 1]) { oldEnd--; newEnd--; }
	while (oldEnd < previousText.length && newEnd < nextText.length && (!isTextBoundary(previousText, oldEnd) || !isTextBoundary(nextText, newEnd))) { oldEnd++; newEnd++; }
	const inserted = newEnd - start;
	const delta = newEnd - oldEnd;
	const changed: TextMark[] = [];
	for (const mark of valid) {
		if (mark.end <= start) { changed.push({ ...mark }); continue; }
		if (mark.start >= oldEnd) { changed.push({ ...mark, start: mark.start + delta, end: mark.end + delta }); continue; }
		if (mark.start <= start && mark.end >= oldEnd) {
			const end = mark.end + delta;
			if (mark.start < end) changed.push({ ...mark, end });
			continue;
		}
		if (mark.start < start) changed.push({ ...mark, end: start });
		if (mark.end > oldEnd) changed.push({ ...mark, start: start + inserted, end: mark.end + delta });
	}
	return normalizeTextMarks(nextText, changed);
}

/** Toggle bold/italic or apply a link over a selected range. Existing link ranges
 * outside the selection survive; overlapping links can never be created. */
export function setTextMark(text: string, marks: readonly TextMark[], start: number, end: number, kind: TextMark['kind'], href?: string): TextMark[] {
	const valid = normalizeTextMarks(text, marks);
	if (!isTextBoundary(text, start) || !isTextBoundary(text, end) || start >= end) throw new Error('ابتدا بخشی از متن را انتخاب کنید.');
	if (kind === 'link' && (typeof href !== 'string' || !safeHref(href))) throw new Error('نشانی پیوند باید داخلی، پیوند صفحه یا HTTP(S) ایمن باشد.');
	const remove = kind !== 'link' && valid.some((mark) => mark.kind === kind && mark.start <= start && mark.end >= end);
	const result: TextMark[] = [];
	for (const mark of valid) {
		if (mark.kind !== kind || mark.end <= start || mark.start >= end || (!remove && kind !== 'link')) { result.push({ ...mark }); continue; }
		if (mark.start < start) result.push({ ...mark, end: start });
		if (mark.end > end) result.push({ ...mark, start: end });
	}
	if (!remove) result.push(kind === 'link' ? { kind, start, end, href: href!.trim() } : { kind, start, end });
	return normalizeTextMarks(text, result);
}

/** Remove one kind of formatting in a selection without modifying surrounding text. */
export function clearTextMark(text: string, marks: readonly TextMark[], start: number, end: number, kind: TextMark['kind']): TextMark[] {
	const valid = normalizeTextMarks(text, marks);
	if (!isTextBoundary(text, start) || !isTextBoundary(text, end) || start >= end) throw new Error('ابتدا بخشی از متن را انتخاب کنید.');
	const result: TextMark[] = [];
	for (const mark of valid) {
		if (mark.kind !== kind || mark.end <= start || mark.start >= end) { result.push({ ...mark }); continue; }
		if (mark.start < start) result.push({ ...mark, end: start });
		if (mark.end > end) result.push({ ...mark, start: end });
	}
	return normalizeTextMarks(text, result);
}

/** Clip source ranges to a Unicode-safe slice without interpreting markup. */
export function sliceMarkedText(text: string, marks: readonly TextMark[], start: number, end: number): { text: string; marks: TextMark[] } {
	if (!isTextBoundary(text, start) || !isTextBoundary(text, end) || start > end) throw new Error('Invalid text slice boundary.');
	return {
		text: text.slice(start, end),
		marks: marks.filter((mark) => mark.start < end && mark.end > start).map((mark) => ({ ...mark, start: Math.max(mark.start, start) - start, end: Math.min(mark.end, end) - start })),
	};
}

/** Split long imported text without losing formatting or splitting surrogate pairs. */
export function splitMarkedText(text: string, marks: readonly TextMark[], limit = 5000): Array<{ text: string; marks: TextMark[] }> {
	if (!Number.isInteger(limit) || limit < 2 || limit > 5000) throw new Error('Invalid text chunk limit.');
	if (marks.length > 20_000) throw new Error('Too many imported text ranges.');
	for (const mark of marks) normalizeTextMarks(text, [mark]);
	const chunks: Array<{ text: string; marks: TextMark[] }> = [];
	for (let offset = 0; offset < text.length;) {
		let end = Math.min(offset + limit, text.length);
		if (!isTextBoundary(text, end)) end--;
		const part = text.slice(offset, end);
		const ranges = marks.filter((mark) => mark.start < end && mark.end > offset).map((mark) => ({ ...mark, start: Math.max(mark.start, offset) - offset, end: Math.min(mark.end, end) - offset }));
		chunks.push({ text: part, marks: normalizeTextMarks(part, ranges) });
		offset = end;
		if (chunks.length > 200) throw new Error('متن تبدیل‌شده بیش از ظرفیت ۲۰۰ مؤلفه است؛ فایل اصلی تغییر نکرد.');
	}
	return chunks.length ? chunks : [{ text: '', marks: [] }];
}
