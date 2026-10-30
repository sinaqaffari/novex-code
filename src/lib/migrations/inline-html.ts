import { Parser } from 'htmlparser2';
import { safeHref } from '../builder/link-safety.ts';
import type { TextMark } from '../builder/types.ts';

const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
interface OpenMark { tag: string; start: number; kind?: TextMark['kind']; href?: string }
export interface CollectedText { text: string; marks: TextMark[] }

/** Accumulate only text and an allowlist of semantic ranges. No source HTML,
 * attributes other than href, styles or executable content are retained. */
export class InlineHtmlCollector {
	private text = '';
	private completed: TextMark[] = [];
	private openMarks: OpenMark[] = [];

	append(value: string): void { this.text += clean(value); }
	appendBreak(): void { if (this.text && !this.text.endsWith('\n')) this.text += '\n'; }

	open(tag: string, attributes: Record<string, string>): 'unsafe-link' | null {
		const kind = tag === 'strong' || tag === 'b' ? 'bold' : tag === 'em' || tag === 'i' ? 'italic' : tag === 'a' ? 'link' : undefined;
		if (!kind) return null;
		const href = attributes.href ?? '';
		const invalid = kind === 'link' && (!safeHref(href) || this.openMarks.some((mark) => mark.kind === 'link'));
		this.openMarks.push({ tag, start: this.text.length, ...(invalid ? {} : { kind }), ...(kind === 'link' && !invalid ? { href: href.trim() } : {}) });
		return invalid ? 'unsafe-link' : null;
	}

	close(tag: string): void {
		let index = this.openMarks.length - 1;
		while (index >= 0 && this.openMarks[index].tag !== tag) index--;
		if (index < 0) return;
		const [mark] = this.openMarks.splice(index, 1);
		const converted = this.finish(mark, this.text.length);
		if (converted) this.completed.push(converted);
	}

	private finish(mark: OpenMark, end: number): TextMark | null {
		if (!mark.kind || mark.start >= end) return null;
		return mark.kind === 'link' ? { kind: 'link', start: mark.start, end, href: mark.href! } : { kind: mark.kind, start: mark.start, end };
	}

	/** Flush one block, retaining open marks across a block boundary. */
	take(): CollectedText {
		const raw = this.text;
		const start = raw.length - raw.trimStart().length;
		const end = raw.trimEnd().length;
		const text = raw.slice(start, Math.max(start, end));
		const all = [...this.completed, ...this.openMarks.map((mark) => this.finish(mark, raw.length)).filter((mark): mark is TextMark => mark !== null)];
		const marks = all.filter((mark) => mark.start < end && mark.end > start).map((mark) => ({ ...mark, start: Math.max(mark.start, start) - start, end: Math.min(mark.end, end) - start }));
		this.text = '';
		this.completed = [];
		this.openMarks = this.openMarks.map((mark) => ({ ...mark, start: 0 }));
		return { text, marks };
	}
}

export interface InlineHtmlResult extends CollectedText { unsafeLinks: boolean; unsupportedMarkup: boolean }

/** Bounded local HTML-to-text conversion for Elementor text-editor widgets. */
export function parseInlineHtml(input: string): InlineHtmlResult {
	if (new TextEncoder().encode(input).byteLength > 1024 * 1024) throw new Error('حجم HTML بیش از حد مجاز است.');
	const collector = new InlineHtmlCollector();
	let depth = 0;
	let count = 0;
	let skipped = 0;
	let unsafeLinks = false;
	let unsupportedMarkup = false;
	const blocks = new Set(['p', 'div', 'section', 'article', 'li', 'ul', 'ol', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre']);
	const supported = new Set([...blocks, 'br', 'strong', 'b', 'em', 'i', 'a', 'span']);
	const parser = new Parser({
		onopentag(name, attributes) {
			if (++count > 20_000 || ++depth > 64) throw new Error('ساختار HTML واردشده بیش از حد مجاز است.');
			if (skipped) { skipped++; return; }
			if (['script', 'style', 'iframe', 'object', 'template', 'svg', 'math'].includes(name)) { skipped = 1; unsupportedMarkup = true; return; }
			if (!supported.has(name) || ['ul', 'ol', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(name) || Object.keys(attributes).some((key) => name !== 'a' || key !== 'href')) unsupportedMarkup = true;
			if (name === 'br') collector.append('\n');
			if (collector.open(name, attributes) === 'unsafe-link') unsafeLinks = true;
		},
		ontext(value) { if (!skipped) collector.append(value); },
		onclosetag(name) {
			depth--;
			if (skipped) { skipped--; return; }
			collector.close(name);
			if (blocks.has(name)) collector.append('\n');
		},
	}, { decodeEntities: true });
	parser.write(input);
	parser.end();
	return { ...collector.take(), unsafeLinks, unsupportedMarkup };
}
