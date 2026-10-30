import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { MigrationMediaMap } from '../media-map.ts';
import { htmlToBuilderNodes } from '../html-to-nodes.ts';
import { convertElementorJson, type ImportWarning } from '../elementor/converter.ts';
import { createEmptyPageDocument, isValidPageSlug, validatePageDocument } from '../../builder/document.ts';
import type { PageDocument } from '../../builder/types.ts';

const MAX_BYTES = 1024 * 1024;
const MAX_ITEMS = 200;
export interface WxrItem {
	id: string;
	type: 'page' | 'post';
	title: string;
	/** CMS posts support longer titles than Builder page titles. */
	blogTitle?: string;
	blogTitleTruncated?: boolean;
	slug: string;
	status: string;
	content: string;
	excerpt: string;
	/** Bounded metadata used only when explicitly creating a CMS blog draft. */
	sourceDate?: string;
	categories?: string[];
	/** Locally inspected Elementor metadata; never executed or fetched. */
	elementorData?: string;
	warnings: string[];
}
export interface WxrAttachment { id: string; url: string; paths: string[] }
export interface WxrInspection { version: string; items: WxrItem[]; ignored: number; attachments: WxrAttachment[] }
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
	const attachments: WxrAttachment[] = [];
	for (const entry of entries) {
		if (!isObject(entry)) throw new Error('ساختار یکی از موارد WXR معتبر نیست.');
		const type = asText(entry['wp:post_type']);
		if (type !== 'page' && type !== 'post') {
			ignored++;
			if (type === 'attachment') {
				const meta = entry['wp:postmeta'] === undefined ? [] : Array.isArray(entry['wp:postmeta']) ? entry['wp:postmeta'] : [entry['wp:postmeta']];
				const paths = meta.filter(isObject).filter((item) => asText(item['wp:meta_key']) === '_wp_attached_file').map((item) => asText(item['wp:meta_value']).slice(0, 512));
				attachments.push({ id: asText(entry['wp:post_id']).slice(0, 80), url: asText(entry['wp:attachment_url']).slice(0, 2048), paths });
			}
			continue;
		}
		const fullTitle = asText(entry.title).trim();
		let titleEnd = Math.min(100, fullTitle.length);
		if (titleEnd < fullTitle.length && /[\uD800-\uDBFF]/.test(fullTitle[titleEnd - 1]) && /[\uDC00-\uDFFF]/.test(fullTitle[titleEnd])) titleEnd--;
		const title = fullTitle.slice(0, titleEnd) || 'بدون عنوان';
		let blogTitleEnd = Math.min(200, fullTitle.length);
		if (blogTitleEnd < fullTitle.length && /[\uD800-\uDBFF]/.test(fullTitle[blogTitleEnd - 1]) && /[\uDC00-\uDFFF]/.test(fullTitle[blogTitleEnd])) blogTitleEnd--;
		const blogTitle = fullTitle.slice(0, blogTitleEnd) || 'بدون عنوان';
		const content = asText(entry['content:encoded']);
		const excerpt = asText(entry['excerpt:encoded']);
		const sourceDate = (asText(entry['wp:post_date_gmt']).replace(/^0000-00-00.*$/, '') || asText(entry.pubDate)).slice(0, 80);
		const rawCategories = entry.category === undefined ? [] : Array.isArray(entry.category) ? entry.category : [entry.category];
		const categories = rawCategories.map(asText).map((category) => category.trim()).filter(Boolean);
		const warnings = ['تیتر، متن، نقل‌قول و فهرست با تأکید و پیوندهای ایمن قابل ویرایش تبدیل می‌شوند؛ ساختار و قالب‌بندی پیشرفته را بررسی کنید.', 'این مورد به صفحهٔ پیش‌نویس صفحه‌ساز تبدیل می‌شود، نه نوشتهٔ وبلاگ.'];
		if (titleEnd < fullTitle.length) warnings.push('عنوان منبع برای محدودیت صفحه به ۱۰۰ نویسه کوتاه شد.');
		if (excerpt.trim()) warnings.push('چکیدهٔ جداگانهٔ وردپرس منتقل نمی‌شود؛ در صورت نیاز آن را دستی بازبینی کنید.');
		if (categories.length > 20) warnings.push('فقط ۲۰ دسته یا برچسب نخست برای مسیر ورود نوشته نگهداری شدند.');
		if (/<(?:img|video|audio|iframe|object)\b/i.test(content) || entry['wp:attachment_url']) warnings.push('رسانه بدون نگاشت محلی منتقل نمی‌شود؛ تصویر را از کتابخانهٔ رسانه انتخاب یا نگاشت کنید.');
		if (/<a\b/i.test(content)) warnings.push('پیوندهای ایمن حفظ می‌شوند؛ نشانی‌های ناامن و گزینه‌های اضافی پیوند منتقل نمی‌شوند.');
		if (/<h[1-6]\b/i.test(content)) warnings.push('تیترهای بلند به متن تقسیم می‌شوند و سطح H5 و H6 به H4 تبدیل می‌شود.');
		if (/<(?:ul|ol)\b/i.test(content)) warnings.push('فهرست‌های ساده به مؤلفهٔ بومی تبدیل می‌شوند؛ ساختار فهرست‌های تودرتو تقریبی است.');
		if (/<blockquote\b/i.test(content)) warnings.push('نقل‌قول به مؤلفهٔ بومی تبدیل می‌شود؛ انتساب خودکار بررسی شود.');
		if (entry.category || entry['wp:postmeta']) warnings.push('دسته‌ها، برچسب‌ها و فرادادهٔ وردپرس منتقل نمی‌شوند.');
		const meta = entry['wp:postmeta'] === undefined ? [] : Array.isArray(entry['wp:postmeta']) ? entry['wp:postmeta'] : [entry['wp:postmeta']];
		const candidates = meta.filter(isObject).filter((item) => asText(item['wp:meta_key']) === '_elementor_data');
		let elementorData: string | undefined;
		if (candidates.length === 1) {
			try {
				const parsed: unknown = JSON.parse(asText(candidates[0]['wp:meta_value']));
				const normalized = Array.isArray(parsed) ? { version: 'wxr', content: parsed } : parsed;
				if (!isObject(normalized) || typeof normalized.version !== 'string' || !Array.isArray(normalized.content)) throw new Error('invalid');
				elementorData = JSON.stringify(normalized);
				warnings.push('دادهٔ Elementor در WXR موجود است؛ می‌توانید تبدیل تقریبی و هشدارهای آن را جداگانه انتخاب و بررسی کنید.');
			} catch { warnings.push('دادهٔ Elementor معتبر نیست؛ فقط محتوای HTML وردپرس قابل بررسی است.'); }
		} else if (candidates.length > 1) warnings.push('چند دادهٔ Elementor متعارض پیدا شد؛ هیچ‌کدام خودکار انتخاب نشد.');
		items.push({ id: asText(entry['wp:post_id']).slice(0, 80), type, title, ...(blogTitle !== title ? { blogTitle } : {}), ...(blogTitleEnd < fullTitle.length ? { blogTitleTruncated: true } : {}), slug: asText(entry['wp:post_name']).slice(0, 120), status: asText(entry['wp:status']).slice(0, 40), content, excerpt, ...(sourceDate ? { sourceDate } : {}), ...(categories.length ? { categories: categories.slice(0, 20) } : {}), ...(elementorData ? { elementorData } : {}), warnings });
	}
	return { version, items, ignored, attachments };
}

