import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { validatePageDocument } from '../../builder/document.ts';
import { createBuilderNode } from '../../builder/operations.ts';
import type { PageDocument } from '../../builder/types.ts';

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

/** Bounded local inspection: no DTDs, remote requests, script execution or file writes. */
export function inspectWxr(xml: string): WxrInspection {
	if (new TextEncoder().encode(xml).byteLength > MAX_BYTES) throw new Error('حجم فایل نباید بیش از ۱ مگابایت باشد.');
	if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('DTD و موجودیت‌های سفارشی پشتیبانی نمی‌شوند.');
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
		const warnings = ['محتوا فقط به متن ساده تبدیل می‌شود؛ قالب‌بندی، پیوندها و بلوک‌ها را بررسی کنید.', 'این مورد به صفحهٔ پیش‌نویس صفحه‌ساز تبدیل می‌شود، نه نوشتهٔ وبلاگ.'];
		if (/<(?:img|video|audio|iframe|object)\b/i.test(content) || entry['wp:attachment_url']) warnings.push('رسانه منتقل نمی‌شود؛ از کتابخانهٔ رسانه انتخاب کنید.');
		if (entry.category || entry['wp:postmeta']) warnings.push('دسته‌ها، برچسب‌ها و فرادادهٔ وردپرس منتقل نمی‌شوند.');
		items.push({ id: asText(entry['wp:post_id']).slice(0, 80), type, title, slug: asText(entry['wp:post_name']).slice(0, 120), status: asText(entry['wp:status']).slice(0, 40), content, excerpt, warnings });
	}
	return { version, items, ignored };
}

function plainText(html: string): string {
	return html.replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
		.replace(/<!--[^]*?-->/g, '')
		.replace(/<br\s*\/?\s*>|<\/(?:p|div|h[1-6]|li)\s*>/gi, '\n')
		.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

/** Construct native Text nodes without mutating or publishing the target page. */
export function wxrItemToDocument(item: WxrItem, target: PageDocument): PageDocument {
	const text = plainText(item.content);
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length) {
		let end = Math.min(5000, remaining.length);
		if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
		chunks.push(remaining.slice(0, end));
		remaining = remaining.slice(end);
		if (chunks.length > 200) throw new Error('متن برای سند صفحه بیش از حد طولانی است.');
	}
	const nodes = chunks.map((chunk) => { const node = createBuilderNode('Text'); node.props.text = chunk; return node; });
	return validatePageDocument({ ...target, nodes }, target.slug);
}
