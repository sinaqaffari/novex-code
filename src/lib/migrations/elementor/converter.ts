import { mappedMigrationMedia, type MigrationMediaMap } from '../media-map.ts';
import { parseInlineHtml } from '../inline-html.ts';
import { htmlToBuilderNodes } from '../html-to-nodes.ts';
import { isTextBoundary, sliceMarkedText, splitMarkedText } from '../../builder/rich-text.ts';
import { validatePageDocument } from '../../builder/document.ts';
import { createBuilderNode } from '../../builder/operations.ts';
import { safeHref } from '../../builder/registry.ts';
import { SPACING_STEPS, type AccordionItem, type BuilderNode, type GalleryItem, type ListItem, type NodeStyles, type PageDocument, type ResponsiveNodeStyles } from '../../builder/types.ts';

/** Local, bounded conversion. It never fetches assets or executes source content. */
export interface ImportWarning { sourceId: string; code: string; message: string }
export interface ElementorImport { document: PageDocument; warnings: ImportWarning[]; converted: number; supportedWidgets: Record<string, number>; unsupportedWidgets: Record<string, number>; missingAssets: number }
const MAX_BYTES = 1024 * 1024;
const MAX_NODES = 200;
const MAX_DEPTH = 8;
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function plainText(value: unknown): string {
	if (typeof value !== 'string') return '';
	// Source markup is never injected into the DOM. Remove active content and markup,
	// retain readable text; rich formatting is intentionally reported as lossy.
	return value.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
		.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p\s*>/gi, '\n')
		.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

/** Parse IDs locally from exact provider hosts. The source URL is never fetched or embedded. */
function knownVideoId(value: string): { provider: 'youtube' | 'vimeo'; id: string } | null {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
		const host = url.hostname.toLowerCase();
		let id = '';
		if (host === 'youtu.be') id = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? '';
		else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
			if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) id = url.searchParams.get('v') ?? '';
			else id = /^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? '';
		}
		if (/^[A-Za-z0-9_-]{11}$/.test(id)) return { provider: 'youtube', id };
		if (host === 'vimeo.com' || host === 'www.vimeo.com') id = /^\/([1-9][0-9]{5,11})\/?$/.exec(url.pathname)?.[1] ?? '';
		else if (host === 'player.vimeo.com') id = /^\/video\/([1-9][0-9]{5,11})\/?$/.exec(url.pathname)?.[1] ?? '';
		else id = '';
		return /^[1-9][0-9]{5,11}$/.test(id) ? { provider: 'vimeo', id } : null;
	} catch {
		return null;
	}
}

