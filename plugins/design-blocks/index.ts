import { createEmptyPageDocument, validatePageDocument } from '../../src/lib/builder/document.ts';
import { createBuilderNode } from '../../src/lib/builder/operations.ts';
import type { BuilderPluginPreset } from '../../src/lib/builder/plugin-presets.ts';
import type { BuilderNode, ComponentPropsByType, ContainerNode } from '../../src/lib/builder/types.ts';
import type { PluginApi } from '../../src/lib/plugins/types.ts';

/** Bundled trusted code contributes only native, validated documents, never an executable renderer. */
function makePresets(): BuilderPluginPreset[] {
	function section(id: string, children: BuilderNode[], props: Partial<ComponentPropsByType['Container']> = {}): ContainerNode {
		const node = createBuilderNode('Container', id);
		return { ...node, props: { ...node.props, maxWidth: 'full', padding: 32, gap: 16, ...props }, children };
	}
	function heading(id: string, text: string): BuilderNode {
		const node = createBuilderNode('Heading', id);
		return { ...node, props: { ...node.props, text, level: 2, size: 'lg' } };
	}
	function text(id: string, value: string): BuilderNode {
		const node = createBuilderNode('Text', id);
		return { ...node, props: { ...node.props, text: value, color: 'soft' } };
	}
	function button(id: string, label: string): BuilderNode {
		const node = createBuilderNode('Button', id);
		return { ...node, props: { ...node.props, label, href: '/contact' } };
	}
	const document = (slug: string, title: string, nodes: BuilderNode[]) => validatePageDocument({ ...createEmptyPageDocument(slug, title), nodes });
	const faq = createBuilderNode('Accordion', 'node_blocks_faq_items');
	const faqItems = [
		{ id: 'item_faqone', title: 'چگونه اطلاعات بیشتری دریافت کنم؟', body: 'پاسخ نمونه است؛ با اطلاعات واقعی کسب‌وکارتان جایگزین کنید.' },
		{ id: 'item_faqtwo', title: 'چه خدماتی ارائه می‌دهید؟', body: 'خدمات و شرایط واقعی خود را در این بخش شرح دهید.' },
		{ id: 'item_faqthree', title: 'چطور با شما تماس بگیرم؟', body: 'راه ارتباطی به‌روز مجموعه را اینجا بنویسید.' },
	];
	const cards = ['اول', 'دوم', 'سوم'].map((label, index) => section(`node_blocks_card_${index}`, [
		heading(`node_blocks_card_h_${index}`, `خدمت ${label}`), text(`node_blocks_card_t_${index}`, 'توضیح این خدمت را با محتوای خودتان جایگزین کنید.'),
	], { background: 'surface', padding: 24 }));
	return [
		{
			id: 'design-blocks-intro', label: 'معرفی و دکمه', description: 'تیتر، توضیح و دکمهٔ قابل شخصی‌سازی.',
			document: document('design-intro', 'بخش معرفی', [section('node_blocks_intro', [heading('node_blocks_intro_h', 'داستان خود را اینجا بنویسید'), text('node_blocks_intro_t', 'یک معرفی کوتاه و روشن برای مخاطبان خود اضافه کنید.'), button('node_blocks_intro_b', 'بیشتر بدانید')], { background: 'soft' })]),
			parameters: [
				{ key: 'headline', label: 'تیتر معرفی', nodeId: 'node_blocks_intro_h', property: 'text', defaultValue: 'داستان خود را اینجا بنویسید', maxLength: 240 },
				{ key: 'button-label', label: 'متن دکمه', nodeId: 'node_blocks_intro_b', property: 'label', defaultValue: 'بیشتر بدانید', maxLength: 80 },
				{ key: 'button-url', label: 'نشانی دکمه', nodeId: 'node_blocks_intro_b', property: 'href', defaultValue: '/contact', maxLength: 500 },
			],
		},
		{
			id: 'design-blocks-services', label: 'سه خدمت', description: 'شبکهٔ واکنش‌گرای سه کارت برای خدمات یا ویژگی‌ها.',
			document: document('design-services', 'خدمات', [section('node_blocks_services', [heading('node_blocks_services_h', 'خدمات ما'), section('node_blocks_services_grid', cards, { layout: 'grid', background: 'soft', padding: 16 })])]),
			parameters: [{ key: 'title', label: 'عنوان بخش', nodeId: 'node_blocks_services_h', property: 'text', defaultValue: 'خدمات ما', maxLength: 240 }],
		},
		{
			id: 'design-blocks-cta', label: 'دعوت به اقدام', description: 'بخشی برای هدایت مخاطب به تماس یا یک صفحهٔ دیگر.',
			document: document('design-cta', 'دعوت به اقدام', [section('node_blocks_cta', [heading('node_blocks_cta_h', 'برای قدم بعدی آماده‌اید؟'), text('node_blocks_cta_t', 'از مخاطبان خود دعوت کنید با شما در ارتباط باشند.'), button('node_blocks_cta_b', 'تماس با ما')], { background: 'soft' })]),
			parameters: [
				{ key: 'headline', label: 'تیتر', nodeId: 'node_blocks_cta_h', property: 'text', defaultValue: 'برای قدم بعدی آماده‌اید؟', maxLength: 240 },
				{ key: 'button-label', label: 'متن دکمه', nodeId: 'node_blocks_cta_b', property: 'label', defaultValue: 'تماس با ما', maxLength: 80 },
				{ key: 'button-url', label: 'نشانی دکمه', nodeId: 'node_blocks_cta_b', property: 'href', defaultValue: '/contact', maxLength: 500 },
			],
		},
		{
			id: 'design-blocks-faq', label: 'پرسش‌های متداول', description: 'پرسش و پاسخ بازشونده با سه مورد نمونهٔ قابل ویرایش.',
			document: document('design-faq', 'پرسش‌ها', [section('node_blocks_faq', [heading('node_blocks_faq_h', 'پرسش‌های متداول'), { ...faq, props: { items: faqItems } }], { background: 'soft' })]),
			parameters: [{ key: 'title', label: 'عنوان بخش', nodeId: 'node_blocks_faq_h', property: 'text', defaultValue: 'پرسش‌های متداول', maxLength: 240 }],
		},
	];
}

let presets: BuilderPluginPreset[] | undefined;
export function register(api: PluginApi): void {
	api.addFilter('builder.presets', (value: unknown) => {
		if (!Array.isArray(value)) throw new Error('Invalid preset list');
		presets ??= makePresets();
		return [...value, ...structuredClone(presets)];
	});
}
