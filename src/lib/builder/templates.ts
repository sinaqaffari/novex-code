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

function createBusinessPageTemplate(): PageDocument {
	let document: PageDocument = { ...createEmptyPageDocument('business-page', 'صفحهٔ تجاری'), themeId: 'site' };

	// === Header / Navigation ===
	document = addNode(document, 'Container', { id: 'node_bp_header01' });
	document = updateNodeProps(document, 'node_bp_header01', { layout: 'row', maxWidth: 'full', gap: 24, padding: 16, background: 'surface' });
	document = addNode(document, 'Heading', { parentId: 'node_bp_header01', id: 'node_bp_head01' });
	document = updateNodeProps(document, 'node_bp_head01', { text: 'نووکس‌کد', level: 1, size: 'xl', color: 'brand', align: 'start' });
	document = addNode(document, 'Text', { parentId: 'node_bp_header01', id: 'node_bp_sub01' });
	document = updateNodeProps(document, 'node_bp_sub01', { text: 'ساخت وب‌سایت حرفه‌ای با ویرایشگر بصری نووکس‌کد', size: 'sm', color: 'muted', align: 'start' });
	document = addNode(document, 'Button', { parentId: 'node_bp_header01', id: 'node_bp_btn01' });
	document = updateNodeProps(document, 'node_bp_btn01', { label: 'شروع کنید', href: '#contact', variant: 'primary', align: 'end' });

	// === Hero Section ===
	document = addNode(document, 'Container', { id: 'node_bp_hero01' });
	document = updateNodeProps(document, 'node_bp_hero01', { layout: 'stack', maxWidth: 'lg', gap: 32, padding: 48, background: 'soft' });
	document = addNode(document, 'Heading', { parentId: 'node_bp_hero01', id: 'node_bp_heroh01' });
	document = updateNodeProps(document, 'node_bp_heroh01', { text: 'وب‌سایت شما، زیبا و سریع', level: 1, size: 'xl', color: 'ink', align: 'center' });
	document = addNode(document, 'Text', { parentId: 'node_bp_hero01', id: 'node_bp_herot01' });
	document = updateNodeProps(document, 'node_bp_herot01', { text: 'از بخش‌ها و مؤلفه‌های آماده استفاده کنید و سایت تجاری یا شخصی خود را بدون نوشتن کد منتشر کنید.', size: 'lg', color: 'muted', align: 'center' });
	document = addNode(document, 'Button', { parentId: 'node_bp_hero01', id: 'node_bp_herobtn01' });
	document = updateNodeProps(document, 'node_bp_herobtn01', { label: 'نمایش تمپلت‌ها', href: '#templates', variant: 'primary', align: 'center' });

	// === Responsive Grid: Feature Cards ===
	document = addNode(document, 'Container', { id: 'node_bp_grid01' });
	document = updateNodeProps(document, 'node_bp_grid01', { layout: 'grid', maxWidth: 'lg', gap: 16, padding: 32, background: 'none' });

	const features = [
		['ویرایشگر بصری', 'جره و رها کنید، ویرایش آن‌لاین و پیش‌نمایش فوری در همه اندازه‌ها.', '/#features'],
		['فروشگاه اینترنتی', 'كتالوغ محصولات، سبد خرید و پرداخت با موجودی واقعی، بدون داده ساختگی.', '/shop'],
		['تایپوگرافی فارسی', 'فونت وازیرمتن و سیستم طراحی راست‌به‌چپ برای محتوای فارسی.', '/blog'],
		['پشتیبانی RTL', 'راست‌به‌چپ در هر قسمتی از سایت، دسکتاپ و موبایل.', '/about'],
	] as const;

	for (const [index, [title, body, href]] of features.entries()) {
		const cardId = `node_bp_feature_${String(index + 1).padStart(2, '0')}`;
		document = addNode(document, 'Container', { parentId: 'node_bp_grid01', id: cardId });
		document = updateNodeProps(document, cardId, { layout: 'stack', maxWidth: 'full', gap: 8, padding: 16, background: 'surface' });
		document = addNode(document, 'Heading', { parentId: cardId, id: `${cardId}h` });
		document = updateNodeProps(document, `${cardId}h`, { text: title, level: 2, size: 'md', color: 'brand' });
		document = addNode(document, 'Text', { parentId: cardId, id: `${cardId}t` });
		document = updateNodeProps(document, `${cardId}t`, { text: body, size: 'sm', color: 'muted' });
		document = addNode(document, 'Button', { parentId: cardId, id: `${cardId}b` });
		document = updateNodeProps(document, `${cardId}b`, { label: 'بیشتر بدانید', href, variant: 'outline', align: 'start' });
	}

	// === Images Section (placeholder images via built-in assets) ===
	document = addNode(document, 'Container', { id: 'node_bp_images01' });
	document = updateNodeProps(document, 'node_bp_images01', { layout: 'stack', maxWidth: 'lg', gap: 24, padding: 32, background: 'none' });
	document = addNode(document, 'Heading', { parentId: 'node_bp_images01', id: 'node_bp_imghead01' });
	document = updateNodeProps(document, 'node_bp_imghead01', { text: 'محتوا بصری', level: 2, size: 'lg', color: 'ink', align: 'center' });
	document = addNode(document, 'Text', { parentId: 'node_bp_images01', id: 'node_bp_imgsub01' });
	document = updateNodeProps(document, 'node_bp_imgsub01', { text: 'تصاویر از کتابخانه رسانه یا مسیرهای داخلی استفاده می‌شوند. تصاویر گم‌شده با وضعیت خالی امن نمایش داده می‌شوند.', size: 'sm', color: 'muted', align: 'center' });

	// === Testimonials ===
	document = addNode(document, 'Container', { id: 'node_bp_testimonials01' });
	document = updateNodeProps(document, 'node_bp_testimonials01', { layout: 'stack', maxWidth: 'lg', gap: 24, padding: 32, background: 'soft' });
	document = addNode(document, 'Heading', { parentId: 'node_bp_testimonials01', id: 'node_bp_testhead01' });
	document = updateNodeProps(document, 'node_bp_testhead01', { text: 'شاهکارها و بازخورد مشتریان', level: 2, size: 'lg', color: 'ink', align: 'center' });
	document = addNode(document, 'Text', { parentId: 'node_bp_testimonials01', id: 'node_bp_testsub01' });
	document = updateNodeProps(document, 'node_bp_testsub01', { text: 'بخش شاهکارها برای نمایش بازخورد مشتریان حقيقية. محتوای شاهکارها توسط مدیر سایت ثبت می‌شود.', size: 'sm', color: 'muted', align: 'center' });

	// === Pricing Section ===
	document = addNode(document, 'Container', { id: 'node_bp_pricing01' });
	document = updateNodeProps(document, 'node_bp_pricing01', { layout: 'grid', maxWidth: 'lg', gap: 16, padding: 32, background: 'none' });

	const plans = [
		['ابتدایی', 'برای کاربرانی که در حال آغاز هستند', 0, '/shop'],
		['حرفه‌ای', 'برای کاربران و تیم‌های کوچک', 0, '/shop'],
		['تجاری', 'برای کسب‌وکارهای فعال و رشد یافته', 0, '/shop'],
	] as const;

	for (const [index, [planName, planDesc, planPrice, planHref]] of plans.entries()) {
		const planId = `node_bp_plan_${String(index + 1).padStart(2, '0')}`;
		document = addNode(document, 'Container', { parentId: 'node_bp_pricing01', id: planId });
		document = updateNodeProps(document, planId, { layout: 'stack', maxWidth: 'full', gap: 8, padding: 16, background: 'surface' });
		document = addNode(document, 'Heading', { parentId: planId, id: `${planId}h` });
		document = updateNodeProps(document, `${planId}h`, { text: planName, level: 2, size: 'md', color: 'brand' });
		document = addNode(document, 'Text', { parentId: planId, id: `${planId}t` });
		document = updateNodeProps(document, `${planId}t`, { text: planDesc, size: 'sm', color: 'muted' });
		document = addNode(document, 'Text', { parentId: planId, id: `${planId}p` });
		document = updateNodeProps(document, `${planId}p`, { text: `${planPrice} تومان`, size: 'lg', color: 'ink' });
		document = addNode(document, 'Button', { parentId: planId, id: `${planId}b` });
		document = updateNodeProps(document, `${planId}b`, { label: 'انتخاب طرح', href: planHref, variant: 'outline', align: 'start' });
	}

	// === FAQ ===
	document = addNode(document, 'Container', { id: 'node_bp_faq01' });
	document = updateNodeProps(document, 'node_bp_faq01', { layout: 'stack', maxWidth: 'lg', gap: 24, padding: 32, background: 'none' });
	document = addNode(document, 'Heading', { parentId: 'node_bp_faq01', id: 'node_bp_faqhead01' });
	document = updateNodeProps(document, 'node_bp_faqhead01', { text: 'سوالات متداول', level: 2, size: 'lg', color: 'ink', align: 'center' });
	document = addNode(document, 'Text', { parentId: 'node_bp_faq01', id: 'node_bp_faqsub01' });
	document = updateNodeProps(document, 'node_bp_faqsub01', { text: 'پاسخ‌های کوتاه به سوالات رایج در مورد ساخت سایت با نووکس‌کد.', size: 'sm', color: 'muted', align: 'center' });

	// === Footer ===
	document = addNode(document, 'Container', { id: 'node_bp_footer01' });
	document = updateNodeProps(document, 'node_bp_footer01', { layout: 'stack', maxWidth: 'full', gap: 16, padding: 24, background: 'surface' });
	document = addNode(document, 'Text', { parentId: 'node_bp_footer01', id: 'node_bp_foottext01' });
	document = updateNodeProps(document, 'node_bp_foottext01', { text: '© نووکس‌کد — ساخته با صفحه‌ساز نووکس‌کد. تمام حقوق محفوظ است.', size: 'sm', color: 'muted', align: 'center' });
	document = addNode(document, 'Button', { parentId: 'node_bp_footer01', id: 'node_bp_footbtn01' });
	document = updateNodeProps(document, 'node_bp_footbtn01', { label: 'تماس با ما', href: '/contact', variant: 'outline', align: 'center' });

	return document;
}

