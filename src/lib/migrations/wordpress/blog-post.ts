import { textRuns, isTextBoundary, type TextRun } from '../../builder/rich-text.ts';
import type { BuilderNode, TextMark } from '../../builder/types.ts';
import { resolveBuilderImageSource } from '../../builder/media-reference.ts';
import { isValidPageSlug } from '../../builder/document.ts';
import type { MigrationMediaMap } from '../media-map.ts';
import { htmlToBuilderNodes } from '../html-to-nodes.ts';
import { parseInlineHtml } from '../inline-html.ts';
import type { WxrInspection, WxrItem } from './wxr.ts';

export interface WxrBlogDraft {
	title: string;
	description: string;
	slug: string;
	pubDate: string;
	tags: string[];
	body: string;
	draft: true;
	warnings: string[];
}

// Never emit source HTML. Escape Markdown syntax as well as HTML so content
// cannot introduce new links, images, blocks or executable markup.
function escapeMarkdown(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/[\\`*_{}\[\]()#+.!|~\-]/g, '\\$&');
}
function markdownDestination(href: string): string {
	return href.replace(/[\s()<>]/g, (character) => encodeURIComponent(character));
}
function renderRun(run: TextRun): string {
	return run.text.split('\n').map((line) => {
		const leading = /^\s*/.exec(line)?.[0] ?? '';
		const trailing = /\s*$/.exec(line)?.[0] ?? '';
		const end = Math.max(leading.length, line.length - trailing.length);
		const middle = line.slice(leading.length, end);
		if (!middle) return escapeMarkdown(line);
		let text = escapeMarkdown(middle);
		if (run.italic) text = `*${text}*`;
		if (run.bold) text = `**${text}**`;
		if (run.href) text = `[${text}](${markdownDestination(run.href)})`;
		return escapeMarkdown(leading) + text + escapeMarkdown(line.slice(end));
	}).join('  \n');
}
function inline(text: string, marks?: TextMark[]): string {
	return textRuns(text, marks).map(renderRun).join('');
}
function nodeMarkdown(node: BuilderNode): string {
	switch (node.type) {
		case 'Heading': return `${'#'.repeat(node.props.level)} ${inline(node.props.text, node.props.marks)}`;
		case 'Text': return inline(node.props.text, node.props.marks);
		case 'Blockquote': return inline(node.props.text, node.props.marks).split('\n').map((line) => `> ${line}`).join('\n');
		case 'Button': return node.props.href ? `[${escapeMarkdown(node.props.label)}](${markdownDestination(node.props.href)})` : escapeMarkdown(node.props.label);
		case 'List': return node.props.items.map((item, index) => {
			const content = inline(item.text, item.marks);
			const linked = item.href ? `[${content}](${markdownDestination(item.href)})` : content;
			const prefix = node.props.kind === 'ordered' ? `${index + 1}. ` : '- ';
			return prefix + linked.replace(/\n/g, '\n   ');
		}).join('\n');
		case 'Image': return node.props.src
			? `![${escapeMarkdown(node.props.alt)}](${markdownDestination(resolveBuilderImageSource(node.props.src))})`
			: escapeMarkdown(node.props.alt ? `[تصویر: ${node.props.alt}]` : '[تصویر منتقل‌نشده]');
		default: throw new Error('نوع محتوای HTML برای ورود نوشته پشتیبانی نمی‌شود؛ هیچ نوشته‌ای ساخته نشد.');
	}
}
function singleLine(value: string): string { return value.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim(); }
function bounded(value: string, limit: number): string {
	let end = Math.min(value.length, limit);
	if (!isTextBoundary(value, end)) end--;
	return value.slice(0, end);
}
function sourceDate(value: string | undefined): string | null {
	if (!value) return null;
	const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
	// Require an explicit timezone; silently interpreting local WordPress time
	// in the server's timezone can change the date.
	if (!/(?:Z|[+-]\d\d:?\d\d|GMT|UTC)$/i.test(normalized)) return null;
	const date = new Date(normalized);
	if (Number.isNaN(date.valueOf())) return null;
	const iso = date.toISOString();
	if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(normalized) && iso.slice(0, 19) !== normalized.slice(0, 19)) return null;
	return iso;
}

/** Convert one inspected WordPress post into the existing CMS's Markdown model.
 * This never fetches media or executes source markup and always creates a draft. */
export function wxrPostToBlogDraft(item: WxrItem, mediaMap?: MigrationMediaMap): WxrBlogDraft {
	if (item.type !== 'post') throw new Error('فقط نوشتهٔ وردپرس می‌تواند به نوشتهٔ مجله تبدیل شود.');
	const warnings: string[] = [];
	const seen = new Set<string>();
	const nodes = htmlToBuilderNodes(item.content, mediaMap, (code, message) => {
		if (!seen.has(code)) { seen.add(code); warnings.push(message); }
	});
	const body = nodes.map(nodeMarkdown).filter(Boolean).join('\n\n');
	const title = singleLine(item.blogTitle ?? item.title) || 'بدون عنوان';
	if (item.blogTitleTruncated) warnings.push('عنوان منبع برای محدودیت نوشته به ۲۰۰ نویسه کوتاه شد.');
	const excerpt = parseInlineHtml(item.excerpt);
	if (excerpt.unsafeLinks || excerpt.unsupportedMarkup) warnings.push('قالب‌بندی یا پیوندهای چکیده در توضیح ساده منتقل نشدند.');
	const rawDescription = singleLine(excerpt.text);
	const description = bounded(rawDescription || title, 300);
	if (!rawDescription) warnings.push('چکیده وجود نداشت؛ عنوان به‌صورت توضیح اولیه استفاده شد.');
	else if (description.length < rawDescription.length) warnings.push('چکیده برای توضیح نوشته کوتاه شد؛ متن اصلی تغییر نکرد.');
	const pubDate = sourceDate(item.sourceDate);
	if (!pubDate) warnings.push('تاریخ معتبر دارای منطقهٔ زمانی پیدا نشد؛ تاریخ فعلی استفاده شد.');
	if (item.elementorData) warnings.push('این مسیر HTML وردپرس را تبدیل می‌کند، نه طرح یا دادهٔ Elementor را.');
	const images = nodes.filter((node) => node.type === 'Image');
	if (images.some((node) => !node.props.src)) warnings.push('تصاویر به متن جای‌نگهدار تبدیل شدند مگر آن‌که به رسانهٔ محلی نگاشت شده باشند.');
	if (images.some((node) => Boolean(node.props.src))) warnings.push('تصاویر نگاشت‌شده به رسانهٔ محلی موجود پیوند دارند و از سایت منبع بارگیری نمی‌شوند.');
	warnings.push('نویسنده، دیدگاه‌ها و وضعیت انتشار خودکار منتقل نمی‌شوند.');
	const tags: string[] = [];
	if (item.categories?.length) warnings.push('دسته‌ها و برچسب‌های وردپرس بدون تمایز به برچسب‌های مجله تبدیل شدند.');
	for (const category of item.categories ?? []) {
		const tag = bounded(singleLine(category), 80);
		if (!tag || /[,،]/.test(tag)) { warnings.push('یکی از دسته‌ها به‌دلیل نشانه‌گذاری پشتیبانی‌نشده منتقل نشد.'); continue; }
		if (tag.length < singleLine(category).length) warnings.push('یکی از دسته‌های بلند کوتاه شد.');
		if (!tags.includes(tag)) tags.push(tag);
	}
	return { title, description, slug: item.slug, pubDate: pubDate ?? new Date().toISOString(), tags, body, draft: true, warnings: [...new Set(warnings)] };
}

/** Prepare actual CMS blog drafts from post entries only. Pages stay separate;
 * generated names are deterministic and publication is never requested. */
export function wxrToBlogDrafts(inspection: WxrInspection, prefix: string, mediaMap?: MigrationMediaMap): WxrBlogDraft[] {
	if (!isValidPageSlug(prefix)) throw new Error('پیشوند نامک معتبر نیست.');
	const posts = inspection.items.filter((item) => item.type === 'post');
	if (!posts.length || posts.length > 20) throw new Error('برای ورود گروهی، فایل باید بین ۱ تا ۲۰ نوشته داشته باشد.');
	return posts.map((item, index) => {
		const slug = `${prefix}-${index + 1}`;
		if (!isValidPageSlug(slug)) throw new Error('نامک تولیدشده بیش از حد طولانی است.');
		return { ...wxrPostToBlogDraft(item, mediaMap), slug };
	});
}
