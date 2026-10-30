import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Parser } from 'htmlparser2';
import { safeHref } from '../../builder/registry.ts';
import { createEmptyPageDocument, isValidPageSlug, validatePageDocument } from '../../builder/document.ts';
import { createBuilderNode } from '../../builder/operations.ts';
import type { BuilderNode, PageDocument } from '../../builder/types.ts';

const MAX_BYTES = 1024 * 1024;
const MAX_ITEMS = 200;
export interface WxrItem {
	id: string;
	type: 'page' | 'post';
	title: string;
	slug: string;
	status: string;
	content: string;
	excerpt: string;
	warnings: string[];
}
export interface WxrInspection { version: string; items: WxrItem[]; ignored: number }
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const asText = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

/** Bound XML structure before handing it to the parser. CDATA and quoted attributes
 * must not be mistaken for markup. The validator still checks well-formedness. */
function assertXmlLimits(xml: string): void {
	let depth = 0;
	let tags = 0;
	let cursor = 0;
	while (cursor < xml.length) {
		const start = xml.indexOf('<', cursor);
		if (start < 0) break;
		if (xml.startsWith('<!--', start) || xml.startsWith('<![CDATA[', start) || xml.startsWith('<?', start)) {
			const terminator = xml.startsWith('<!--', start) ? '-->' : xml.startsWith('<![CDATA[', start) ? ']]>' : '?>';
			const end = xml.indexOf(terminator, start + 2);
			if (end < 0) throw new Error('فایل XML معتبر نیست.');
			cursor = end + terminator.length;
			continue;
		}
		let quote = '';
		let end = start + 1;
		for (; end < xml.length; end++) {
			const char = xml[end];
			if (quote) { if (char === quote) quote = ''; }
			else if (char === '"' || char === "'") quote = char;
			else if (char === '>') break;
		}
		if (end === xml.length) throw new Error('فایل XML معتبر نیست.');
		const tag = xml.slice(start + 1, end).trim();
		if (++tags > 20_000) throw new Error('تعداد برچسب‌های XML بیش از حد مجاز است.');
		if (tag.startsWith('/')) depth--;
		else if (!tag.endsWith('/') && !tag.startsWith('!')) depth++;
		if (depth > 64 || depth < 0) throw new Error('عمق ساختار XML بیش از حد مجاز یا نامعتبر است.');
		cursor = end + 1;
	}
}

/** Bounded local inspection: no DTDs, remote requests, script execution or file writes. */
export function inspectWxr(xml: string): WxrInspection {
	if (new TextEncoder().encode(xml).byteLength > MAX_BYTES) throw new Error('حجم فایل نباید بیش از ۱ مگابایت باشد.');
	if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('DTD و موجودیت‌های سفارشی پشتیبانی نمی‌شوند.');
	assertXmlLimits(xml);
	if (XMLValidator.validate(xml) !== true) throw new Error('فایل XML معتبر نیست.');
	let raw: unknown;
	try {
		raw = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: false, processEntities: true }).parse(xml);
	} catch { throw new Error('فایل XML قابل خواندن نیست.'); }
	if (!isObject(raw) || !isObject(raw.rss) || !isObject(raw.rss.channel)) throw new Error('ساختار فایل WXR معتبر نیست.');
	const channel = raw.rss.channel;
	const version = asText(channel['wp:wxr_version']).trim();
	if (!/^1\.[0-9]+$/.test(version)) throw new Error('نسخهٔ WXR نامعتبر یا پشتیبانی‌نشده است.');
	const entries = channel.item === undefined ? [] : Array.isArray(channel.item) ? channel.item : [channel.item];
	if (entries.length > MAX_ITEMS) throw new Error('فایل بیش از ۲۰۰ مورد دارد.');
	let ignored = 0;
	const items: WxrItem[] = [];
	for (const entry of entries) {
		if (!isObject(entry)) throw new Error('ساختار یکی از موارد WXR معتبر نیست.');
		const type = asText(entry['wp:post_type']);
		if (type !== 'page' && type !== 'post') { ignored++; continue; }
		const title = asText(entry.title).trim().slice(0, 100) || 'بدون عنوان';
		const content = asText(entry['content:encoded']);
		const excerpt = asText(entry['excerpt:encoded']);
		const warnings = ['تیترها، متن و بعضی پیوندهای مستقل تقریبی تبدیل می‌شوند؛ قالب‌بندی، فهرست‌ها و پیوندهای درون متن را بررسی کنید.', 'این مورد به صفحهٔ پیش‌نویس صفحه‌ساز تبدیل می‌شود، نه نوشتهٔ وبلاگ.'];
		if (/<(?:img|video|audio|iframe|object)\b/i.test(content) || entry['wp:attachment_url']) warnings.push('رسانه منتقل نمی‌شود؛ از کتابخانهٔ رسانه انتخاب کنید.');
		if (/<a\b/i.test(content)) warnings.push('فقط پیوندهای ایمن و مستقل با متن کوتاه به دکمه تبدیل می‌شوند؛ بقیهٔ پیوندها و گزینه‌هایشان را بررسی کنید.');
		if (/<h[1-6]\b/i.test(content)) warnings.push('تیترهای بلند به متن تقسیم می‌شوند و سطح H5 و H6 به H4 تبدیل می‌شود.');
		if (entry.category || entry['wp:postmeta']) warnings.push('دسته‌ها، برچسب‌ها و فرادادهٔ وردپرس منتقل نمی‌شوند.');
		items.push({ id: asText(entry['wp:post_id']).slice(0, 80), type, title, slug: asText(entry['wp:post_name']).slice(0, 120), status: asText(entry['wp:status']).slice(0, 40), content, excerpt, warnings });
	}
	return { version, items, ignored };
}

