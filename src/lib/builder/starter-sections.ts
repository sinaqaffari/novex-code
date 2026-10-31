import { createEmptyPageDocument, validatePageDocument } from './document.ts';
import { visualStarterDesign, visualStarterDesignSummaries } from './starter-designs.ts';
import type { StarterTemplate } from './templates.ts';

export type StarterSectionCategory = 'intro' | 'services' | 'faq' | 'shop' | 'cta';

interface SectionSpec {
	id: string;
	label: string;
	description: string;
	category: StarterSectionCategory;
	source: string;
	part: 'hero' | 'services' | 'faq' | 'products_section' | 'cta';
}

/** Each section is extracted from the same validated native design used by the
 * page library. Nothing is embedded as an image or executable markup. */
const SECTIONS: readonly SectionSpec[] = [
	{ id: 'section-studio-hero', label: 'معرفی تصویری استودیو', description: 'تیتر، تصویر معماری و دکمهٔ قابل ویرایش در یک چیدمان دو ستونه.', category: 'intro', source: 'studio-landing', part: 'hero' },
	{ id: 'section-restaurant-hero', label: 'معرفی رستوران', description: 'بخش تصویری برای معرفی رستوران یا کافه و راه ارتباط.', category: 'intro', source: 'restaurant-landing', part: 'hero' },
	{ id: 'section-creative-services', label: 'خدمات و ویژگی‌ها', description: 'عنوان و سه کارت واکنش‌گرا برای معرفی خدمات و مهارت‌ها.', category: 'services', source: 'portfolio-landing', part: 'services' },
	{ id: 'section-clinic-faq', label: 'پرسش‌های کلینیک', description: 'پرسش و پاسخ بازشونده با متن و پاسخ‌های قابل ویرایش.', category: 'faq', source: 'clinic-landing', part: 'faq' },
	{ id: 'section-education-faq', label: 'پرسش‌های آموزش', description: 'پاسخ به پرسش‌های متداول دوره‌ها، قابل تغییر در صفحه‌ساز.', category: 'faq', source: 'education-landing', part: 'faq' },
	{ id: 'section-shop-products', label: 'محصولات فروشگاه', description: 'شبکه‌ای متصل به محصولات فعال واقعی و پیوند به فروشگاه.', category: 'shop', source: 'shop-landing', part: 'products_section' },
	{ id: 'section-restaurant-cta', label: 'دعوت به تماس رستوران', description: 'یک بخش برجسته برای راهنمایی مخاطب به صفحهٔ تماس.', category: 'cta', source: 'restaurant-landing', part: 'cta' },
	{ id: 'section-education-cta', label: 'دعوت به یادگیری', description: 'تیتر، توضیح و دکمهٔ تماس برای پایان یک صفحهٔ آموزشی.', category: 'cta', source: 'education-landing', part: 'cta' },
];

/** Lightweight metadata and actual rendered previews, without building documents. */
export function visualStarterSectionSummaries() {
	const sources = new Map(visualStarterDesignSummaries().map((entry) => [entry.id, entry]));
	return SECTIONS.map(({ id, label, description, category, source }) => {
		const design = sources.get(source);
		if (!design) throw new Error(`Section source ${source} is unavailable.`);
		return { id, label, description, category, kind: 'section' as const, themeId: design.themeId, image: `/media/builder-previews/${id}.jpg` };
	});
}

export function visualStarterSection(id: string): StarterTemplate | undefined {
	const spec = SECTIONS.find((entry) => entry.id === id);
	if (!spec) return undefined;
	const source = visualStarterDesign(spec.source);
	if (!source) throw new Error(`Section source ${spec.source} is unavailable.`);
	const sourceId = `node_${spec.source.replaceAll('-', '_')}_${spec.part}`;
	const node = source.document.nodes.find((entry) => entry.id === sourceId);
	if (!node) throw new Error(`Section ${spec.id} is missing from its source design.`);
	const document = validatePageDocument({
		...createEmptyPageDocument(spec.id, spec.label),
		themeId: source.document.themeId,
		breakpoints: source.document.breakpoints,
		nodes: [node],
	});
	return { id: spec.id, label: spec.label, description: spec.description, kind: 'section', document };
}