/** Convert into native editable nodes without mutating or publishing the target. */
export function wxrItemToDocument(item: WxrItem, target: PageDocument, mediaMap?: MigrationMediaMap): PageDocument {
	return validatePageDocument({ ...target, nodes: htmlToBuilderNodes(item.content, mediaMap) }, target.slug);
}

/** Explicitly choose the bounded Elementor converter when metadata exists. */
export function convertWxrItem(item: WxrItem, target: PageDocument, preferElementor = false, mediaMap?: MigrationMediaMap): { document: PageDocument; warnings: ImportWarning[]; source: 'html' | 'elementor' } {
	if (preferElementor && item.elementorData) {
		const result = convertElementorJson(item.elementorData, target, mediaMap);
		return { document: result.document, warnings: result.warnings, source: 'elementor' };
	}
	const warnings: ImportWarning[] = [];
	const seen = new Set<string>();
	const nodes = htmlToBuilderNodes(item.content, mediaMap, (code, message) => {
		if (!seen.has(code)) { seen.add(code); warnings.push({ sourceId: item.id || 'wordpress', code, message }); }
	});
	return { document: validatePageDocument({ ...target, nodes }, target.slug), warnings, source: 'html' };
}

/** Convert all inspected entries into distinct drafts without changing an existing page. */
export function wxrToDraftPages(inspection: WxrInspection, prefix: string, preferElementor = false, mediaMap?: MigrationMediaMap): PageDocument[] {
	if (!isValidPageSlug(prefix)) throw new Error('پیشوند نامک معتبر نیست.');
	if (!Array.isArray(inspection.items) || !inspection.items.length || inspection.items.length > 20) throw new Error('برای ساخت گروهی، فایل باید بین ۱ تا ۲۰ صفحه یا نوشته داشته باشد.');
	return inspection.items.map((item, index) => {
		const slug = `${prefix}-${index + 1}`;
		if (!isValidPageSlug(slug)) throw new Error('نامک تولیدشده بیش از حد طولانی است.');
		const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 100) : 'بدون عنوان';
		return convertWxrItem(item, createEmptyPageDocument(slug, title), preferElementor, mediaMap).document;
	});
}