const cleanText = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

/** Convert bounded HTML into editable host-owned nodes; source markup is never rendered. */
function htmlToNodes(html: string): BuilderNode[] {
	const nodes: BuilderNode[] = [];
	let text = '';
	let heading: 1 | 2 | 3 | 4 | null = null;
	let tagCount = 0;
	let depth = 0;
	let skipDepth = 0;
	let anchor: { href: string; text: string } | null = null;
	let links: Array<{ href: string; text: string }> = [];
	const push = (node: BuilderNode) => {
		nodes.push(node);
		if (nodes.length > 200) throw new Error('محتوای تبدیل‌شده بیش از ۲۰۰ مؤلفه دارد.');
	};
	const safeEnd = (value: string, max: number) => {
		let end = Math.min(max, value.length);
		if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
		return end;
	};
	const emitText = (content: string) => {
		let rest = content;
		while (rest.length) {
			const end = safeEnd(rest, 5000);
			const node = createBuilderNode('Text');
			node.props.text = rest.slice(0, end);
			push(node);
			rest = rest.slice(end);
		}
	};
	const flush = () => {
		const content = cleanText(text).trim();
		if (content) {
			if (heading) {
				const end = safeEnd(content, 240);
				const node = createBuilderNode('Heading');
				node.props.text = content.slice(0, end);
				node.props.level = heading;
				push(node);
				emitText(content.slice(end));
			} else if (links.length === 1 && links[0].text.trim() === content && content.length <= 80 && links[0].href.length <= 500 && safeHref(links[0].href) && links[0].href) {
				const node = createBuilderNode('Button');
				node.props.label = content;
				node.props.href = links[0].href;
				node.props.variant = 'outline';
				push(node);
			} else emitText(content);
		}
		text = '';
		links = [];
		anchor = null;
	};
	const blocks = new Set(['p', 'div', 'section', 'article', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
	const parser = new Parser({
		onopentag(name, attributes) {
			if (++tagCount > 20_000 || ++depth > 64) throw new Error('ساختار HTML واردشده بیش از حد مجاز است.');
			if (skipDepth) { skipDepth++; return; }
			if (['script', 'style', 'iframe', 'object', 'template', 'svg', 'math'].includes(name)) { skipDepth = 1; return; }
			if (blocks.has(name)) {
				flush();
				const match = /^h([1-6])$/.exec(name);
				heading = match ? Math.min(4, Number(match[1])) as 1 | 2 | 3 | 4 : null;
			}
			if (name === 'br') text += '\n';
			if (name === 'a') anchor = { href: attributes.href ?? '', text: '' };
			if (name === 'img') {
				flush();
				const image = createBuilderNode('Image');
				image.props.alt = cleanText(attributes.alt ?? '').slice(0, 240);
				push(image);
			}
		},
		ontext(value) {
			if (skipDepth) return;
			text += value;
			if (anchor) anchor.text += value;
		},
		onclosetag(name) {
			depth--;
			if (skipDepth) { skipDepth--; return; }
			if (name === 'a' && anchor) { links.push(anchor); anchor = null; }
			if (blocks.has(name)) { flush(); heading = null; }
		},
	}, { decodeEntities: true });
	parser.write(html);
	parser.end();
	flush();
	return nodes;
}

/** Convert into native editable nodes without mutating or publishing the target. */
export function wxrItemToDocument(item: WxrItem, target: PageDocument): PageDocument {
	return validatePageDocument({ ...target, nodes: htmlToNodes(item.content) }, target.slug);
}

/** Convert all inspected entries into distinct drafts without changing an existing page. */
export function wxrToDraftPages(inspection: WxrInspection, prefix: string): PageDocument[] {
	if (!isValidPageSlug(prefix)) throw new Error('پیشوند نامک معتبر نیست.');
	if (!Array.isArray(inspection.items) || !inspection.items.length || inspection.items.length > 20) throw new Error('برای ساخت گروهی، فایل باید بین ۱ تا ۲۰ صفحه یا نوشته داشته باشد.');
	return inspection.items.map((item, index) => {
		const slug = `${prefix}-${index + 1}`;
		if (!isValidPageSlug(slug)) throw new Error('نامک تولیدشده بیش از حد طولانی است.');
		const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 100) : 'بدون عنوان';
		return wxrItemToDocument(item, createEmptyPageDocument(slug, title));
	});
}
