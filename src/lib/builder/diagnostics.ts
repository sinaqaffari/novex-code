import { DocumentValidationError, validatePageDocument, hiddenAtBreakpoint } from './document.ts';
import { resolvePluginParts } from './plugin-components.ts';
import { localBuilderAssetIdentity, nodeImageReferences } from './assets.ts';
import { videoEmbedUrl } from './extended-content.ts';
import type { BuilderNode, PageDocument } from './types.ts';

export interface BuilderDiagnostic {
	code: 'empty-page' | 'missing-description' | 'empty-heading' | 'empty-button-label' | 'extra-h1' | 'empty-image' | 'missing-alt' | 'missing-media' | 'external-image' | 'placeholder-link' | 'hidden-everywhere' | 'empty-accordion' | 'empty-tabs' | 'empty-list' | 'empty-gallery' | 'empty-video' | 'empty-quote' | 'executable-widget' | 'global-code';
	message: string;
	severity: 'warning';
	nodeId?: string;
	suggestion?: string;
}

export interface ValidationDiagnostic {
	severity: 'error' | 'warning' | 'info';
	code: string;
	message: string;
	path?: string;
	suggestion?: string;
}

/** Shared, non-throwing schema validation for importers, editors and compilers. */
export function validateDocumentWithDiagnostics(input: unknown, expectedSlug?: string):
	| { ok: true; document: PageDocument; diagnostics: [] }
	| { ok: false; diagnostics: ValidationDiagnostic[] } {
	try {
		return { ok: true, document: validatePageDocument(input, expectedSlug), diagnostics: [] };
	} catch (error) {
		if (!(error instanceof DocumentValidationError)) throw error;
		return { ok: false, diagnostics: [{
			severity: 'error', code: error.code, message: error.message,
			...(error.path ? { path: error.path } : {}),
			suggestion: error.code === 'unsupported_document_version' ? 'Keep the original file and use a compatible version of the builder.' : 'Correct the indicated document field and retry.',
		}] };
	}
}

