import { createEmptyPageDocument, validatePageDocument } from './document.ts';
import { addNode, createNodeId, updateNodeProps } from './operations.ts';
import type { BuilderNode, PageDocument } from './types.ts';

export interface StarterTemplate {
	id: string;
	label: string;
	description: string;
	document: PageDocument;
}

function createHeroTemplate(): PageDocument {
	let document: PageDocument = { ...createEmptyPageDocument('starter-hero', 'شروعی روشن'), themeId: 'ocean' };
	document = addNode(document, 'Container', { id: 'node_templatehero01' });
	document = updateNodeProps(document, 'node_templatehero01', { layout: 'stack', maxWidth: 'lg', gap: 16, padding: 32, background: 'surface' });
	document = addNode(document, 'Heading', { parentId: 'node_templatehero01', id: 'node_templatehead01' });
	document = updateNodeProps(document, 'node_templatehead01', { text: 'راهکار ساده برای شروع بزرگ', level: 1, size: 'xl', color: 'ink' });
	document = addNode(document, 'Text', { parentId: 'node_templatehero01', id: 'node_templatesub001' });
	document = updateNodeProps(document, 'node_templatesub001', { text: 'از ایدهٔ خودتان یک تجربهٔ روشن و قابل اعتماد بسازید.', size: 'lg', color: 'muted' });
	document = addNode(document, 'Button', { parentId: 'node_templatehero01', id: 'node_templatebtn001' });
	document = updateNodeProps(document, 'node_templatebtn001', { label: 'شروع کنید', href: '#contact', variant: 'primary' });
	return document;
}

function createGridTemplate(): PageDocument {
	let document: PageDocument = { ...createEmptyPageDocument('starter-grid', 'خدمات ما'), themeId: 'site' };
	document = addNode(document, 'Heading', { id: 'node_templategrid01' });
	document = updateNodeProps(document, 'node_templategrid01', { text: 'راهکارهایی برای هر مرحله', level: 1, size: 'xl', align: 'center' });
	document = addNode(document, 'Container', { id: 'node_templategrid02' });
	document = updateNodeProps(document, 'node_templategrid02', { layout: 'grid', maxWidth: 'lg', gap: 16, padding: 16, background: 'soft' });
	const cards = [
		['node_templatecard01', 'node_templatecardh01', 'برنامه‌ریزی', 'از هدف روشن تا مسیر اجرایی.'],
		['node_templatecard02', 'node_templatecardh02', 'طراحی تجربه', 'ساده، سریع و سازگار با مخاطب.'],
		['node_templatecard03', 'node_templatecardh03', 'رشد پایدار', 'بهبودهایی که با داده سنجیده می‌شوند.'],
	] as const;
	for (const [containerId, headingId, title, subtitle] of cards) {
		document = addNode(document, 'Container', { parentId: 'node_templategrid02', id: containerId });
		document = updateNodeProps(document, containerId, { layout: 'stack', maxWidth: 'full', gap: 8, padding: 16, background: 'surface' });
		document = addNode(document, 'Heading', { parentId: containerId, id: headingId });
		document = updateNodeProps(document, headingId, { text: title, level: 2, size: 'md', color: 'brand' });
		const subtitleId = `${containerId}sub`;
		document = addNode(document, 'Text', { parentId: containerId, id: subtitleId });
		document = updateNodeProps(document, subtitleId, { text: subtitle, size: 'sm', color: 'muted' });
	}
	return document;
}

function createCtaTemplate(): PageDocument {
	let document: PageDocument = { ...createEmptyPageDocument('starter-cta', 'یک گفت‌وگوی خوب شروع کنیم'), themeId: 'warm' };
	document = addNode(document, 'Container', { id: 'node_templatecta001' });
	document = updateNodeProps(document, 'node_templatecta001', { layout: 'row', maxWidth: 'lg', gap: 24, padding: 32, background: 'soft' });
	document = addNode(document, 'Heading', { parentId: 'node_templatecta001', id: 'node_templatectah01' });
	document = updateNodeProps(document, 'node_templatectah01', { text: 'برای قدم بعدی آماده‌اید؟', level: 2, size: 'lg', color: 'ink' });
	document = addNode(document, 'Button', { parentId: 'node_templatecta001', id: 'node_templatectab01' });
	document = updateNodeProps(document, 'node_templatectab01', { label: 'با ما صحبت کنید', href: '#contact', variant: 'outline', align: 'end' });
	return document;
}

