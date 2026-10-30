import { validatePageDocument } from '../../builder/document.ts';
import { createBuilderNode } from '../../builder/operations.ts';
import { safeHref } from '../../builder/registry.ts';
import { SPACING_STEPS, type BuilderNode, type NodeStyles, type PageDocument, type ResponsiveNodeStyles } from '../../builder/types.ts';

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

export function convertElementorJson(json: string, target: PageDocument): ElementorImport {
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
		let node: BuilderNode;
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
			const supported = ['heading', 'text-editor', 'button', 'image', 'image-box', 'icon-list'].includes(widget);
			const counts = supported ? supportedWidgets : unsupportedWidgets;
			counts[widget] = (counts[widget] ?? 0) + 1;
			if (Array.isArray(raw.elements) && raw.elements.length) warn(id, 'widget-children', 'فرزندان ویجت منتقل نشدند.');
			if (widget === 'heading') {
				const heading = createBuilderNode('Heading');
				const title = plainText(use('title'));
				if (title.length > 240) warn(id, 'truncated', 'متن تیتر به ۲۴۰ نویسه محدود شد.');
				heading.props.text = title.slice(0, 240);
				const tag = use('header_size');
				if (typeof tag === 'string' && /^h[1-4]$/.test(tag)) heading.props.level = Number(tag[1]) as 1 | 2 | 3 | 4;
				else if (tag) warn(id, 'heading-level', 'سطح تیتر پشتیبانی نمی‌شود.');
				node = heading;
			} else if (widget === 'text-editor') {
				const text = createBuilderNode('Text');
				const source = use('editor');
				const content = plainText(source);
				if (content.length > 5000) warn(id, 'truncated', 'متن به ۵۰۰۰ نویسه محدود شد.');
				text.props.text = content.slice(0, 5000);
				if (typeof source === 'string' && /<[^>]+>/.test(source)) warn(id, 'rich-text', 'قالب‌بندی HTML حذف شد؛ متن را بررسی کنید.');
				node = text;
			} else if (widget === 'button') {
				const button = createBuilderNode('Button');
				const label = plainText(use('text'));
				if (label.length > 80) warn(id, 'truncated', 'متن دکمه به ۸۰ نویسه محدود شد.');
				button.props.label = label.slice(0, 80);
				const link = use('link');
				const href = record(link) && typeof link.url === 'string' ? link.url : '';
				if (href && safeHref(href) && href.length <= 500) button.props.href = href;
				else if (href) warn(id, 'unsafe-link', 'نشانی ناامن دکمه حذف شد.');
				if (record(link) && Object.keys(link).some((key) => key !== 'url' && link[key])) warn(id, 'link-options', 'تنظیمات اضافی پیوند منتقل نشد.');
				node = button;
			} else if (widget === 'icon-list') {
				const list = createBuilderNode('Container');
				list.props.gap = 8;
				list.props.padding = 0;
				const entries = use('icon_list');
				if (!Array.isArray(entries)) throw new Error('فهرست موارد ویجت Elementor معتبر نیست.');
				if (entries.length > 50) throw new Error('فهرست Elementor بیش از ۵۰ مورد دارد.');
				for (const entry of entries) {
					if (!record(entry)) throw new Error('یکی از موارد فهرست Elementor معتبر نیست.');
					const text = plainText(entry.text);
					const linkRecord = record(entry.link) ? entry.link : null;
					const link = linkRecord && typeof linkRecord.url === 'string' ? linkRecord.url : '';
					if (link && safeHref(link) && link.length <= 500 && text.length <= 80) {
						const button = createBuilderNode('Button');
						button.props.label = text;
						button.props.href = link;
						button.props.variant = 'outline';
						list.children.push(button);
					} else {
						const paragraph = createBuilderNode('Text');
						paragraph.props.text = text.slice(0, 5000);
						list.children.push(paragraph);
						if (text.length > 5000) warn(id, 'truncated', 'متن فهرست به ۵۰۰۰ نویسه محدود شد.');
						if (link) warn(id, 'list-link', 'پیوند ناامن یا ناسازگار با محدودیت متن دکمه منتقل نشد.');
					}
					if (linkRecord && Object.keys(linkRecord).some((key) => key !== 'url' && linkRecord[key])) warn(id, 'link-options', 'تنظیمات اضافی پیوند فهرست منتقل نشد.');
				}
				warn(id, 'list-layout', 'فهرست به متن و دکمه‌های بومی تبدیل شد؛ آیکن‌ها و معنای فهرست منتقل نشدند.');
				node = list;
			} else if (widget === 'image-box') {
				const box = createBuilderNode('Container');
				const image = createBuilderNode('Image');
				const heading = createBuilderNode('Heading');
				const text = createBuilderNode('Text');
				const source = use('image');
				missingAssets++;
				warn(id, record(source) && (source.url || source.id) ? 'asset' : 'missing-asset', 'تصویر جعبه منتقل نشد؛ از کتابخانهٔ رسانه انتخاب کنید.');
				const title = plainText(use('title_text'));
				const description = plainText(use('description_text'));
				if (title.length > 240 || description.length > 5000) warn(id, 'truncated', 'متن جعبه به محدودیت سند کوتاه شد.');
				heading.props.text = title.slice(0, 240);
				text.props.text = description.slice(0, 5000);
				box.children = [image, heading, text];
				warn(id, 'image-box-layout', 'چیدمان جعبهٔ تصویر تقریبی است؛ پیوند، رنگ و اندازه را بررسی کنید.');
				node = box;
			} else if (widget === 'image') {
				const image = createBuilderNode('Image');
				missingAssets++;
				const source = use('image');
				if (record(source) && (source.url || source.id)) warn(id, 'asset', 'تصویر منتقل نشد؛ آن را از کتابخانهٔ رسانه انتخاب کنید. هیچ نشانی راه دور بارگیری نشد.');
				else warn(id, 'missing-asset', 'تصویر در خروجی موجود نیست؛ از کتابخانهٔ رسانه انتخاب کنید.');
				image.props.caption = plainText(use('caption')).slice(0, 240);
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
		if (alignment && (node.type === 'Heading' || node.type === 'Text' || node.type === 'Button')) {
			if (alignment === 'center') node.props.align = 'center';
			else if (alignment === 'right') node.props.align = 'start';
			else if (alignment === 'left') node.props.align = 'end';
			else warn(id, 'alignment', 'تراز متن پشتیبانی نمی‌شود.');
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