/** Non-blocking content checks. The caller supplies local-file inspection; URLs are never fetched. */
export async function diagnosePageDocument(input: unknown, expectedSlug: string, assetExists: (path: string) => Promise<boolean>): Promise<BuilderDiagnostic[]> {
	const document: PageDocument = validatePageDocument(input, expectedSlug);
	const results: BuilderDiagnostic[] = [];
	const assets = new Map<string, Promise<boolean>>();
	const add = (code: BuilderDiagnostic['code'], message: string, nodeId?: string) => results.push({ code, message, severity: 'warning', ...(nodeId ? { nodeId } : {}) });
	if (!document.nodes.length) add('empty-page', 'صفحه محتوایی ندارد.');
	if (!document.description.trim()) add('missing-description', 'توضیح صفحه برای موتورهای جست‌وجو خالی است.');
	async function visit(node: BuilderNode): Promise<void> {
		const allBreakpoints = ['desktop', 'tablet', 'mobile', ...(document.breakpoints?.custom ?? []).map((range) => range.id)] as const;
		if (allBreakpoints.every((range) => hiddenAtBreakpoint(node, range))) add('hidden-everywhere', 'این مؤلفه در همهٔ اندازه‌ها پنهان است.', node.id);
		if (node.type === 'Heading') {
			if (!node.props.text.trim()) add('empty-heading', 'متن تیتر خالی است.', node.id);
			if (node.props.level === 1) add('extra-h1', 'عنوان صفحه خود یک H1 است؛ سطح این تیتر را بررسی کنید.', node.id);
		}
		if (node.type === 'Button') {
			if (!node.props.href || node.props.href === '#') add('placeholder-link', 'نشانی دکمه هنوز تنظیم نشده است.', node.id);
			if (!node.props.label.trim()) add('empty-button-label', 'متن دکمه خالی است.', node.id);
		}
		const inlineMarks = node.type === 'Text' || node.type === 'Heading' || node.type === 'Blockquote' ? node.props.marks ?? [] : node.type === 'List' ? node.props.items.flatMap((item) => item.marks ?? []) : node.type === 'Accordion' || node.type === 'Tabs' ? node.props.items.flatMap((item) => item.bodyMarks ?? []) : [];
		if (inlineMarks.some((mark) => mark.kind === 'link' && mark.href === '#')) add('placeholder-link', 'نشانی پیوند درون متن هنوز تنظیم نشده است.', node.id);
		if (node.type === 'CodeWidget') add('executable-widget', 'این قاب حاوی کد قابل اجراست؛ پیش از انتشار آن را بررسی کنید.', node.id);
		if (node.type === 'GlobalCode') add('global-code', 'کد صفحه در مبدأ سایت و با دسترسی کامل اجرا می‌شود؛ فقط مدیر پس از بازبینی می‌تواند آن را منتشر کند.', node.id);
		if (node.type === 'PluginBlock') {
			for (const part of resolvePluginParts(node.props)) {
				if (part.type === 'heading' && !part.text.trim()) add('empty-heading', 'متن تیتر مؤلفهٔ افزونه خالی است.', node.id);
				if (part.type === 'button' && !part.text.trim()) add('empty-button-label', 'متن دکمهٔ مؤلفهٔ افزونه خالی است.', node.id);
				if (part.type === 'button' && part.href === '#') add('placeholder-link', 'نشانی دکمهٔ مؤلفهٔ افزونه هنوز تنظیم نشده است.', node.id);
			}
		}
		if (node.type === 'Blockquote' && !node.props.text.trim()) add('empty-quote', 'متن نقل‌قول خالی است.', node.id);
		if (node.type === 'Accordion' && (!node.props.items.length || node.props.items.some((item) => !item.title.trim()))) add('empty-accordion', 'فهرست پرسش خالی است یا عنوان یکی از موارد ثبت نشده است.', node.id);
		if (node.type === 'Tabs' && (!node.props.items.length || node.props.items.some((item) => !item.title.trim()))) add('empty-tabs', 'فهرست زبانه‌ها خالی است یا عنوان یکی از موارد ثبت نشده است.', node.id);
		if (node.type === 'List' && (!node.props.items.length || node.props.items.some((item) => !item.text.trim()))) add('empty-list', 'فهرست خالی است یا متن یکی از موارد ثبت نشده است.', node.id);
		if (node.type === 'ImageGallery' && !node.props.items.length) add('empty-gallery', 'گالری تصویری ندارد.', node.id);
		if (node.type === 'VideoEmbed' && (!videoEmbedUrl(node.props) || !node.props.title.trim())) add('empty-video', 'شناسه یا عنوان ویدئو کامل نیست.', node.id);
		for (const image of nodeImageReferences(node)) {
			if (!image.src) add('empty-image', 'برای این تصویر فایلی انتخاب نشده است.', node.id);
			else {
				if (!image.alt.trim()) add('missing-alt', 'متن جایگزین تصویر خالی است؛ برای تصویر تزئینی نیز این مورد را آگاهانه بررسی کنید.', node.id);
				const identity = localBuilderAssetIdentity(image.src);
				if (identity) {
					const path = identity.startsWith('assets/') ? identity.slice('assets/'.length) : identity;
					if (!assets.has(path)) assets.set(path, assetExists(path));
					if (!await assets.get(path)!) add('missing-media', 'فایل رسانهٔ انتخاب‌شده در کتابخانه پیدا نشد.', node.id);
				} else if (/^https:\/\//i.test(image.src)) add('external-image', 'دسترسی‌پذیری تصویر خارجی بررسی نشده است.', node.id);
			}
		}
		if (node.type === 'Container') for (const child of node.children) await visit(child);
	}
	for (const node of document.nodes) await visit(node);
	return results;
}
