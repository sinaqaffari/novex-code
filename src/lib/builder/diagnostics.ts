import { validatePageDocument, hiddenAtBreakpoint } from './document.ts';
import { resolvePluginParts } from './plugin-components.ts';
import { builderMediaReferenceFromPublicUrl, parseBuilderMediaReference } from './media-reference.ts';
import type { BuilderNode, PageDocument } from './types.ts';

export interface BuilderDiagnostic {
	code: 'empty-page' | 'missing-description' | 'empty-heading' | 'empty-button-label' | 'extra-h1' | 'empty-image' | 'missing-alt' | 'missing-media' | 'external-image' | 'placeholder-link' | 'hidden-everywhere';
	message: string;
	nodeId?: string;
}

/** Non-blocking content checks. The caller supplies local-file inspection; URLs are never fetched. */
export async function diagnosePageDocument(input: unknown, expectedSlug: string, assetExists: (path: string) => Promise<boolean>): Promise<BuilderDiagnostic[]> {
	const document: PageDocument = validatePageDocument(input, expectedSlug);
	const results: BuilderDiagnostic[] = [];
	const assets = new Map<string, Promise<boolean>>();
	const add = (code: BuilderDiagnostic['code'], message: string, nodeId?: string) => results.push({ code, message, ...(nodeId ? { nodeId } : {}) });
	if (!document.nodes.length) add('empty-page', 'صفحه محتوایی ندارد.');
	if (!document.description.trim()) add('missing-description', 'توضیح صفحه برای موتورهای جست‌وجو خالی است.');
	async function visit(node: BuilderNode): Promise<void> {
		if (hiddenAtBreakpoint(node, 'desktop') && hiddenAtBreakpoint(node, 'tablet') && hiddenAtBreakpoint(node, 'mobile')) add('hidden-everywhere', 'این مؤلفه در هر سه اندازه پنهان است.', node.id);
		if (node.type === 'Heading') {
			if (!node.props.text.trim()) add('empty-heading', 'متن تیتر خالی است.', node.id);
			if (node.props.level === 1) add('extra-h1', 'عنوان صفحه خود یک H1 است؛ سطح این تیتر را بررسی کنید.', node.id);
		}
		if (node.type === 'Button') {
			if (!node.props.href || node.props.href === '#') add('placeholder-link', 'نشانی دکمه هنوز تنظیم نشده است.', node.id);
			if (!node.props.label.trim()) add('empty-button-label', 'متن دکمه خالی است.', node.id);
		}
		if (node.type === 'PluginBlock') {
			for (const part of resolvePluginParts(node.props)) {
				if (part.type === 'heading' && !part.text.trim()) add('empty-heading', 'متن تیتر مؤلفهٔ افزونه خالی است.', node.id);
				if (part.type === 'button' && !part.text.trim()) add('empty-button-label', 'متن دکمهٔ مؤلفهٔ افزونه خالی است.', node.id);
				if (part.type === 'button' && part.href === '#') add('placeholder-link', 'نشانی دکمهٔ مؤلفهٔ افزونه هنوز تنظیم نشده است.', node.id);
			}
		}
		if (node.type === 'Image') {
			if (!node.props.src) add('empty-image', 'برای این تصویر فایلی انتخاب نشده است.', node.id);
			else {
				if (!node.props.alt.trim()) add('missing-alt', 'متن جایگزین تصویر خالی است؛ برای تصویر تزئینی نیز این مورد را آگاهانه بررسی کنید.', node.id);
				const ref = parseBuilderMediaReference(node.props.src) ?? parseBuilderMediaReference(builderMediaReferenceFromPublicUrl(node.props.src) ?? '');
				if (ref) {
					const path = `${ref.bucket === 'uploads' ? 'uploads/' : ''}${ref.name}`;
					if (!assets.has(path)) assets.set(path, assetExists(path));
					if (!await assets.get(path)!) add('missing-media', 'فایل رسانهٔ انتخاب‌شده در کتابخانه پیدا نشد.', node.id);
				} else if (/^https:\/\//i.test(node.props.src)) add('external-image', 'دسترسی‌پذیری تصویر خارجی بررسی نشده است.', node.id);
			}
		}
		if (node.type === 'Container') for (const child of node.children) await visit(child);
	}
	for (const node of document.nodes) await visit(node);
	return results;
}