function createStorefrontTemplate(): PageDocument {
	let document: PageDocument = { ...createEmptyPageDocument('starter-storefront', 'فروشگاه'), themeId: 'site' };
	document = { ...document, description: 'معرفی فروشگاه با پیوند به کاتالوگ، سبد خرید، پرداخت و اطلاعات تماس موجود در سایت.' };
	document = addNode(document, 'Container', { id: 'node_templatestore01' });
	document = updateNodeProps(document, 'node_templatestore01', { layout: 'stack', maxWidth: 'lg', gap: 16, padding: 32, background: 'surface' });
	document = addNode(document, 'Heading', { parentId: 'node_templatestore01', id: 'node_templestoreh1' });
	document = updateNodeProps(document, 'node_templestoreh1', { text: 'خریدی روشن و ساده', level: 1, size: 'xl', color: 'ink' });
	document = addNode(document, 'Text', { parentId: 'node_templatestore01', id: 'node_templestoretxt' });
	document = updateNodeProps(document, 'node_templestoretxt', { text: 'محصولات منتشرشده، قیمت و موجودی واقعی را در کاتالوگ فروشگاه ببینید. این الگو از محصول یا آمار ساختگی استفاده نمی‌کند.', size: 'lg', color: 'muted' });
	document = addNode(document, 'Button', { parentId: 'node_templatestore01', id: 'node_templestorebtn' });
	document = updateNodeProps(document, 'node_templestorebtn', { label: 'رفتن به فروشگاه', href: '/shop', variant: 'primary' });
	document = addNode(document, 'Container', { id: 'node_templestoregrid' });
	document = updateNodeProps(document, 'node_templestoregrid', { layout: 'grid', maxWidth: 'lg', gap: 16, padding: 16, background: 'soft' });
	const routes = [
		['01', 'کاتالوگ و جزئیات محصول', 'فهرست فقط از محصولات فعال استفاده می‌کند؛ هر کارت محصول به صفحهٔ جزئیات همان نامک پیوند دارد.', '/shop', 'مرور محصولات'],
		['02', 'سبد خرید', 'اقلام و تعداد انتخاب‌شده را در سبد خرید فعلی مرور کنید.', '/shop/cart', 'بازکردن سبد'],
		['03', 'تکمیل سفارش', 'فرم سفارش از سبد خرید استفاده می‌کند؛ پرداخت آنلاین به پیکربندی درگاه وابسته است.', '/shop/checkout', 'ادامهٔ سفارش'],
		['04', 'تماس و اطلاعات سایت', 'نشانی تماس از تنظیمات واقعی سایت خوانده می‌شود و در نبود آن پیام روشنی نمایش داده می‌شود.', '/about', 'اطلاعات و تماس'],
	] as const;
	for (const [index, heading, body, href, label] of routes) {
		const suffix = index;
		const cardId = `node_templestorec${suffix}`;
		const headingId = `node_templestoreh${suffix}`;
		const textId = `node_templestoret${suffix}`;
		const buttonId = `node_templestoreb${suffix}`;
		document = addNode(document, 'Container', { parentId: 'node_templestoregrid', id: cardId });
		document = updateNodeProps(document, cardId, { layout: 'stack', maxWidth: 'full', gap: 8, padding: 16, background: 'surface' });
		document = addNode(document, 'Heading', { parentId: cardId, id: headingId });
		document = updateNodeProps(document, headingId, { text: heading, level: 2, size: 'md', color: 'brand' });
		document = addNode(document, 'Text', { parentId: cardId, id: textId });
		document = updateNodeProps(document, textId, { text: body, size: 'sm', color: 'muted' });
		document = addNode(document, 'Button', { parentId: cardId, id: buttonId });
		document = updateNodeProps(document, buttonId, { label, href, variant: 'outline' });
	}
	return document;
}

const templates: StarterTemplate[] = [
	{ id: 'hero-intro', label: 'معرفی ساده', description: 'بخش معرفی با تیتر اصلی و دکمهٔ اقدام.', document: createHeroTemplate() },
	{ id: 'feature-grid', label: 'شبکهٔ سه‌ستونه', description: 'چیدمان شبکه‌ای واکنش‌گرا با سه کارت نمونه.', document: createGridTemplate() },
	{ id: 'contact-cta', label: 'دعوت به گفت‌وگو', description: 'بخش اقدام نهایی با رنگ‌بندی گرم.', document: createCtaTemplate() },
	{ id: 'storefront-start', label: 'فروشگاه فارسی', description: 'صفحهٔ آغاز با پیوند به کاتالوگ و مسیرهای واقعی فروشگاه؛ بدون محصول ساختگی.', document: createStorefrontTemplate() },
];

export function listStarterTemplates(): StarterTemplate[] {
	return templates.map((template) => ({ ...template, document: structuredClone(template.document) }));
}

export function applyTemplate(
	templateDocument: PageDocument,
	currentDocument: PageDocument,
	idFactory: () => string = createNodeId,
): PageDocument {
	const source = validatePageDocument(templateDocument);
	return validatePageDocument({
		...currentDocument,
		themeId: source.themeId,
		nodes: source.nodes.map((node) => cloneNode(node, idFactory)),
	}, currentDocument.slug);
}

export function templateDocumentForPage(
	template: PageDocument,
	page: PageDocument,
	idFactory: () => string = createNodeId,
): PageDocument {
	return applyTemplate(template, page, idFactory);
}

function cloneNode(node: BuilderNode, idFactory: () => string): BuilderNode {
	if (node.type === 'Container') {
		return { ...node, id: idFactory(), children: node.children.map((child) => cloneNode(child, idFactory)) };
	}
	return { ...node, id: idFactory() };
}
