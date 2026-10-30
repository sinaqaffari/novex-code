import { createEmptyPageDocument, isValidPageSlug, validatePageDocument } from './document.ts';
import { applyTemplate, listStarterTemplates } from './templates.ts';
import { parseBuilderMediaReference } from './media-reference.ts';
import { addNode, findNode, updateNodeProps } from './operations.ts';
import { BUILDER_COMPONENT_TYPES, type BuilderComponentType, type BuilderNode, type PageDocument } from './types.ts';

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
	minBuilderSchema: 1;
	license: string;
	author: string;
	requiredComponents: BuilderComponentType[];
	assets: string[];
	pages: Array<{ suffix: string; title: string; document: PageDocument; links?: Array<{ nodeId: string; targetSuffix: string }> }>;
}

/** Validation is deliberately restricted to the capabilities the installer supports today. */
export function validateSiteKit(input: SiteKit): SiteKit {
	if (!input || input.schemaVersion !== 1 || input.minBuilderSchema !== 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.id) || !/^\d+\.\d+\.\d+$/.test(input.version) || !input.name?.trim() || input.language !== 'fa' || input.direction !== 'rtl' || !input.license || !input.author) throw new Error('بستهٔ سایت معتبر یا سازگار نیست.');
	if (!Array.isArray(input.assets) || input.assets.length > 50 || new Set(input.assets).size !== input.assets.length || input.assets.some((asset) => typeof asset !== 'string' || parseBuilderMediaReference(asset)?.bucket !== 'assets')) throw new Error('فهرست دارایی‌های بومی معتبر نیست.');
	const declaredAssets = new Set(input.assets);
	if (!Array.isArray(input.requiredComponents) || input.requiredComponents.some((type) => !(BUILDER_COMPONENT_TYPES as readonly string[]).includes(type))) throw new Error('بسته به مؤلفهٔ ناموجود نیاز دارد.');
	if (!Array.isArray(input.pages) || !input.pages.length || input.pages.length > 20) throw new Error('تعداد صفحات بسته نامعتبر است.');
	const seen = new Set<string>();
	const used = new Set<BuilderComponentType>();
	const scan = (nodes: BuilderNode[]) => nodes.forEach((node) => { used.add(node.type); if (node.type === 'Image' && node.props.src && !declaredAssets.has(node.props.src)) throw new Error('دارایی تصویر باید به‌صورت بومی در بسته اعلام شود.'); if (node.type === 'Container') scan(node.children); });
	const pages = input.pages.map((page) => {
		if (!page || !isValidPageSlug(page.suffix) || seen.has(page.suffix) || typeof page.title !== 'string' || !page.title.trim() || page.title.length > 100) throw new Error('صفحهٔ بسته معتبر یا یکتا نیست.');
		seen.add(page.suffix);
		const document = validatePageDocument(page.document);
		scan(document.nodes);
		return { ...page, document };
	});
	for (const page of pages) {
		if (page.links === undefined) continue;
		if (!Array.isArray(page.links) || page.links.length > 50) throw new Error('پیوندهای بسته معتبر نیستند.');
		const targets = new Set<string>();
		for (const link of page.links) {
			if (!link || typeof link.nodeId !== 'string' || typeof link.targetSuffix !== 'string' || !seen.has(link.targetSuffix) || targets.has(link.nodeId) || findNode(page.document.nodes, link.nodeId)?.type !== 'Button') throw new Error('مقصد یا مؤلفهٔ پیوند بسته معتبر نیست.');
			targets.add(link.nodeId);
		}
	}
	if ([...used].some((type) => !input.requiredComponents.includes(type))) throw new Error('وابستگی مؤلفه در بسته اعلام نشده است.');
	return { ...input, requiredComponents: [...input.requiredComponents], assets: [...input.assets], pages };
}

export function listSiteKits(): SiteKit[] {
	const starters = listStarterTemplates();
	const get = (id: string) => { const item = starters.find((entry) => entry.id === id); if (!item) throw new Error('قالب پایه پیدا نشد.'); return item.document; };
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
		return applyTemplate(linkedDocument, createEmptyPageDocument(slug, page.title));
	});
}
