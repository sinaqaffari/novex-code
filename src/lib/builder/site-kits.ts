import { createEmptyPageDocument, isValidPageSlug, validatePageDocument } from './document.ts';
import { getStarterTemplate } from './templates.ts';
import { parseBuilderMediaReference } from './media-reference.ts';
import { nodeImageReferences } from './assets.ts';
import { addNode, findNode, updateNodeProps } from './operations.ts';
import { BUILDER_COMPONENT_TYPES, PAGE_DOCUMENT_SCHEMA_VERSION, type BuilderComponentType, type BuilderNode, type PageDocument } from './types.ts';
import { isSemVer } from '../plugins/validation.ts';

/** Versioned, bundled packages are data only; no executable package entries. */
export interface SiteKit {
	schemaVersion: 1;
	id: string;
	version: string;
	name: string;
	description: string;
	category: string;
	language: 'fa';
	direction: 'rtl';
	minBuilderSchema: number;
	license: string;
	author: string;
	requiredComponents: BuilderComponentType[];
	assets: string[];
	pages: Array<{ suffix: string; title: string; document: PageDocument; links?: Array<{ nodeId: string; targetSuffix: string }> }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): void {
	if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error('بسته دارای فیلد پشتیبانی‌نشده است.');
}
function text(value: unknown, max: number, required = true): value is string {
	return typeof value === 'string' && value.length <= max && (!required || Boolean(value.trim())) && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Strict data-only package validation; unknown fields or executable entries are rejected. */
export function validateSiteKit(input: unknown): SiteKit {
	if (!isRecord(input)) throw new Error('بستهٔ سایت معتبر نیست.');
	onlyKeys(input, ['schemaVersion', 'id', 'version', 'name', 'description', 'category', 'language', 'direction', 'minBuilderSchema', 'license', 'author', 'requiredComponents', 'assets', 'pages']);
	if (input.schemaVersion !== 1 || !Number.isSafeInteger(input.minBuilderSchema) || (input.minBuilderSchema as number) < 1 || (input.minBuilderSchema as number) > PAGE_DOCUMENT_SCHEMA_VERSION || !isValidPageSlug(input.id) || !isSemVer(input.version) || input.version.length > 80 || !text(input.name, 100) || !text(input.description, 500, false) || !text(input.category, 60) || input.language !== 'fa' || input.direction !== 'rtl' || !text(input.license, 100) || !text(input.author, 100)) throw new Error('بستهٔ سایت معتبر یا سازگار نیست.');
	if (!Array.isArray(input.assets) || input.assets.length > 50 || new Set(input.assets).size !== input.assets.length || input.assets.some((asset: unknown) => typeof asset !== 'string' || !parseBuilderMediaReference(asset))) throw new Error('فهرست دارایی‌های محلی معتبر نیست.');
	const assets = input.assets as string[];
	const declaredAssets = new Set(assets);
	if (!Array.isArray(input.requiredComponents) || new Set(input.requiredComponents).size !== input.requiredComponents.length || input.requiredComponents.some((type: unknown) => typeof type !== 'string' || !(BUILDER_COMPONENT_TYPES as readonly string[]).includes(type))) throw new Error('بسته به مؤلفهٔ ناموجود نیاز دارد.');
	const requiredComponents = input.requiredComponents as BuilderComponentType[];
	if (!Array.isArray(input.pages) || !input.pages.length || input.pages.length > 20) throw new Error('تعداد صفحات بسته نامعتبر است.');
	const seen = new Set<string>();
	const used = new Set<BuilderComponentType>();
	const scan = (nodes: BuilderNode[]) => nodes.forEach((node) => {
		if (node.type === 'CodeWidget' || node.type === 'GlobalCode') throw new Error('بستهٔ داده‌محور نمی‌تواند کد اجرایی داشته باشد.');
		if ((input.minBuilderSchema as number) < 5 && ((node.type === 'Text' || node.type === 'Heading' || node.type === 'Blockquote') && node.props.marks?.length || node.type === 'List' && node.props.items.some((item) => item.marks?.length) || (node.type === 'Accordion' || node.type === 'Tabs') && node.props.items.some((item) => item.titleMarks?.length || item.bodyMarks?.length))) throw new Error('قالب‌بندی متن به نسخهٔ ۵ سند صفحه‌ساز نیاز دارد.');
		used.add(node.type);
		for (const image of nodeImageReferences(node)) if (image.src && !declaredAssets.has(image.src)) throw new Error('دارایی تصویر باید به‌صورت محلی در بسته اعلام شود.');
		if (node.type === 'Container') { if (node.sharedSection) throw new Error('بسته نمی‌تواند به منبع مشترک سایت دیگری پیوند داشته باشد.'); scan(node.children); }
	});
	const pages: SiteKit['pages'] = input.pages.map((page: unknown) => {
		if (!isRecord(page)) throw new Error('صفحهٔ بسته معتبر نیست.');
		onlyKeys(page, ['suffix', 'title', 'document', 'links']);
		if (!isValidPageSlug(page.suffix) || seen.has(page.suffix) || !text(page.title, 100)) throw new Error('صفحهٔ بسته معتبر یا یکتا نیست.');
		seen.add(page.suffix);
		const document = validatePageDocument(page.document);
		scan(document.nodes);
		let links: SiteKit['pages'][number]['links'];
		if (page.links !== undefined) {
			if (!Array.isArray(page.links) || page.links.length > 50) throw new Error('پیوندهای بسته معتبر نیستند.');
			links = page.links.map((link: unknown) => {
				if (!isRecord(link)) throw new Error('پیوند بسته معتبر نیست.');
				onlyKeys(link, ['nodeId', 'targetSuffix']);
				if (typeof link.nodeId !== 'string' || typeof link.targetSuffix !== 'string') throw new Error('پیوند بسته معتبر نیست.');
				return { nodeId: link.nodeId, targetSuffix: link.targetSuffix };
			});
		}
		return { suffix: page.suffix, title: page.title, document, ...(links ? { links } : {}) };
	});
	for (const page of pages) {
		const targets = new Set<string>();
		for (const link of page.links ?? []) {
			if (!seen.has(link.targetSuffix) || targets.has(link.nodeId) || findNode(page.document.nodes, link.nodeId)?.type !== 'Button') throw new Error('مقصد یا مؤلفهٔ پیوند بسته معتبر نیست.');
			targets.add(link.nodeId);
		}
	}
	if ([...used].some((type) => !requiredComponents.includes(type))) throw new Error('وابستگی مؤلفه در بسته اعلام نشده است.');
	return { schemaVersion: 1, id: input.id, version: input.version, name: input.name, description: input.description, category: input.category, language: 'fa', direction: 'rtl', minBuilderSchema: input.minBuilderSchema as number, license: input.license, author: input.author, requiredComponents: [...requiredComponents], assets: [...assets], pages };
}

export function listSiteKits(): SiteKit[] {
	const get = (id: string) => { const item = getStarterTemplate(id); if (!item) throw new Error('قالب پایه پیدا نشد.'); return item.document; };
	const pages = [
		{ suffix: 'home', title: 'خانه', document: get('business-page') },
		{ suffix: 'services', title: 'خدمات', document: get('feature-grid') },
		{ suffix: 'contact', title: 'تماس', document: get('contact-cta') },
	].map((page) => {
		let document = page.document;
		if (page.suffix === 'contact') {
			document = addNode(document, 'Image', { id: 'node_kit_contact_image' });
			document = updateNodeProps(document, 'node_kit_contact_image', { src: 'media://assets/blog-placeholder-about.jpg', alt: 'تصویر نمونهٔ صفحهٔ تماس' });
		}
		document = addNode(document, 'Container', { id: 'node_kit_navigation' });
		document = updateNodeProps(document, 'node_kit_navigation', { layout: 'row', gap: 8, padding: 16 });
		const links = [
			{ nodeId: 'node_kit_nav_home', targetSuffix: 'home', label: 'خانه' },
			{ nodeId: 'node_kit_nav_services', targetSuffix: 'services', label: 'خدمات' },
			{ nodeId: 'node_kit_nav_contact', targetSuffix: 'contact', label: 'تماس' },
		];
		for (const link of links) {
			document = addNode(document, 'Button', { parentId: 'node_kit_navigation', id: link.nodeId });
			document = updateNodeProps(document, link.nodeId, { label: link.label, href: '#', variant: 'outline' });
		}
		return { ...page, document, links: links.map(({ nodeId, targetSuffix }) => ({ nodeId, targetSuffix })) };
	});
	return [validateSiteKit({
		schemaVersion: 1, id: 'business-starter', version: '1.0.0', name: 'بستهٔ کسب‌وکار فارسی',
		description: 'سه پیش‌نویس مستقل برای معرفی، خدمات و تماس؛ محتوا و پیوندها را پیش از انتشار بررسی کنید.',
		category: 'business', language: 'fa', direction: 'rtl', minBuilderSchema: 1, license: 'MIT', author: 'Novex-Code',
		requiredComponents: ['Container', 'Heading', 'Text', 'Button', 'Image'], assets: ['media://assets/blog-placeholder-about.jpg'],
		pages,
	})];
}

export function prepareSiteKit(kit: SiteKit, prefix: string): PageDocument[] {
	const valid = validateSiteKit(kit);
	if (!isValidPageSlug(prefix)) throw new Error('پیشوند نامک معتبر نیست.');
	return valid.pages.map((page) => {
		const slug = `${prefix}-${page.suffix}`;
		if (!isValidPageSlug(slug)) throw new Error('نامک تولیدشده بیش از حد طولانی یا نامعتبر است.');
		let linkedDocument = page.document;
		for (const link of page.links ?? []) {
			const destination = `${prefix}-${link.targetSuffix}`;
			if (!isValidPageSlug(destination)) throw new Error('نامک مقصد پیوند معتبر نیست.');
			linkedDocument = updateNodeProps(linkedDocument, link.nodeId, { href: `/pages/${destination}` });
		}
		const target = createEmptyPageDocument(slug, page.title);
		// Source IDs are stable across kit versions and scoped to this page. The
		// validator copies the tree; no live source objects are shared.
		return validatePageDocument({ ...target, description: linkedDocument.description, themeId: linkedDocument.themeId, breakpoints: linkedDocument.breakpoints, nodes: linkedDocument.nodes }, slug);
	});
}
