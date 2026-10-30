import { Parser } from 'htmlparser2';
import { mappedMigrationMedia, type MigrationMediaMap } from './media-map.ts';
import { InlineHtmlCollector, type CollectedText } from './inline-html.ts';
import { sliceMarkedText, splitMarkedText, isTextBoundary } from '../builder/rich-text.ts';
import { createBuilderNode } from '../builder/operations.ts';
import type { BuilderNode, ListItem } from '../builder/types.ts';

const MAX_BYTES = 1024 * 1024;

const cleanText = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

/** Convert bounded HTML into editable host-owned nodes; source markup is never rendered. */
export function htmlToBuilderNodes(html: string, mediaMap?: MigrationMediaMap, report?: (code: string, message: string) => void): BuilderNode[] {
	if (new TextEncoder().encode(html).byteLength > MAX_BYTES) throw new Error('حجم HTML بیش از حد مجاز است.');
	const nodes: BuilderNode[] = [];
	const collector = new InlineHtmlCollector();
	let heading: 1 | 2 | 3 | 4 | null = null;
	let tagCount = 0;
	let depth = 0;
	let skipDepth = 0;
	let quoteDepth = 0;
	let anchorDepth = 0;
	type ListFrame = { kind: 'ordered' | 'unordered'; items: ListItem[]; itemOpen: boolean; itemHasContent: boolean };
	const lists: ListFrame[] = [];
	let listItemNumber = 0;
	const push = (node: BuilderNode) => {
		nodes.push(node);
		if (nodes.length > 200) throw new Error('محتوای تبدیل‌شده بیش از ۲۰۰ مؤلفه دارد.');
	};
	const safeEnd = (value: string, max: number) => {
		let end = Math.min(max, value.length);
		if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
		return end;
	};
	const emitText = (content: CollectedText) => {
		if (!content.text) return;
		for (const part of splitMarkedText(content.text, content.marks)) {
			const node = createBuilderNode('Text');
			node.props.text = part.text;
			if (part.marks.length) node.props.marks = part.marks;
			push(node);
		}
	};
	const emitList = (frame: ListFrame) => {
		if (frame.items.length > 24) report?.('list-split', 'فهرست بلند به چند فهرست بومی تقسیم شد.');
		for (let offset = 0; offset < frame.items.length; offset += 24) {
			const list = createBuilderNode('List'); list.props.kind = frame.kind; list.props.items = frame.items.slice(offset, offset + 24); push(list);
		}
		frame.items = [];
	};
	const sliceContent = (content: CollectedText, start: number, end: number): CollectedText => sliceMarkedText(content.text, content.marks, start, end);
	const fullLink = (content: CollectedText) => content.marks.find((mark) => mark.kind === 'link' && mark.start === 0 && mark.end === content.text.length);
	const flush = () => {
		const content = collector.take();
		if (!content.text) return;
		const frame = lists.at(-1);
		if (frame) {
			frame.itemHasContent = true;
			const listParts = splitMarkedText(content.text, content.marks);
			if (listParts.length > 1) report?.('list-item-split', 'متن بلند مورد فهرست بدون حذف به چند مورد تقسیم شد.');
			for (const part of listParts) {
				const link = fullLink(part);
				const marks = link ? part.marks.filter((mark) => mark !== link) : part.marks;
				frame.items.push({ id: `item_${String(listItemNumber++).padStart(4, '0')}`, text: part.text, href: link?.kind === 'link' ? link.href : '', ...(marks.length ? { marks } : {}) });
			}
		} else if (heading) {
			const end = safeEnd(content.text, 240);
			if (end < content.text.length) report?.('heading-split', 'ادامهٔ تیتر بلند به متن جدا تبدیل شد.');
			const first = sliceContent(content, 0, end);
			const node = createBuilderNode('Heading');
			node.props.text = first.text;
			if (first.marks.length) node.props.marks = first.marks;
			node.props.level = heading;
			push(node);
			emitText(sliceContent(content, end, content.text.length));
		} else {
			const link = fullLink(content);
			if (content.marks.length === 1 && link?.kind === 'link' && content.text.length <= 80) {
				const node = createBuilderNode('Button');
				node.props.label = content.text;
				node.props.href = link.href;
				node.props.variant = 'outline';
				push(node);
			} else emitText(content);
		}
	};
	const flushQuote = () => {
		const content = collector.take();
		if (!content.text) return;
		for (const part of splitMarkedText(content.text, content.marks)) {
			const node = createBuilderNode('Blockquote');
			node.props.text = part.text;
			if (part.marks.length) node.props.marks = part.marks;
			push(node);
		}
	};
	const quoteBreak = () => collector.appendBreak();
	const pushImage = (attributes: Record<string, string>) => {
		const image = createBuilderNode('Image');
		if (anchorDepth) report?.('image-link-omitted', 'پیوند تصویر منتقل نشد؛ تصویر بومی به‌تنهایی کلیک‌پذیر نیست.');
		const alt = cleanText(attributes.alt ?? '');
		let end = Math.min(240, alt.length); if (!isTextBoundary(alt, end)) end--;
		image.props.alt = alt.slice(0, end);
		if (end < alt.length) report?.('image-alt-truncated', 'متن جایگزین تصویر به محدودیت سند کوتاه شد.');
		const explicitId = /^[1-9][0-9]{0,19}$/.test(attributes['data-attachment-id'] ?? '') ? attributes['data-attachment-id'] : undefined;
		const classId = /(?:^|\s)wp-image-([1-9][0-9]{0,19})(?=\s|$)/.exec(attributes.class ?? '')?.[1];
		if (mediaMap?.size && explicitId && classId && explicitId !== classId) throw new Error('شناسه‌های منبع یک تصویر با هم تعارض دارند.');
		image.props.src = mappedMigrationMedia(mediaMap, { id: explicitId ?? classId, url: attributes.src }) ?? '';
		if (!image.props.src) report?.('image-unmapped', 'تصویر بدون نگاشت محلی به جای‌نگهدار تبدیل شد.');
		push(image);
	};
	const blocks = new Set(['p', 'div', 'section', 'article', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
	const supported = new Set([...blocks, 'ul', 'ol', 'br', 'strong', 'b', 'em', 'i', 'a', 'span', 'img']);
	const parser = new Parser({
		onopentag(name, attributes) {
			if (++tagCount > 20_000 || ++depth > 64) throw new Error('ساختار HTML واردشده بیش از حد مجاز است.');
			if (skipDepth) { skipDepth++; return; }
			if (['script', 'style', 'iframe', 'object', 'template', 'svg', 'math'].includes(name)) { skipDepth = 1; report?.('unsupported-active', 'محتوای فعال یا جاسازی‌شده برای ایمنی منتقل نشد.'); return; }
			if (!supported.has(name) || Object.keys(attributes).some((key) => name === 'a' ? key !== 'href' : name === 'img' ? !['src', 'alt', 'data-attachment-id'].includes(key) : true)) report?.('unsupported-rich-markup', 'بعضی ساختارها، سبک‌ها یا گزینه‌های پیشرفتهٔ محتوا منتقل نشدند.');
			if (quoteDepth && (name === 'ul' || name === 'ol')) report?.('quote-list', 'فهرست داخل نقل‌قول به متن تقریبی تبدیل شد.');
			if (name === 'a') anchorDepth++;
			if (name === 'h5' || name === 'h6') report?.('heading-level', 'سطح تیتر H5 یا H6 به H4 تبدیل شد.');
			if (name === 'blockquote' && !quoteDepth) { flush(); const frame = lists.at(-1); if (frame) { frame.itemHasContent = true; emitList(frame); } heading = null; quoteDepth = depth; return; }
			if (quoteDepth) {
				if (name === 'img') { flushQuote(); pushImage(attributes); }
				else if (blocks.has(name) || name === 'br') quoteBreak();
				if (collector.open(name, attributes) === 'unsafe-link') report?.('unsafe-link', 'پیوند ناامن حذف شد و متن آن حفظ شد.');
				return;
			}
			if (name === 'ul' || name === 'ol') {
				flush();
				const parent = lists.at(-1); if (parent) { report?.('nested-list', 'ساختار فهرست تودرتو به فهرست‌های متوالی تبدیل شد.'); parent.itemHasContent = true; emitList(parent); }
				lists.push({ kind: name === 'ol' ? 'ordered' : 'unordered', items: [], itemOpen: false, itemHasContent: false }); heading = null; return;
			}
			if (name === 'li' && lists.length) {
				flush(); const frame = lists.at(-1)!; frame.itemOpen = true; frame.itemHasContent = false; heading = null; return;
			}
			if (blocks.has(name)) {
				flush();
				const match = /^h([1-6])$/.exec(name);
				heading = match ? Math.min(4, Number(match[1])) as 1 | 2 | 3 | 4 : null;
			}
			if (name === 'br') collector.append('\n');
			if (collector.open(name, attributes) === 'unsafe-link') report?.('unsafe-link', 'پیوند ناامن حذف شد و متن آن حفظ شد.');
			if (name === 'img') { flush(); const frame = lists.at(-1); if (frame) { frame.itemHasContent = true; emitList(frame); } pushImage(attributes); }
		},
		ontext(value) {
			if (skipDepth) return;
			collector.append(value);
		},
		onclosetag(name) {
			depth--;
			if (skipDepth) { skipDepth--; return; }
			if (name === 'a') anchorDepth = Math.max(0, anchorDepth - 1);
			if (quoteDepth) {
				collector.close(name);
				if (name === 'blockquote' && depth < quoteDepth) { flushQuote(); quoteDepth = 0; }
				else if (blocks.has(name)) quoteBreak();
				return;
			}
			collector.close(name);
			if (name === 'ul' || name === 'ol') { flush(); const frame = lists.pop(); if (frame) emitList(frame); return; }
			if (name === 'li' && lists.length) {
				flush(); const frame = lists.at(-1)!;
				if (frame.itemOpen && !frame.itemHasContent) frame.items.push({ id: `item_${String(listItemNumber++).padStart(4, '0')}`, text: '', href: '' });
				frame.itemOpen = false; heading = null; return;
			}
			if (blocks.has(name)) { flush(); heading = null; }
		},
	}, { decodeEntities: true });
	parser.write(html);
	parser.end();
	if (quoteDepth) flushQuote();
	flush();
	for (const frame of lists.reverse()) emitList(frame);
	return nodes;
}
