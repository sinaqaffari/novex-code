import { createEmptyPageDocument, isValidPageSlug, validatePageDocument } from './document.ts';
import { applyTemplate, listStarterTemplates } from './templates.ts';
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
	pages: Array<{ suffix: string; title: string; document: PageDocument }>;
}

/** Validation is deliberately restricted to the capabilities the installer supports today. */
export function validateSiteKit(input: SiteKit): SiteKit {
	if (!input || input.schemaVersion !== 1 || input.minBuilderSchema !== 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.id) || !/^\d+\.\d+\.\d+$/.test(input.version) || !input.name?.trim() || input.language !== 'fa' || input.direction !== 'rtl' || !input.license || !input.author) throw new Error('بستهٔ سایت معتبر یا سازگار نیست.');
	if (!Array.isArray(input.assets) || input.assets.length) throw new Error('این نصب‌کننده هنوز انتقال دارایی بسته را پشتیبانی نمی‌کند.');
	if (!Array.isArray(input.requiredComponents) || input.requiredComponents.some((type) => !(BUILDER_COMPONENT_TYPES as readonly string[]).includes(type))) throw new Error('بسته به مؤلفهٔ ناموجود نیاز دارد.');
	if (!Array.isArray(input.pages) || !input.pages.length || input.pages.length > 20) throw new Error('تعداد صفحات بسته نامعتبر است.');
	const seen = new Set<string>();
	const used = new Set<BuilderComponentType>();
	const scan = (nodes: BuilderNode[]) => nodes.forEach((node) => { used.add(node.type); if (node.type === 'Image' && node.props.src) throw new Error('دارایی تصویر باید پیش از نصب حل شود.'); if (node.type === 'Container') scan(node.children); });
	const pages = input.pages.map((page) => {
		if (!page || !isValidPageSlug(page.suffix) || seen.has(page.suffix) || typeof page.title !== 'string' || !page.title.trim() || page.title.length > 100) throw new Error('صفحهٔ بسته معتبر یا یکتا نیست.');
		seen.add(page.suffix);
		const document = validatePageDocument(page.document);
		scan(document.nodes);
		return { ...page, document };
	});
	if ([...used].some((type) => !input.requiredComponents.includes(type))) throw new Error('وابستگی مؤلفه در بسته اعلام نشده است.');
	return { ...input, requiredComponents: [...input.requiredComponents], assets: [], pages };
}

export function listSiteKits(): SiteKit[] {
	const starters = listStarterTemplates();
	const get = (id: string) => { const item = starters.find((entry) => entry.id === id); if (!item) throw new Error('قالب پایه پیدا نشد.'); return item.document; };
	return [validateSiteKit({
		schemaVersion: 1, id: 'business-starter', version: '1.0.0', name: 'بستهٔ کسب‌وکار فارسی',
		description: 'سه پیش‌نویس مستقل برای معرفی، خدمات و تماس؛ محتوا و پیوندها را پیش از انتشار بررسی کنید.',
		category: 'business', language: 'fa', direction: 'rtl', minBuilderSchema: 1, license: 'MIT', author: 'Novex-Code',
		requiredComponents: ['Container', 'Heading', 'Text', 'Button'], assets: [],
		pages: [
			{ suffix: 'home', title: 'خانه', document: get('business-page') },
			{ suffix: 'services', title: 'خدمات', document: get('feature-grid') },
			{ suffix: 'contact', title: 'تماس', document: get('contact-cta') },
		],
	})];
}

export function prepareSiteKit(kit: SiteKit, prefix: string): PageDocument[] {
	const valid = validateSiteKit(kit);
	if (!isValidPageSlug(prefix)) throw new Error('پیشوند نامک معتبر نیست.');
	return valid.pages.map((page) => {
		const slug = `${prefix}-${page.suffix}`;
		if (!isValidPageSlug(slug)) throw new Error('نامک تولیدشده بیش از حد طولانی یا نامعتبر است.');
		return applyTemplate(page.document, createEmptyPageDocument(slug, page.title));
	});
}
