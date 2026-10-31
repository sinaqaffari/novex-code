import { visualStarterDesignSummaries, type VisualDesignCategory } from './starter-designs.ts';
import { visualStarterSectionSummaries, type StarterSectionCategory } from './starter-sections.ts';

/** Only native, bundled page designs are public. Saved/user templates remain private. */
export const TEMPLATE_CATEGORIES: ReadonlyArray<{ id: VisualDesignCategory; label: string }> = [
	{ id: 'business', label: 'شرکتی و خدماتی' },
	{ id: 'shop', label: 'فروشگاهی' },
	{ id: 'creative', label: 'شخصی و نمونه‌کار' },
	{ id: 'education', label: 'آموزشی' },
	{ id: 'food', label: 'رستوران و کافه' },
	{ id: 'health', label: 'سلامت و پزشکی' },
	{ id: 'beauty', label: 'زیبایی و مراقبت' },
	{ id: 'travel', label: 'سفر و گردشگری' },
];

export const SECTION_CATEGORIES: ReadonlyArray<{ id: StarterSectionCategory; label: string }> = [
	{ id: 'intro', label: 'معرفی تصویری' },
	{ id: 'services', label: 'خدمات و ویژگی‌ها' },
	{ id: 'faq', label: 'پرسش‌های متداول' },
	{ id: 'shop', label: 'فروشگاه' },
	{ id: 'cta', label: 'دعوت به اقدام' },
];

export type CatalogTemplate = ReturnType<typeof visualStarterDesignSummaries>[number];
export type CatalogSection = ReturnType<typeof visualStarterSectionSummaries>[number];
export type CatalogDesign = CatalogTemplate | CatalogSection;

export function listCatalogTemplates(): CatalogTemplate[] {
	return visualStarterDesignSummaries();
}

export function getCatalogTemplate(id: string): CatalogTemplate | undefined {
	return listCatalogTemplates().find((template) => template.id === id);
}

export function listCatalogSections(): CatalogSection[] {
	return visualStarterSectionSummaries();
}

export function getCatalogSection(id: string): CatalogSection | undefined {
	return listCatalogSections().find((section) => section.id === id);
}

export function templateCategoryLabel(category: VisualDesignCategory): string {
	return TEMPLATE_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

export function catalogCategoryLabel(design: CatalogDesign): string {
	return design.kind === 'page' ? templateCategoryLabel(design.category) : SECTION_CATEGORIES.find((item) => item.id === design.category)?.label ?? design.category;
}

function normalizeSearch(value: string): string {
	return value.toLocaleLowerCase('fa').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064B-\u065F\u0670]/g, '');
}

function filterDesigns<T extends CatalogDesign>(designs: T[], query: string, category: string): T[] {
	const needle = normalizeSearch(query.trim());
	return designs.filter((design) => {
		if (category && design.category !== category) return false;
		const searchable = `${design.label} ${design.description} ${catalogCategoryLabel(design)}`;
		return !needle || normalizeSearch(searchable).includes(needle);
	});
}

export function filterCatalogTemplates(query: string, category: string): CatalogTemplate[] {
	return filterDesigns(listCatalogTemplates(), query, category);
}

export function filterCatalogSections(query: string, category: string): CatalogSection[] {
	return filterDesigns(listCatalogSections(), query, category);
}