const templates: StarterTemplate[] = [
	{ id: 'hero-intro', label: 'معرفی ساده', description: 'بخش معرفی با تیتر اصلی و دکمهٔ اقدام.', document: createHeroTemplate() },
	{ id: 'feature-grid', label: 'شبکهٔ سه‌ستونه', description: 'چیدمان شبکه‌ای واکنش‌گرا با سه کارت نمونه.', document: createGridTemplate() },
	{ id: 'contact-cta', label: 'دعوت به گفت‌وگو', description: 'بخش اقدام نهایی با رنگ‌بندی گرم.', document: createCtaTemplate() },
	{ id: 'storefront-start', label: 'فروشگاه فارسی', description: 'صفحهٔ آغاز با پیوند به کاتالوگ و مسیرهای واقعی فروشگاه؛ بدون محصول ساختگی.', document: createStorefrontTemplate() },
	{ id: 'business-page', label: 'صفحهٔ تجاری کامل', description: 'صفحهٔ landing تجاری با سربرگ، بخش هیرو، گرید پاسخ‌گو، کارت‌های ویژگی، شاهکارها، بخش قیمت، سوالات متداول و پانوش؛ ساخته از مؤلفه‌های صفحه‌ساز بدون نیاز به کدنویسی.', document: createBusinessPageTemplate() },
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
		breakpoints: source.breakpoints ?? currentDocument.breakpoints,
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