export function convertElementorJson(json: string, target: PageDocument, mediaMap?: MigrationMediaMap): ElementorImport {
	if (new TextEncoder().encode(json).byteLength > MAX_BYTES) throw new Error('حجم فایل نباید بیش از ۱ مگابایت باشد.');
	let parsed: unknown;
	try { parsed = JSON.parse(json); } catch { throw new Error('فایل JSON معتبر نیست.'); }
	if (!record(parsed) || !Array.isArray(parsed.content) || typeof parsed.version !== 'string') throw new Error('ساختار خروجی Elementor معتبر نیست (version و content لازم‌اند).');
	const warnings: ImportWarning[] = [];
	let visited = 0;
	let converted = 0;
	const supportedWidgets: Record<string, number> = Object.create(null);
	const unsupportedWidgets: Record<string, number> = Object.create(null);
	let missingAssets = 0;
	const warn = (sourceId: string, code: string, message: string) => warnings.push({ sourceId, code, message });
	const convert = (raw: unknown, depth: number): BuilderNode => {
		if (++visited > MAX_NODES || depth > MAX_DEPTH) throw new Error('تعداد مؤلفه‌ها یا عمق ساختار بیش از محدودیت سند است (۲۰۰ مؤلفه، ۸ سطح).');
		if (!record(raw) || typeof raw.elType !== 'string' || !(record(raw.settings) || (Array.isArray(raw.settings) && raw.settings.length === 0))) throw new Error('یک مؤلفهٔ Elementor ساختار معتبر ندارد.');
		const id = typeof raw.id === 'string' ? raw.id.slice(0, 80) : 'unknown';
		const settings: Record<string, unknown> = record(raw.settings) ? raw.settings : {};
		const known = new Set<string>();
		const use = (key: string) => { known.add(key); return settings[key]; };
		const importedText = (value: unknown, key: string) => {
			if (value !== undefined && value !== null && typeof value !== 'string') warn(id, 'text-format', `مقدار غیرمتنی ${key} منتقل نشد.`);
			return plainText(value);
		};
		const importedMarkup = (value: unknown, key: string) => {
			if (value !== undefined && value !== null && typeof value !== 'string') warn(id, 'text-format', `مقدار غیرمتنی ${key} منتقل نشد.`);
			const parsed = parseInlineHtml(typeof value === 'string' ? value : '');
			if (parsed.unsafeLinks) warn(id, 'unsafe-link', 'پیوند ناامن حذف شد و متن آن حفظ شد.');
			if (parsed.unsupportedMarkup) warn(id, 'unsupported-rich-markup', 'بعضی نشانه‌گذاری‌ها، ویژگی‌ها یا محتوای فعال منتقل نشدند.');
			return parsed;
		};
		const textNodes = (content: { text: string; marks: import('../../builder/types.ts').TextMark[] }) => splitMarkedText(content.text, content.marks).map((part) => {
			const text = createBuilderNode('Text'); text.props.text = part.text; if (part.marks.length) text.props.marks = part.marks; return text;
		});
		const headingContent = (content: { text: string; marks: import('../../builder/types.ts').TextMark[] }) => {
			let end = Math.min(240, content.text.length);
			if (!isTextBoundary(content.text, end)) end--;
			return { first: sliceMarkedText(content.text, content.marks, 0, end), rest: sliceMarkedText(content.text, content.marks, end, content.text.length) };
		};
		const linkedContent = (content: { text: string; marks: import('../../builder/types.ts').TextMark[] }, rawLink: unknown, location: string) => {
			if (rawLink === undefined || rawLink === null || rawLink === '') return content;
			if (!record(rawLink)) { warn(id, 'link-format', `پیوند ${location} ساختار پشتیبانی‌شده‌ای ندارد.`); return content; }
			const href = typeof rawLink.url === 'string' ? rawLink.url : '';
			if (Object.keys(rawLink).some((key) => key !== 'url' && rawLink[key])) warn(id, 'link-options', `تنظیمات اضافی پیوند ${location} منتقل نشد.`);
			if (!href) return content;
			if (!safeHref(href)) { warn(id, 'unsafe-link', `نشانی ناامن ${location} حذف شد.`); return content; }
			if (!content.text) { warn(id, 'empty-link', `پیوند ${location} متنی برای انتقال ندارد.`); return content; }
			if (content.marks.some((mark) => mark.kind === 'link')) warn(id, 'nested-link', `پیوند کل ${location} جایگزین پیوندهای تو‌در‌توی متن شد.`);
			return { text: content.text, marks: [...content.marks.filter((mark) => mark.kind !== 'link'), { kind: 'link' as const, start: 0, end: content.text.length, href: href.trim() }] };
		};
		const truncatePlain = (value: string, limit: number, message: string) => {
			let end = Math.min(limit, value.length);
			if (!isTextBoundary(value, end)) end--;
			if (end < value.length) warn(id, 'truncated', message);
			return value.slice(0, end);
		};
		let node: BuilderNode;
		let splitTextNodes: Array<Extract<BuilderNode, { type: 'Text' | 'Heading' | 'Button' }>> | undefined;
		if (['section', 'column', 'container'].includes(raw.elType)) {
			if (!Array.isArray(raw.elements)) throw new Error(`فرزندان ساختار ${id} معتبر نیستند.`);
			const container = createBuilderNode('Container');
			const direction = use('flex_direction');
			container.props.layout = direction === 'row' ? 'row' : 'stack';
			if (raw.elType !== 'container') warn(id, 'legacy-layout', 'چیدمان قدیمی بخش و ستون تقریبی تبدیل شد؛ آن را بررسی کنید.');
			if (direction && !['row', 'column'].includes(String(direction))) warn(id, 'layout', 'جهت چیدمان پشتیبانی نمی‌شود.');
			container.children = raw.elements.map((child) => convert(child, depth + 1));
			node = container;
		} else if (raw.elType === 'widget') {
			const widget = typeof raw.widgetType === 'string' ? raw.widgetType : 'unknown';
			const supported = ['heading', 'text-editor', 'button', 'image', 'image-box', 'icon-list', 'accordion', 'toggle', 'tabs', 'divider', 'spacer', 'image-gallery', 'basic-gallery', 'testimonial', 'blockquote', 'video', 'price-table'].includes(widget);
			const counts = supported ? supportedWidgets : unsupportedWidgets;
			counts[widget] = (counts[widget] ?? 0) + 1;
			if (Array.isArray(raw.elements) && raw.elements.length) warn(id, 'widget-children', 'فرزندان ویجت منتقل نشدند.');
			if (widget === 'heading') {
				const heading = createBuilderNode('Heading');
				const title = headingContent(linkedContent(importedMarkup(use('title'), 'title'), use('link'), 'تیتر'));
				heading.props.text = title.first.text;
				if (title.first.marks.length) heading.props.marks = title.first.marks;
				const tag = use('header_size');
				if (typeof tag === 'string' && /^h[1-4]$/.test(tag)) heading.props.level = Number(tag[1]) as 1 | 2 | 3 | 4;
				else if (tag) warn(id, 'heading-level', 'سطح تیتر پشتیبانی نمی‌شود.');
				if (title.rest.text) {
					const continuation = textNodes(title.rest); const group = createBuilderNode('Container');
					group.props.padding = 0; group.props.gap = 0; group.props.maxWidth = 'full'; group.children = [heading, ...continuation];
					node = group; splitTextNodes = [heading, ...continuation];
					warn(id, 'heading-split', 'تیتر بلند بدون حذف به تیتر و ادامهٔ متنی تقسیم شد؛ ساختار را بررسی کنید.');
				} else node = heading;
			} else if (widget === 'text-editor') {
				const source = use('editor');
				if (source !== undefined && source !== null && typeof source !== 'string') warn(id, 'text-format', 'مقدار غیرمتنی editor منتقل نشد.');
				const reported = new Set<string>();
				const parts = htmlToBuilderNodes(typeof source === 'string' ? source : '', mediaMap, (code, message) => {
					if (!reported.has(code)) { reported.add(code); warn(id, code, message); }
				});
				if (!parts.length) parts.push(createBuilderNode('Text'));
				missingAssets += parts.filter((part) => part.type === 'Image' && !part.props.src).length;
				if (settings.align && parts.some((part) => part.type !== 'Text' && part.type !== 'Heading' && part.type !== 'Button')) warn(id, 'alignment', 'تراز بعضی ساختارهای متن به مؤلفهٔ بومی منتقل نشد.');
				if (parts.length === 1) node = parts[0];
				else {
					const group = createBuilderNode('Container'); group.props.padding = 0; group.props.gap = 0; group.props.maxWidth = 'full'; group.children = parts;
					node = group;
					const textParts = parts.filter((part): part is Extract<BuilderNode, { type: 'Text' | 'Heading' | 'Button' }> => part.type === 'Text' || part.type === 'Heading' || part.type === 'Button');
					if (textParts.length) splitTextNodes = textParts;
					warn(id, 'text-split', 'محتوای چندبخشی یا بلند به مؤلفه‌های بومی قابل ویرایش تقسیم شد؛ ساختار را بررسی کنید.');
				}
				if (typeof source === 'string' && /<[^>]+>/.test(source)) warn(id, 'rich-text', 'تیتر، متن، نقل‌قول، فهرست، تأکید و پیوندهای ایمن قابل ویرایش‌اند؛ ساختار پیشرفته را بررسی کنید.');
			} else if (widget === 'button') {
				const button = createBuilderNode('Button');
				const label = importedMarkup(use('text'), 'text');
				let end = Math.min(80, label.text.length); if (!isTextBoundary(label.text, end)) end--;
				const first = sliceMarkedText(label.text, label.marks, 0, end);
				const rest = sliceMarkedText(label.text, label.marks, end, label.text.length);
				button.props.label = first.text;
				if (first.marks.length) warn(id, 'button-formatting', 'قالب‌بندی در برچسب دکمه پشتیبانی نمی‌شود؛ متن حفظ شد.');
				const link = use('link');
				const href = record(link) && typeof link.url === 'string' ? link.url : '';
				if (href && safeHref(href)) button.props.href = href;
				else if (href) warn(id, 'unsafe-link', 'نشانی ناامن دکمه حذف شد.');
				if (record(link) && Object.keys(link).some((key) => key !== 'url' && link[key])) warn(id, 'link-options', 'تنظیمات اضافی پیوند منتقل نشد.');
				if (rest.text) {
					const continuation = textNodes(rest); const group = createBuilderNode('Container'); group.props.padding = 0; group.props.gap = 0; group.props.maxWidth = 'full'; group.children = [button, ...continuation];
					node = group; splitTextNodes = [button, ...continuation];
					warn(id, 'button-split', 'ادامهٔ برچسب بلند دکمه بدون حذف به متن جدا تبدیل شد و کلیک‌پذیر نیست.');
				} else node = button;
			} else if (widget === 'spacer') {
				const spacer = createBuilderNode('Spacer');
				for (const [key, breakpoint] of [['space', 'desktop'], ['space_tablet', 'tablet'], ['space_mobile', 'mobile']] as const) {
					const value = use(key);
					if (value === undefined || value === null || value === '') continue;
					const size = record(value) ? value.size : value;
					const number = typeof size === 'number' ? size : typeof size === 'string' && /^\d+$/.test(size) ? Number(size) : NaN;
					if ((record(value) && value.unit !== undefined && value.unit !== 'px') || !Number.isInteger(number) || number < 0 || number > 1024) { warn(id, 'spacer-size', `اندازهٔ ${key} پشتیبانی نمی‌شود.`); continue; }
					if (breakpoint === 'desktop') spacer.props.size = number;
					else spacer.responsiveStyles = { ...spacer.responsiveStyles, [breakpoint]: { ...spacer.responsiveStyles?.[breakpoint], height: `${number}px` } };
				}
				node = spacer;
			} else if (widget === 'divider') {
				const divider = createBuilderNode('Divider');
				const lineStyle = use('style');
				if (lineStyle === 'solid' || lineStyle === 'dashed' || lineStyle === 'dotted') divider.props.lineStyle = lineStyle;
				else if (lineStyle) warn(id, 'divider-style', 'نوع خط جداکننده پشتیبانی نمی‌شود.');
				const weight = use('weight');
				if (weight !== undefined && weight !== null && weight !== '') {
					const size = record(weight) ? weight.size : weight;
					const number = typeof size === 'number' ? size : typeof size === 'string' && /^\d+$/.test(size) ? Number(size) : NaN;
					if ((!record(weight) || weight.unit === undefined || weight.unit === 'px') && (number === 1 || number === 2 || number === 4)) divider.props.thickness = number;
					else warn(id, 'divider-weight', 'ضخامت خط جداکننده پشتیبانی نمی‌شود.');
				}
				node = divider;
			} else if (widget === 'image-gallery' || widget === 'basic-gallery') {
				const entries = use('wp_gallery') ?? use('gallery');
				if (!Array.isArray(entries) || entries.length > 50) throw new Error('فهرست تصاویر گالری Elementor معتبر نیست یا بیش از ۵۰ تصویر دارد.');
				const columnSetting = use('columns');
				const numericColumns = typeof columnSetting === 'number' || typeof columnSetting === 'string' ? Number(columnSetting) : NaN;
				const columns = ([1, 2, 3, 4] as const).find((number) => number === numericColumns) ?? 3;
				if (columnSetting !== undefined && columnSetting !== '' && ![1, 2, 3, 4].includes(numericColumns)) warn(id, 'gallery-columns', 'تعداد ستون گالری پشتیبانی نمی‌شود و مقدار پیش‌فرض استفاده شد.');
				const items: GalleryItem[] = entries.map((entry, index) => {
					if (!record(entry)) throw new Error('یکی از تصاویر گالری Elementor معتبر نیست.');
					const alt = importedText(entry.alt, 'alt');
					const caption = importedText(entry.caption, 'caption');
					if ((typeof entry.alt === 'string' && /<[^>]+>/.test(entry.alt)) || (typeof entry.caption === 'string' && /<[^>]+>/.test(entry.caption))) warn(id, 'gallery-item-options', 'قالب‌بندی متن تصویر گالری منتقل نشد.');
					if (Object.keys(entry).some((key) => !['url', 'id', 'alt', 'caption', '_id'].includes(key) && entry[key])) warn(id, 'gallery-item-options', 'تنظیمات اضافی یکی از تصاویر گالری منتقل نشد.');
					const local = mappedMigrationMedia(mediaMap, entry);
					if (!local) missingAssets++;
					return { id: `item_${String(index).padStart(4, '0')}`, src: local ?? '', alt: truncatePlain(alt, 240, 'متن جایگزین یکی از تصاویر گالری کوتاه شد.'), caption: truncatePlain(caption, 240, 'زیرنویس یکی از تصاویر گالری کوتاه شد.') };
				});
				const galleries = [];
				for (let offset = 0; offset < Math.max(items.length, 1); offset += 24) {
					const gallery = createBuilderNode('ImageGallery');
					gallery.props.items = items.slice(offset, offset + 24);
					gallery.props.columns = columns;
					galleries.push(gallery);
				}
				if (galleries.length === 1) node = galleries[0];
				else {
					const group = createBuilderNode('Container');
					group.props.padding = 0;
					group.children = galleries;
					node = group;
					warn(id, 'gallery-split', 'گالری بزرگ به چند گالری بومی تقسیم شد تا هیچ موردی حذف نشود.');
				}
				warn(id, 'gallery-assets', 'تصاویر گالری بارگیری نشدند؛ نگاشت محلی را بررسی کنید و تصاویر بدون نگاشت را از کتابخانه انتخاب کنید. چیدمان تقریبی است.');
			} else if (widget === 'testimonial' || widget === 'blockquote') {
				const content = importedMarkup(use(widget === 'testimonial' ? 'testimonial_content' : 'blockquote_content'), 'content');
				const authorText = importedText(use(widget === 'testimonial' ? 'testimonial_name' : 'blockquote_author'), 'author');
				const roleText = widget === 'testimonial' ? importedText(use('testimonial_job'), 'role') : '';
				const parts = splitMarkedText(content.text, content.marks).map((part) => {
					const quote = createBuilderNode('Blockquote'); quote.props.text = part.text; if (part.marks.length) quote.props.marks = part.marks; return quote;
				});
				parts[parts.length - 1].props.author = truncatePlain(authorText, 160, 'نام گوینده به محدودیت سند کوتاه شد.');
				parts[parts.length - 1].props.role = truncatePlain(roleText, 160, 'سمت گوینده به محدودیت سند کوتاه شد.');
				if (widget === 'testimonial') {
					const image = use('testimonial_image');
					if ((record(image) && (image.id || image.url)) || (image && !record(image))) { missingAssets++; warn(id, 'asset', 'تصویر گواهی منتقل نشد؛ آن را از کتابخانه انتخاب کنید.'); }
				}
				warn(id, 'testimonial-layout', 'گواهی به نقل‌قول بومی تبدیل شد؛ چیدمان اصلی را بررسی کنید.');
				if (parts.length === 1) node = parts[0];
				else { const group = createBuilderNode('Container'); group.props.padding = 0; group.props.gap = 0; group.children = parts; node = group; warn(id, 'quote-split', 'نقل‌قول بلند بدون حذف به چند نقل‌قول تقسیم شد.'); }
			} else if (widget === 'video') {
				const youtube = use('youtube_url');
				const vimeo = use('vimeo_url');
				const generic = use('video_url');
				if ([youtube, vimeo, generic].some((value) => value !== undefined && value !== null && value !== '' && typeof value !== 'string')) warn(id, 'video-source', 'نشانی ویدئوی غیرمتنی منتقل نشد.');
				const urls = [youtube, vimeo, generic].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
				const url = urls[0];
				if (urls.length > 1) warn(id, 'additional-video-links', 'فقط نخستین نشانی ویدئو منتقل شد.');
				const recognized = url ? knownVideoId(url) : null;
				if (recognized) {
					const video = createBuilderNode('VideoEmbed');
					video.props.provider = recognized.provider;
					if (recognized.provider === 'youtube') video.props.youtubeId = recognized.id;
					else video.props.vimeoId = recognized.id;
					node = video;
					warn(id, 'video-embed', 'تنها شناسهٔ ویدئو منتقل شد؛ زمان شروع و تنظیمات پخش منتقل نمی‌شوند و صفحهٔ منتشرشده به سرویس ویدئو متصل می‌شود.');
				} else {
					const button = createBuilderNode('Button');
					button.props.label = 'مشاهدهٔ ویدئو';
					if (typeof url === 'string' && safeHref(url)) button.props.href = url;
					else if (url) warn(id, 'unsafe-link', 'نشانی ناامن ویدئو حذف شد.');
					warn(id, 'video-link', 'سرویس ویدئو تشخیص داده نشد؛ به پیوند بومی تبدیل شد و در صفحه جاسازی نمی‌شود.');
					node = button;
				}
			} else if (widget === 'price-table') {
				const group = createBuilderNode('Container');
				const title = createBuilderNode('Heading');
				const titleContent = headingContent(importedMarkup(use('heading'), 'heading'));
				title.props.text = titleContent.first.text;
				if (titleContent.first.marks.length) title.props.marks = titleContent.first.marks;
				group.children = [title, ...(titleContent.rest.text ? textNodes(titleContent.rest) : [])];
				const price = { text: '', marks: [] as import('../../builder/types.ts').TextMark[] };
				for (const key of ['currency_symbol', 'price', 'period']) {
					const part = importedMarkup(use(key), key);
					if (!part.text) continue;
					if (price.text) price.text += ' ';
					const offset = price.text.length;
					price.text += part.text;
					price.marks.push(...part.marks.map((mark) => ({ ...mark, start: mark.start + offset, end: mark.end + offset })));
				}
				group.children.push(...textNodes(price));
				if (titleContent.rest.text || price.text.length > 5000) warn(id, 'price-text-split', 'تیتر یا قیمت بلند بدون حذف به مؤلفه‌های متنی تقسیم شد.');
				const features = use('features_list');
				if (features !== undefined) {
					if (!Array.isArray(features) || features.length > 50) throw new Error('فهرست امکانات جدول قیمت معتبر نیست.');
					for (const feature of features) {
						if (!record(feature)) throw new Error('امکان جدول قیمت معتبر نیست.');
						const content = importedMarkup(feature.item_text, 'item_text');
						if (Object.entries(feature).some(([key, value]) => key !== 'item_text' && Boolean(value))) warn(id, 'price-feature-options', 'گزینه‌های اضافی یکی از امکانات جدول قیمت منتقل نشد.');
						const parts = textNodes(content);
						if (parts.length > 1) warn(id, 'price-feature-split', 'متن بلند امکان جدول قیمت بدون حذف تقسیم شد.');
						group.children.push(...parts);
					}
				}
				const label = importedMarkup(use('button_text'), 'button_text');
				const link = use('link');
				if (label.text) {
					const action = createBuilderNode('Button');
					let end = Math.min(80, label.text.length); if (!isTextBoundary(label.text, end)) end--;
					const first = sliceMarkedText(label.text, label.marks, 0, end);
					const rest = sliceMarkedText(label.text, label.marks, end, label.text.length);
					action.props.label = first.text;
					if (first.marks.length) warn(id, 'button-formatting', 'قالب‌بندی در برچسب دکمه پشتیبانی نمی‌شود؛ متن حفظ شد.');
					const href = record(link) && typeof link.url === 'string' ? link.url : '';
					if (href && safeHref(href)) action.props.href = href; else if (href) warn(id, 'unsafe-link', 'نشانی ناامن جدول قیمت حذف شد.');
					if (record(link) && Object.keys(link).some((key) => key !== 'url' && link[key])) warn(id, 'link-options', 'تنظیمات اضافی پیوند جدول قیمت منتقل نشد.');
					group.children.push(action);
					if (rest.text) { group.children.push(...textNodes(rest)); warn(id, 'button-split', 'ادامهٔ برچسب بلند دکمه بدون حذف به متن جدا تبدیل شد و کلیک‌پذیر نیست.'); }
				} else if (record(link) && Object.values(link).some(Boolean)) warn(id, 'price-link', 'پیوند جدول قیمت بدون متن دکمه منتقل نشد.');
				warn(id, 'price-layout', 'جدول قیمت به محتوای بومی تبدیل شد؛ اتصال خرید یا ویژگی پویا منتقل نشد.');
				node = group;
			} else if (widget === 'accordion' || widget === 'toggle' || widget === 'tabs') {
				const entries = use('tabs');
				if (!Array.isArray(entries)) throw new Error('موارد تب یا آکاردئون Elementor معتبر نیستند.');
				if (entries.length > 50) throw new Error('تب یا آکاردئون Elementor بیش از ۵۰ مورد دارد.');
				const items: AccordionItem[] = [];
				for (const entry of entries) {
					if (!record(entry)) throw new Error('یکی از موارد تب یا آکاردئون Elementor معتبر نیست.');
					const rawTitle = importedMarkup(entry.tab_title, 'tab_title');
					if (rawTitle.marks.some((mark) => mark.kind === 'link')) warn(id, 'interactive-title-link', 'پیوند عنوان تعاملی حذف شد؛ متن و تأکید آن حفظ شد.');
					const title = headingContent({ ...rawTitle, marks: rawTitle.marks.filter((mark) => mark.kind !== 'link') });
					const rawBody = importedMarkup(entry.tab_content, 'tab_content');
					const separator = title.rest.text && rawBody.text ? '\n' : '';
					const shift = title.rest.text.length + separator.length;
					const body = { text: title.rest.text + separator + rawBody.text, marks: [...title.rest.marks, ...rawBody.marks.map((mark) => ({ ...mark, start: mark.start + shift, end: mark.end + shift }))] };
					if (title.rest.text) warn(id, 'interactive-title-split', 'ادامهٔ عنوان بلند برای جلوگیری از حذف در ابتدای متن مورد قرار گرفت.');
					const parts = splitMarkedText(body.text, body.marks);
					if (parts.length > 1) warn(id, 'accordion-text-split', 'متن بلند بدون حذف در چند مورد با عنوان تکراری تقسیم شد؛ تعامل اصلی را بررسی کنید.');
					if (Object.keys(entry).some((key) => !['tab_title', 'tab_content', '_id'].includes(key) && entry[key])) warn(id, 'accordion-item-options', 'تنظیمات اضافی یکی از موارد تب یا آکاردئون منتقل نشد.');
					for (const part of parts) items.push({ id: `item_${String(items.length).padStart(4, '0')}`, title: title.first.text, body: part.text, ...(title.first.marks.length ? { titleMarks: title.first.marks } : {}), ...(part.marks.length ? { bodyMarks: part.marks } : {}) });
				}
				const chunks: BuilderNode[] = [];
				for (let offset = 0; offset < Math.max(items.length, 1); offset += 24) {
					const itemNode = widget === 'tabs' ? createBuilderNode('Tabs') : createBuilderNode('Accordion');
					itemNode.props.items = items.slice(offset, offset + 24);
					chunks.push(itemNode);
				}
				if (chunks.length === 1) node = chunks[0];
				else {
					const group = createBuilderNode('Container'); group.props.padding = 0; group.children = chunks; node = group;
					warn(id, widget === 'tabs' ? 'tabs-split' : 'accordion-split', 'فهرست بزرگ به چند مؤلفهٔ بومی تقسیم شد تا هیچ موردی حذف نشود.');
				}
				warn(id, widget === 'tabs' ? 'tabs-content' : 'accordion-layout', widget === 'tabs' ? 'زبانه‌ها تعاملی و قابل ویرایش هستند؛ تأکید و پیوندهای ایمن متن حفظ شدند، اما چیدمان و رفتار پیشرفته تقریبی است.' : 'پرسش‌ها به آکاردئون بومی تبدیل شدند؛ تأکید و پیوندهای ایمن متن حفظ شدند، اما چیدمان و رفتار پیشرفته تقریبی است.');
			} else if (widget === 'icon-list') {
				const entries = use('icon_list');
				if (!Array.isArray(entries)) throw new Error('فهرست موارد ویجت Elementor معتبر نیست.');
				if (entries.length > 50) throw new Error('فهرست Elementor بیش از ۵۰ مورد دارد.');
				const items: ListItem[] = entries.flatMap((entry, index) => {
					if (!record(entry)) throw new Error('یکی از موارد فهرست Elementor معتبر نیست.');
					const content = importedMarkup(entry.text, 'text');
					const linkRecord = record(entry.link) ? entry.link : null;
					const href = linkRecord && typeof linkRecord.url === 'string' ? linkRecord.url : '';
					if (href && (!safeHref(href) || href.length > 500)) warn(id, 'list-link', 'پیوند ناامن مورد فهرست منتقل نشد.');
					if (linkRecord && Object.keys(linkRecord).some((key) => key !== 'url' && linkRecord[key])) warn(id, 'link-options', 'تنظیمات اضافی پیوند فهرست منتقل نشد.');
					const safeLink = href && safeHref(href) && href.length <= 500 ? href : '';
					if (safeLink && content.marks.some((mark) => mark.kind === 'link')) warn(id, 'list-nested-link', 'پیوند کل مورد حفظ شد؛ پیوند تو‌در‌توی متن منتقل نشد.');
					const parts = splitMarkedText(content.text, safeLink ? content.marks.filter((mark) => mark.kind !== 'link') : content.marks);
					if (parts.length > 1) warn(id, 'list-text-split', 'متن بلند یک مورد بدون حذف به چند مورد تقسیم شد.');
					return parts.map((part, partIndex) => ({ id: `item_${String(index).padStart(4, '0')}${parts.length > 1 ? `_${partIndex}` : ''}`, text: part.text, href: safeLink, ...(part.marks.length ? { marks: part.marks } : {}) }));
				});
				const lists = [];
				for (let offset = 0; offset < Math.max(items.length, 1); offset += 24) {
					const list = createBuilderNode('List'); list.props.items = items.slice(offset, offset + 24); lists.push(list);
				}
				if (lists.length === 1) node = lists[0];
				else { const group = createBuilderNode('Container'); group.props.padding = 0; group.children = lists; node = group; warn(id, 'list-split', 'فهرست بزرگ به چند فهرست بومی تقسیم شد تا هیچ موردی حذف نشود.'); }
				warn(id, 'list-layout', 'فهرست و پیوندهای ایمن به مؤلفهٔ بومی تبدیل شدند؛ آیکن‌ها و چیدمان اصلی منتقل نشدند.');
			} else if (widget === 'image-box') {
				const box = createBuilderNode('Container');
				const image = createBuilderNode('Image');
				const heading = createBuilderNode('Heading');
				const source = use('image');
				const local = record(source) ? mappedMigrationMedia(mediaMap, source) : null;
				if (local) { image.props.src = local; warn(id, 'asset-mapped', 'تصویر جعبه به رسانهٔ محلی نگاشت شد؛ تطابق آن را بررسی کنید.'); }
				else { missingAssets++; warn(id, record(source) && (source.url || source.id) ? 'asset' : 'missing-asset', 'تصویر جعبه منتقل نشد؛ از کتابخانهٔ رسانه انتخاب کنید.'); }
				if (record(source)) image.props.alt = truncatePlain(importedText(source.alt, 'alt'), 240, 'متن جایگزین تصویر جعبه کوتاه شد.');
				const boxLink = use('link');
				const title = headingContent(linkedContent(importedMarkup(use('title_text'), 'title_text'), boxLink, 'عنوان جعبه'));
				if (record(boxLink) && typeof boxLink.url === 'string' && safeHref(boxLink.url)) warn(id, 'image-box-image-link', title.first.text ? 'پیوند به عنوان منتقل شد، اما تصویر به‌تنهایی کلیک‌پذیر نیست.' : 'پیوند تصویر بدون عنوان منتقل نشد؛ تصویر به‌تنهایی کلیک‌پذیر نیست.');
				const description = importedMarkup(use('description_text'), 'description_text');
				heading.props.text = title.first.text;
				if (title.first.marks.length) heading.props.marks = title.first.marks;
				const titleRest = title.rest.text ? textNodes(title.rest) : [];
				const descriptionParts = textNodes(description);
				if (titleRest.length || descriptionParts.length > 1) warn(id, 'image-box-split', 'متن بلند جعبه بدون حذف به چند مؤلفه تقسیم شد.');
				box.children = [image, heading, ...titleRest, ...descriptionParts];
				warn(id, 'image-box-layout', 'چیدمان جعبهٔ تصویر تقریبی است؛ پیوند، رنگ و اندازه را بررسی کنید.');
				node = box;
			} else if (widget === 'image') {
				const image = createBuilderNode('Image');
				const source = use('image');
				const local = record(source) ? mappedMigrationMedia(mediaMap, source) : null;
				if (local) { image.props.src = local; warn(id, 'asset-mapped', 'تصویر به رسانهٔ محلی نگاشت شد؛ تطابق آن را بررسی کنید.'); }
				else { missingAssets++; if (record(source) && (source.url || source.id)) warn(id, 'asset', 'تصویر منتقل نشد؛ آن را از کتابخانهٔ رسانه انتخاب کنید. هیچ نشانی راه دور بارگیری نشد.'); else warn(id, 'missing-asset', 'تصویر در خروجی موجود نیست؛ از کتابخانهٔ رسانه انتخاب کنید.'); }
				if (record(source)) image.props.alt = truncatePlain(importedText(source.alt, 'alt'), 240, 'متن جایگزین تصویر کوتاه شد.');
				image.props.caption = truncatePlain(importedText(use('caption'), 'caption'), 240, 'زیرنویس تصویر کوتاه شد.');
				node = image;
			} else {
				const placeholder = createBuilderNode('Text');
				placeholder.props.text = `مؤلفهٔ پشتیبانی‌نشدهٔ Elementor (${widget.slice(0, 80)}) — جایگزین کنید.`;
				warn(id, 'unsupported-widget', `ویجت ${widget.slice(0, 80)} تبدیل نشد؛ جایگزین کنید.`);
				node = placeholder;
			}
		} else {
			throw new Error(`نوع ساختار Elementor پشتیبانی نمی‌شود: ${raw.elType.slice(0, 80)}`);
		}
		converted++;
		const alignment = use('align');
		if (alignment && (node.type === 'Heading' || node.type === 'Text' || node.type === 'Button' || splitTextNodes)) {
			const targets = splitTextNodes ?? (node.type === 'Heading' || node.type === 'Text' || node.type === 'Button' ? [node] : []);
			if (alignment === 'center' || alignment === 'right' || alignment === 'left') {
				for (const target of targets) target.props.align = alignment === 'center' ? 'center' : alignment === 'right' ? 'start' : 'end';
			} else warn(id, 'alignment', 'تراز متن پشتیبانی نمی‌شود.');
		} else if (alignment) warn(id, 'alignment', 'تراز این مؤلفه منتقل نشد.');
		for (const [sourceKey, breakpoint] of [['_margin', 'desktop'], ['_margin_tablet', 'tablet'], ['_margin_mobile', 'mobile'], ['_padding', 'desktop'], ['_padding_tablet', 'tablet'], ['_padding_mobile', 'mobile']] as const) {
			const rawSpacing = use(sourceKey);
			if (rawSpacing === undefined || rawSpacing === null || rawSpacing === '') continue;
			if (!record(rawSpacing) || (rawSpacing.unit !== undefined && rawSpacing.unit !== 'px')) { warn(id, 'spacing', `واحد ${sourceKey} پشتیبانی نمی‌شود.`); continue; }
			const isPadding = sourceKey.startsWith('_padding');
			const sides = isPadding ? { top: 'paddingBlockStart', bottom: 'paddingBlockEnd', right: 'paddingInlineStart', left: 'paddingInlineEnd' } as const : { top: 'marginBlockStart', bottom: 'marginBlockEnd' } as const;
			const styles: Partial<NodeStyles> = {};
			for (const [side, property] of Object.entries(sides)) {
				const value = rawSpacing[side];
				if (value === '' || value === undefined || value === null) continue;
				const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
				if (!(SPACING_STEPS as readonly number[]).includes(number)) { warn(id, 'spacing', `${sourceKey}.${side} با فاصله‌های مجاز سازگار نیست.`); continue; }
				(styles as Record<string, unknown>)[property] = number;
			}
			if (!isPadding && [rawSpacing.left, rawSpacing.right].some((v) => v !== undefined && v !== '' && v !== null)) warn(id, 'spacing', 'حاشیهٔ افقی پشتیبانی نمی‌شود.');
			if (Object.keys(styles).length) {
				if (breakpoint === 'desktop') node.styles = { ...node.styles, ...styles };
				else node.responsiveStyles = { ...node.responsiveStyles, [breakpoint]: { ...node.responsiveStyles?.[breakpoint], ...styles } as ResponsiveNodeStyles };
			}
		}
		const ignored = Object.keys(settings).filter((key) => !known.has(key) && settings[key] !== '' && settings[key] !== null && settings[key] !== undefined);
		if (ignored.length) warn(id, 'unsupported-settings', `تنظیمات منتقل‌نشده: ${ignored.slice(0, 20).join('، ').slice(0, 500)}${ignored.length > 20 ? '…' : ''}`);
		return node;
	};
	const nodes = parsed.content.map((item) => convert(item, 1));
	warn('document', 'scope', 'تنظیمات سند، محتوای پویا، قالب‌بندی پیشرفته و افزونه‌های وردپرس منتقل نمی‌شوند؛ فایل اصلی را نگه دارید.');
	warn('document', 'breakpoints', 'مقادیر واکنش‌گرا به اندازه‌های پیش‌فرض نووکس نگاشت شدند؛ نقاط شکست سفارشی Elementor منتقل نمی‌شوند.');
	return { document: validatePageDocument({ ...target, nodes }, target.slug), warnings, converted, supportedWidgets, unsupportedWidgets, missingAssets };
}
