import type {
	BuilderComponentType,
	ComponentDefinition,
	ComponentPropsByType,
	InspectorField,
	NodeStyles,
	ResponsiveNodeStyles,
	ThemeColor,
} from './types.ts';
import { BUILDER_COMPONENT_TYPES, BREAKPOINTS, SPACING_STEPS, type Breakpoint } from './types.ts';
import { isSemVer } from '../plugins/validation.ts';
import { normalizeProductGridBinding } from '../commerce/product-binding.ts';
import { parseBuilderMediaReference } from './media-reference.ts';
import { normalizeLayoutLength } from './layout.ts';
import { safeHref } from './link-safety.ts';
import { normalizeTextMarks } from './rich-text.ts';
export { safeHref } from './link-safety.ts';

const alignOptions = [
	{ value: 'start', label: 'آغاز خط' },
	{ value: 'center', label: 'وسط' },
	{ value: 'end', label: 'پایان خط' },
] as const;

const colorOptions = [
	{ value: 'ink', label: 'متن اصلی' },
	{ value: 'muted', label: 'متن ملایم' },
	{ value: 'brand', label: 'رنگ برند' },
	{ value: 'surface', label: 'سطح روشن' },
	{ value: 'soft', label: 'سطح ملایم' },
] as const;

const spacingOptions = [0, 4, 8, 12, 16, 24, 32, 48, 64].map((value) => ({
	value,
	label: value === 0 ? 'بدون فاصله' : `${value} px`,
}));
const styleSpacingOptions = [{ value: '', label: 'پیش‌فرض' }, ...spacingOptions];

const commonStyleFields: readonly InspectorField[] = [
	{
		key: 'styles.width',
		label: 'عرض',
		kind: 'select',
		group: 'layout',
		options: [
			{ value: '', label: 'پیش‌فرض' },
			{ value: 'content', label: 'به‌اندازهٔ محتوا' },
			{ value: 'narrow', label: 'باریک' },
			{ value: 'wide', label: 'گسترده' },
			{ value: 'full', label: 'تمام عرض' },
			{ value: '50%', label: '۵۰٪' },
			{ value: '320px', label: '۳۲۰px' },
			{ value: '40rem', label: '۴۰rem' },
		],
	},
	{ key: 'styles.width', label: 'عرض سفارشی (px، %، rem و …)', kind: 'length', group: 'layout', maxLength: 20 },
	{ key: 'styles.height', label: 'ارتفاع (px، %، rem و …)', kind: 'length', group: 'layout', maxLength: 20 },
	{ key: 'styles.minWidth', label: 'حداقل عرض', kind: 'length', group: 'layout', maxLength: 20 },
	{ key: 'styles.maxWidth', label: 'حداکثر عرض', kind: 'length', group: 'layout', maxLength: 20 },
	{ key: 'styles.minHeight', label: 'حداقل ارتفاع', kind: 'length', group: 'layout', maxLength: 20 },
	{ key: 'styles.maxHeight', label: 'حداکثر ارتفاع', kind: 'length', group: 'layout', maxLength: 20 },
	{
		key: 'styles.marginBlockStart',
		label: 'فاصلهٔ بالا',
		kind: 'number',
		group: 'layout',
		options: styleSpacingOptions,
	},
	{
		key: 'styles.marginBlockEnd',
		label: 'فاصلهٔ پایین',
		kind: 'number',
		group: 'layout',
		options: styleSpacingOptions,
	},
];

const definitions = {
	Container: {
		type: 'Container',
		version: 1,
		label: 'بخش',
		category: 'layout',
		description: 'بخش تو‌در‌تو برای گروه‌بندی محتوا با چیدمان ستونی یا ردیفی.',
		documentation: 'بخش‌ها می‌توانند بخش، تیتر یا دکمه داشته باشند. ترتیب فرزندان در سند ذخیره می‌شود.',
		example: 'یک بخش با تیتر و دکمهٔ دعوت به اقدام.',
		defaultProps: { layout: 'stack', maxWidth: 'lg', gap: 16, padding: 24, background: 'none' },
		fields: [
			{
				key: 'layout',
				label: 'چیدمان',
				kind: 'select',
				group: 'layout',
				options: [
					{ value: 'stack', label: 'ستونی' },
					{ value: 'row', label: 'ردیفی' },
					{ value: 'grid', label: 'شبکه‌ای' },
				],
			},
			{
				key: 'maxWidth',
				label: 'حداکثر عرض',
				kind: 'select',
				group: 'layout',
				options: [
					{ value: 'sm', label: 'باریک' },
					{ value: 'md', label: 'متوسط' },
					{ value: 'lg', label: 'بزرگ' },
					{ value: 'full', label: 'تمام عرض' },
				],
			},
			{ key: 'gap', label: 'فاصلهٔ فرزندان', kind: 'number', group: 'layout', options: spacingOptions },
			{ key: 'padding', label: 'حاشیهٔ داخلی', kind: 'number', group: 'style', options: spacingOptions },
			{
				key: 'background',
				label: 'پس‌زمینه',
				kind: 'select',
				group: 'style',
				options: [
					{ value: 'none', label: 'شفاف' },
					{ value: 'surface', label: 'سطح روشن' },
					{ value: 'soft', label: 'سطح ملایم' },
					{ value: 'brand', label: 'رنگ برند' },
				],
			},
			{ key: 'styles.layout', label: 'حالت واکنش‌گرای چیدمان', kind: 'select', group: 'layout', options: [
				{ value: '', label: 'پیش‌فرض' }, { value: 'block', label: 'بلوکی' }, { value: 'flex', label: 'فلکس' }, { value: 'grid', label: 'شبکه' }, { value: 'inline-block', label: 'درون‌خطی' },
			] },
			{ key: 'styles.direction', label: 'جهت فلکس', kind: 'select', group: 'layout', options: [
				{ value: '', label: 'پیش‌فرض' }, { value: 'row', label: 'ردیفی' }, { value: 'column', label: 'ستونی' },
			] },
			{ key: 'styles.columns', label: 'ستون‌های شبکه', kind: 'number', group: 'layout', options: [
				{ value: '', label: 'خودکار' }, ...[1, 2, 3, 4, 6].map((value) => ({ value, label: String(value) })),
			] },
			{ key: 'styles.gap', label: 'فاصلهٔ واکنش‌گرای فرزندان', kind: 'number', group: 'layout', options: styleSpacingOptions },
			{ key: 'styles.alignItems', label: 'تراز فرزندان', kind: 'select', group: 'layout', options: [
				{ value: '', label: 'پیش‌فرض' }, { value: 'start', label: 'آغاز' }, { value: 'center', label: 'وسط' }, { value: 'end', label: 'پایان' }, { value: 'stretch', label: 'کشیده' },
			] },
			{ key: 'styles.justifyContent', label: 'توزیع فرزندان', kind: 'select', group: 'layout', options: [
				{ value: '', label: 'پیش‌فرض' }, { value: 'start', label: 'آغاز' }, { value: 'center', label: 'وسط' }, { value: 'end', label: 'پایان' }, { value: 'space-between', label: 'فاصله بین' }, { value: 'space-around', label: 'فاصله پیرامون' },
			] },
			{ key: 'styles.overflow', label: 'سرریز', kind: 'select', group: 'layout', options: [
				{ value: '', label: 'پیش‌فرض' }, { value: 'visible', label: 'نمایان' }, { value: 'hidden', label: 'پنهان' }, { value: 'auto', label: 'خودکار' },
			] },
			...commonStyleFields,
		],
		allowedChildren: ['Container', 'Heading', 'Text', 'Image', 'Button', 'Spacer', 'Divider', 'Blockquote', 'Accordion', 'Tabs', 'List', 'ImageGallery', 'VideoEmbed', 'CodeWidget', 'ProductGrid', 'InquiryForm', 'PluginBlock'],
		supportsChildren: true,
		previewRenderer: 'container',
		productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'Container'>,
	Heading: {
		type: 'Heading',
		version: 1,
		label: 'تیتر',
		category: 'content',
		description: 'تیتر معنایی با سطح و اندازهٔ مستقل.',
		documentation: 'متن با عنصر h1 تا h4 رندر می‌شود؛ از سطح تیتر برای ساختار محتوا استفاده کنید.',
		example: 'عنوان بخش یا تیتر اصلی صفحه.',
		defaultProps: { text: 'تیتر تازه', level: 2, align: 'start', color: 'ink', size: 'lg' },
		fields: [
			{ key: 'text', label: 'متن تیتر', kind: 'rich-text', group: 'content', maxLength: 240 },
			{
				key: 'level',
				label: 'سطح معنایی',
				kind: 'select',
				group: 'content',
				options: [1, 2, 3, 4].map((value) => ({ value, label: `H${value}` })),
			},
			{
				key: 'size',
				label: 'اندازهٔ دیداری',
				kind: 'select',
				group: 'style',
				options: [
					{ value: 'sm', label: 'کوچک' },
					{ value: 'md', label: 'متوسط' },
					{ value: 'lg', label: 'بزرگ' },
					{ value: 'xl', label: 'خیلی بزرگ' },
				],
			},
			{ key: 'align', label: 'تراز', kind: 'select', group: 'style', options: alignOptions },
			{ key: 'color', label: 'رنگ', kind: 'select', group: 'style', options: colorOptions },
			...commonStyleFields,
		],
		allowedChildren: [],
		supportsChildren: false,
		previewRenderer: 'heading',
		productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'Heading'>,
	Text: {
		type: 'Text',
		version: 1,
		label: 'متن',
		category: 'content',
		description: 'پاراگراف ایمن با تأکید و پیوندهای قابل ویرایش.',
		documentation: 'متن و بازه‌های قالب‌بندی ذخیره می‌شوند؛ HTML یا اسکریپت دلخواه اجرا نمی‌شود.',
		example: 'توضیح محصول، معرفی خدمات یا متن راهنما.',
		defaultProps: { text: 'متن خود را اینجا بنویسید.', align: 'start', color: 'ink', size: 'md' },
		fields: [
			{ key: 'text', label: 'متن', kind: 'rich-text', group: 'content', maxLength: 5000 },
			{ key: 'align', label: 'تراز', kind: 'select', group: 'style', options: alignOptions },
			{ key: 'color', label: 'رنگ', kind: 'select', group: 'style', options: colorOptions },
			{
				key: 'size',
				label: 'اندازه',
				kind: 'select',
				group: 'style',
				options: [
					{ value: 'sm', label: 'کوچک' },
					{ value: 'md', label: 'متوسط' },
					{ value: 'lg', label: 'بزرگ' },
				],
			},
			...commonStyleFields,
		],
		allowedChildren: [],
		supportsChildren: false,
		previewRenderer: 'text',
		productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'Text'>,
	Image: {
		type: 'Image',
		version: 1,
		label: 'تصویر',
		category: 'media',
		description: 'تصویر واکنش‌گرا با متن جایگزین و قاب قابل تنظیم.',
		documentation: 'نشانی باید مسیر داخلی سایت یا URL امن HTTPS باشد؛ متن جایگزین برای دسترس‌پذیری نگهداری می‌شود.',
		example: 'تصویر محصول یا عکس معرفی بخش.',
		defaultProps: { src: '', alt: '', caption: '', aspectRatio: 'auto', fit: 'cover' },
		fields: [
			{ key: 'src', label: 'نشانی تصویر', kind: 'url', group: 'content', maxLength: 500 },
			{ key: 'alt', label: 'متن جایگزین', kind: 'text', group: 'content', maxLength: 240 },
			{ key: 'caption', label: 'زیرنویس', kind: 'text', group: 'content', maxLength: 240 },
			{
				key: 'aspectRatio',
				label: 'نسبت تصویر',
				kind: 'select',
				group: 'style',
				options: [
					{ value: 'auto', label: 'خودکار' },
					{ value: 'wide', label: 'عریض' },
					{ value: 'square', label: 'مربع' },
					{ value: 'portrait', label: 'عمودی' },
				],
			},
			{
				key: 'fit',
				label: 'جای‌گیری تصویر',
				kind: 'select',
				group: 'style',
				options: [
					{ value: 'cover', label: 'پرکردن قاب' },
					{ value: 'contain', label: 'نمایش کامل' },
				],
			},
			...commonStyleFields,
		],
		allowedChildren: [],
		supportsChildren: false,
		previewRenderer: 'image',
		productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'Image'>,
	Button: {
		type: 'Button',
		version: 1,
		label: 'دکمه',
		category: 'action',
		description: 'پیوند اقدام با مقصد امن و دو سبک آماده.',
		documentation: 'مقصد فقط پیوند داخلی، لنگر یا نشانی HTTP(S) بدون اطلاعات ورود را می‌پذیرد.',
		example: 'پیوند به بخش تماس یا صفحهٔ فروشگاه.',
		defaultProps: { label: 'مشاهدهٔ بیشتر', href: '#', variant: 'primary', align: 'start' },
		fields: [
			{ key: 'label', label: 'متن دکمه', kind: 'text', group: 'content', maxLength: 80 },
			{ key: 'href', label: 'نشانی پیوند', kind: 'url', group: 'content', maxLength: 500 },
			{
				key: 'variant',
				label: 'سبک',
				kind: 'select',
				group: 'style',
				options: [
					{ value: 'primary', label: 'اصلی' },
					{ value: 'outline', label: 'خطی' },
				],
			},
			{ key: 'align', label: 'تراز', kind: 'select', group: 'layout', options: alignOptions },
			...commonStyleFields,
		],
		allowedChildren: [],
		supportsChildren: false,
		previewRenderer: 'button',
		productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'Button'>,
	Spacer: {
		type: 'Spacer', version: 1, label: 'فاصله', category: 'layout',
		description: 'فاصلهٔ عمودی قابل تنظیم میان مؤلفه‌ها.',
		documentation: 'ارتفاع در سند ذخیره می‌شود و می‌تواند در اندازه‌های مختلف تغییر کند.',
		example: 'ایجاد فاصله میان بخش‌های صفحه.',
		defaultProps: { size: 32 },
		fields: [{ key: 'size', label: 'ارتفاع پایه (px)', kind: 'number', group: 'layout', min: 0, max: 1024 }, ...commonStyleFields],
		allowedChildren: [], supportsChildren: false, previewRenderer: 'spacer', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'Spacer'>,
	Divider: {
		type: 'Divider', version: 1, label: 'جداکننده', category: 'layout',
		description: 'خط جداکنندهٔ معنایی با رنگ و ضخامت کنترل‌شده.',
		documentation: 'از عنصر معنایی hr با رنگ‌های تم استفاده می‌کند.',
		example: 'جداسازی محتوای دو بخش.',
		defaultProps: { thickness: 1, lineStyle: 'solid', color: 'muted' },
		fields: [
			{ key: 'thickness', label: 'ضخامت', kind: 'number', group: 'style', options: [1, 2, 4].map((value) => ({ value, label: `${value}px` })) },
			{ key: 'lineStyle', label: 'نوع خط', kind: 'select', group: 'style', options: [{ value: 'solid', label: 'پیوسته' }, { value: 'dashed', label: 'خط‌چین' }, { value: 'dotted', label: 'نقطه‌چین' }] },
			{ key: 'color', label: 'رنگ', kind: 'select', group: 'style', options: [{ value: 'muted', label: 'ملایم' }, { value: 'ink', label: 'متن' }, { value: 'brand', label: 'برند' }] },
			...commonStyleFields,
		],
		allowedChildren: [], supportsChildren: false, previewRenderer: 'divider', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'Divider'>,


	Blockquote: {
		type: 'Blockquote', version: 1, label: 'نقل‌قول', category: 'content',
		description: 'نقل‌قول معنایی همراه با نام و سمت گوینده.',
		documentation: 'متن و قالب‌بندی ایمن از عنصر معنایی blockquote استفاده می‌کنند.',
		example: 'نظر مشتری یا نقل‌قول در یک مقاله.',
		defaultProps: { text: 'متن نقل‌قول', author: '', role: '' },
		fields: [
			{ key: 'text', label: 'متن نقل‌قول', kind: 'rich-text', group: 'content', maxLength: 5000 },
			{ key: 'author', label: 'نام گوینده', kind: 'text', group: 'content', maxLength: 160 },
			{ key: 'role', label: 'سمت گوینده', kind: 'text', group: 'content', maxLength: 160 },
			...commonStyleFields,
		],
		allowedChildren: [], supportsChildren: false, previewRenderer: 'blockquote', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'Blockquote'>,
	Accordion: {
		type: 'Accordion', version: 1, label: 'پرسش‌های بازشونده', category: 'content',
		description: 'فهرست پرسش و پاسخ بازشونده با کنترل صفحه‌کلید.',
		documentation: 'هر مورد با details و summary مرورگر و بدون کد اجرایی نمایش داده می‌شود.',
		example: 'پرسش‌های متداول.',
		defaultProps: { items: [{ id: 'item_default1', title: 'پرسش نخست', body: 'پاسخ خود را اینجا بنویسید.' }] },
		fields: [{ key: 'items', label: 'پرسش‌ها', kind: 'accordion-items', group: 'content' }, ...commonStyleFields],
		allowedChildren: [], supportsChildren: false, previewRenderer: 'accordion', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'Accordion'>,
	Tabs: {
		type: 'Tabs', version: 1, label: 'زبانه‌ها', category: 'content',
		description: 'زبانه‌های تعاملی با پشتیبانی صفحه‌کلید و متن جایگزین بدون JavaScript.',
		documentation: 'عنوان و متن زبانه با قالب‌بندی ایمن قابل ویرایش‌اند؛ ساختارهای تو در تو پشتیبانی نمی‌شوند.',
		example: 'اطلاعات محصول در چند زبانه.',
		defaultProps: { items: [{ id: 'item_default1', title: 'زبانهٔ نخست', body: 'متن زبانه را اینجا بنویسید.' }, { id: 'item_default2', title: 'زبانهٔ دوم', body: 'متن دیگر.' }] },
		fields: [{ key: 'items', label: 'زبانه‌ها', kind: 'tab-items', group: 'content' }, ...commonStyleFields],
		allowedChildren: [], supportsChildren: false, previewRenderer: 'tabs', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'Tabs'>,
	List: {
		type: 'List', version: 1, label: 'فهرست', category: 'content',
		description: 'فهرست نشانه‌دار یا شماره‌دار با پیوندهای ایمن.',
		documentation: 'هر مورد متن، قالب‌بندی و پیوندهای ایمن قابل ویرایش دارد.',
		example: 'ویژگی‌ها یا مراحل انجام کار.',
		defaultProps: { kind: 'unordered', items: [{ id: 'item_default1', text: 'مورد نخست', href: '' }] },
		fields: [{ key: 'kind', label: 'نوع فهرست', kind: 'select', group: 'content', options: [{ value: 'unordered', label: 'نشانه‌دار' }, { value: 'ordered', label: 'شماره‌دار' }] }, { key: 'items', label: 'موارد', kind: 'list-items', group: 'content' }, ...commonStyleFields],
		allowedChildren: [], supportsChildren: false, previewRenderer: 'list', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'List'>,
	ImageGallery: {
		type: 'ImageGallery', version: 1, label: 'گالری تصویر', category: 'media',
		description: 'گالری واکنش‌گرا با تصویرهای کتابخانه و متن جایگزین.',
		documentation: 'هر تصویر به رسانهٔ موجود یا نشانی امن اشاره می‌کند؛ تصاویر به‌صورت تنبل بارگیری می‌شوند.',
		example: 'گالری نمونه‌کار یا محصول.',
		defaultProps: { items: [{ id: 'item_default1', src: '', alt: '', caption: '' }], columns: 3 },
		fields: [
			{ key: 'items', label: 'تصویرها', kind: 'gallery-items', group: 'content' },
			{ key: 'columns', label: 'تعداد ستون', kind: 'number', group: 'layout', options: [1, 2, 3, 4].map((value) => ({ value, label: String(value) })) },
			...commonStyleFields,
		],
		allowedChildren: [], supportsChildren: false, previewRenderer: 'imageGallery', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'ImageGallery'>,
	VideoEmbed: {
		type: 'VideoEmbed', version: 1, label: 'ویدئو', category: 'media',
		description: 'پخش ویدئوی YouTube یا Vimeo از شناسهٔ معتبر.',
		documentation: 'تنها دامنه‌های مشخص مجازند؛ در ویرایشگر درخواست خارجی ارسال نمی‌شود.',
		example: 'ویدئوی معرفی محصول.',
		defaultProps: { provider: 'youtube', youtubeId: '', vimeoId: '', title: 'ویدئو' },
		fields: [
			{ key: 'provider', label: 'سرویس ویدئو', kind: 'select', group: 'content', options: [{ value: 'youtube', label: 'YouTube' }, { value: 'vimeo', label: 'Vimeo' }] },
			{ key: 'youtubeId', label: 'شناسهٔ YouTube', kind: 'identifier', group: 'content', maxLength: 11 },
			{ key: 'vimeoId', label: 'شناسهٔ Vimeo', kind: 'identifier', group: 'content', maxLength: 12 },
			{ key: 'title', label: 'عنوان دسترس‌پذیر ویدئو', kind: 'text', group: 'content', maxLength: 160 },
			...commonStyleFields,
		],
		allowedChildren: [], supportsChildren: false, previewRenderer: 'videoEmbed', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'VideoEmbed'>,
	CodeWidget: {
		type: 'CodeWidget', version: 1, label: 'کد در قاب مستقل', category: 'content',
		description: 'HTML، CSS و JavaScript فقط داخل قاب مرورگر جدا اجرا می‌شوند.',
		documentation: 'کد باید پیش از انتشار بررسی شود. به صفحهٔ اصلی دسترسی ندارد و از افزونهٔ سرور مستقل است.',
		example: 'نمایشگر تعاملی مستقل.',
		defaultProps: { title: 'محتوای تعاملی', html: '<p>محتوای دلخواه</p>', css: '', javascript: '', height: 240 },
		fields: [
			{ key: 'title', label: 'عنوان دسترس‌پذیر قاب', kind: 'text', group: 'content', maxLength: 160 },
			{ key: 'html', label: 'HTML قاب', kind: 'textarea', group: 'content', maxLength: 16000 },
			{ key: 'css', label: 'CSS قاب', kind: 'textarea', group: 'content', maxLength: 16000 },
			{ key: 'javascript', label: 'JavaScript قاب', kind: 'textarea', group: 'content', maxLength: 16000 },
			{ key: 'height', label: 'ارتفاع قاب', kind: 'number', group: 'layout', options: [120, 240, 400, 600, 800].map((value) => ({ value, label: `${value}px` })) },
			...commonStyleFields,
		],
		allowedChildren: [], supportsChildren: false, previewRenderer: 'codeWidget', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'CodeWidget'>,
	GlobalCode: {
		type: 'GlobalCode', version: 1, label: 'کد صفحه', category: 'content',
		description: 'CSS و JavaScript در صفحهٔ منتشرشده و با دسترسی کامل به همان صفحه اجرا می‌شوند.',
		documentation: 'فقط مدیر می‌تواند این کد را پس از بازبینی منتشر کند؛ کد قابل اعتماد است و در ویرایشگر اجرا نمی‌شود.',
		example: 'قواعد CSS صفحه یا رفتار سفارشی تاییدشده.',
		defaultProps: { title: 'کد صفحه', css: '', javascript: '' },
		fields: [
			{ key: 'title', label: 'نام کد صفحه', kind: 'text', group: 'content', maxLength: 160 },
			{ key: 'css', label: 'CSS صفحه', kind: 'textarea', group: 'content', maxLength: 64000 },
			{ key: 'javascript', label: 'JavaScript صفحه', kind: 'textarea', group: 'content', maxLength: 64000 },
		],
		allowedChildren: [], supportsChildren: false, previewRenderer: 'globalCode', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'GlobalCode'>,
	ProductGrid: {
		type: 'ProductGrid',
		version: 1,
		label: 'محصولات',
		category: 'commerce',
		description: 'نمایش زندهٔ محصولات فعال از فروشگاه نووکس.',
		documentation: 'فقط محصول فعال و اطلاعات عمومی کارت نمایش داده می‌شود؛ شناسه، موجودی و کد داخلی به سند صفحه وارد نمی‌شود.',
		example: 'محصولات ویژه یا تازهٔ فروشگاه، با پیوند مستقیم به جزئیات واقعی هر محصول.',
		defaultProps: {
			heading: 'محصولات منتخب',
			emptyMessage: 'هنوز محصول فعالی در این بخش ثبت نشده است.',
			binding: { provider: 'novex-commerce-products', version: 1, selection: 'featured', limit: 4 },
		},
		fields: [
			{ key: 'heading', label: 'عنوان بخش', kind: 'text', group: 'content', maxLength: 120 },
			{ key: 'emptyMessage', label: 'پیام فهرست خالی', kind: 'text', group: 'content', maxLength: 180 },
			{
				key: 'binding.selection',
				label: 'منبع محصولات',
				kind: 'select',
				group: 'content',
				options: [
					{ value: 'featured', label: 'ویژه' },
					{ value: 'latest', label: 'تازه‌ترین' },
					{ value: 'category', label: 'دسته‌بندی' },
				],
			},
			{ key: 'binding.category', label: 'دسته‌بندی دقیق', kind: 'text', group: 'content', maxLength: 60 },
			{
				key: 'binding.limit',
				label: 'تعداد کارت‌ها',
				kind: 'number',
				group: 'layout',
				options: [2, 3, 4, 6, 8, 12].map((value) => ({ value, label: String(value) })),
			},
			...commonStyleFields,
		],
		allowedChildren: [],
		supportsChildren: false,
		previewRenderer: 'productGrid',
		productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'ProductGrid'>,
	InquiryForm: {
		type: 'InquiryForm', version: 1, label: 'فرم درخواست', category: 'action',
		description: 'فرم ارتباط متصل به صندوق درخواست‌ها؛ ذخیره‌سازی توسط سرویس Go و PostgreSQL.',
		documentation: 'پس از انتشار صفحه و راه‌اندازی سرویس، درخواست در صندوق مدیریت ثبت می‌شود. این فرم رزرو یا ثبت‌نام قطعی انجام نمی‌دهد.',
		example: 'درخواست تماس، مشاوره، رزرو یا اطلاعات دوره.',
		defaultProps: { title: 'برای ما بنویسید', description: 'اطلاعات خود را بفرستید تا با شما تماس بگیریم.', buttonLabel: 'ارسال درخواست', kind: 'contact' },
		fields: [
			{ key: 'title', label: 'عنوان فرم', kind: 'text', group: 'content', maxLength: 120 },
			{ key: 'description', label: 'توضیح فرم', kind: 'textarea', group: 'content', maxLength: 300 },
			{ key: 'buttonLabel', label: 'متن دکمه', kind: 'text', group: 'content', maxLength: 80 },
			{ key: 'kind', label: 'نوع درخواست', kind: 'select', group: 'content', options: [
				{ value: 'contact', label: 'تماس' }, { value: 'reservation', label: 'درخواست رزرو' },
				{ value: 'consultation', label: 'درخواست مشاوره' }, { value: 'enrollment', label: 'درخواست اطلاعات دوره' },
			] },
			...commonStyleFields,
		],
		allowedChildren: [], supportsChildren: false, previewRenderer: 'inquiryForm', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'InquiryForm'>,
	PluginBlock: {
		type: 'PluginBlock', version: 1, label: 'مؤلفهٔ افزونه', category: 'content',
		description: 'مؤلفهٔ داده‌محور با نمایش کنترل‌شده و نسخهٔ مستقل.',
		documentation: 'فیلدها و نمایش در سند ذخیره می‌شوند؛ هیچ کد افزونه‌ای برای رندر اجرا نمی‌شود.',
		example: 'اعلان سفارشی افزونه.',
		defaultProps: { pluginId: 'core', componentId: 'notice', pluginVersion: '1.0.0', label: 'اعلان', fields: [{ key: 'message', label: 'پیام', kind: 'text', value: 'متن اعلان', maxLength: 240 }], parts: [{ type: 'text', textKey: 'message' }] },
		fields: [...commonStyleFields], allowedChildren: [], supportsChildren: false,
		previewRenderer: 'pluginBlock', productionRenderer: 'BuilderNode.astro',
	} satisfies ComponentDefinition<'PluginBlock'>,

} satisfies { [K in BuilderComponentType]: ComponentDefinition<K> };

export const COMPONENT_REGISTRY = definitions;
export const COMPONENT_LIST = BUILDER_COMPONENT_TYPES.filter((type) => type !== 'PluginBlock').map((type) => definitions[type]);

export function getComponentDefinition(type: BuilderComponentType): ComponentDefinition {
	return COMPONENT_REGISTRY[type];
}

export function isBuilderComponentType(value: unknown): value is BuilderComponentType {
	return typeof value === 'string' && (BUILDER_COMPONENT_TYPES as readonly string[]).includes(value);
}

export function safeImageSrc(value: string): boolean {
	const src = value.trim();
	if (!src) return true;
	if (src.length > 500 || /[\\\u0000-\u001f\u007f]/.test(src)) return false;
	if (parseBuilderMediaReference(src)) return true;
	if (src.startsWith('/') && !src.startsWith('//')) return true;
	try {
		const parsed = new URL(src);
		return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
	} catch {
		return false;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) throw new Error(`${label} contains unsupported property "${key}".`);
	}
}

function text(value: unknown, key: string, maxLength: number): string {
	if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
		throw new Error(`Property "${key}" must be a text value of at most ${maxLength} characters.`);
	}
	return value;
}

function enumValue<T extends string>(value: unknown, key: string, allowed: readonly T[]): T {
	if (typeof value !== 'string' || !allowed.includes(value as T)) {
		throw new Error(`Property "${key}" has an unsupported value.`);
	}
	return value as T;
}

function integerValue(value: unknown, key: string, allowed: readonly number[]): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || !allowed.includes(value)) {
		throw new Error(`Property "${key}" must be one of the allowed integer values.`);
	}
	return value;
}

function collectionId(value: unknown): string {
	const id = text(value, 'item.id', 80);
	if (!/^item_[A-Za-z0-9_-]{4,75}$/.test(id)) throw new Error('Collection item ID is invalid.');
	return id;
}

function normalizeCollection<T extends { id: string }>(input: unknown, label: string, allowed: readonly string[], normalize: (item: Record<string, unknown>) => T): T[] {
	if (!Array.isArray(input) || input.length > 24) throw new Error(`${label} must have at most 24 items.`);
	const seen = new Set<string>();
	return input.map((value) => {
		if (!isRecord(value)) throw new Error(`${label} item must be an object.`);
		assertOnlyKeys(value, allowed, `${label} item`);
		const item = normalize(value);
		if (seen.has(item.id)) throw new Error(`${label} item IDs must be unique.`);
		seen.add(item.id);
		return item;
	});
}

export function normalizeProps<T extends BuilderComponentType>(
	type: T,
	input: unknown,
): ComponentPropsByType[T] {
	const definition = COMPONENT_REGISTRY[type] as unknown as ComponentDefinition<T>;
	if (input === undefined && type === 'PluginBlock') throw new Error('Plugin snapshot is required.');
	if (input === undefined) return structuredClone(definition.defaultProps);
	if (!isRecord(input)) throw new Error(`Properties for ${type} must be an object.`);
	const allowed = Object.keys(definition.defaultProps);
	if (type === 'Text' || type === 'Heading' || type === 'Blockquote') allowed.push('marks');
	if (type === 'PluginBlock' && allowed.some((key) => !Object.hasOwn(input, key))) throw new Error('Plugin snapshot is incomplete.');
	assertOnlyKeys(input, allowed, `${type} properties`);
	const merged = { ...definition.defaultProps, ...input } as Record<string, unknown>;

	if (type === 'Container') {
		return {
			layout: enumValue(merged.layout, 'layout', ['stack', 'row', 'grid']),
			maxWidth: enumValue(merged.maxWidth, 'maxWidth', ['sm', 'md', 'lg', 'full']),
			gap: integerValue(merged.gap, 'gap', SPACING_STEPS),
			padding: integerValue(merged.padding, 'padding', SPACING_STEPS),
			background: enumValue(merged.background, 'background', ['none', 'surface', 'soft', 'brand']),
		} as ComponentPropsByType[T];
	}

	if (type === 'Heading') {
		const content = text(merged.text, 'text', 240);
		const marks = normalizeTextMarks(content, merged.marks === undefined ? [] : merged.marks);
		return {
			text: content,
			...(marks.length ? { marks } : {}),
			level: integerValue(merged.level, 'level', [1, 2, 3, 4]),
			align: enumValue(merged.align, 'align', ['start', 'center', 'end']),
			color: enumValue<ThemeColor>(merged.color, 'color', ['ink', 'muted', 'brand', 'surface', 'soft']),
			size: enumValue(merged.size, 'size', ['sm', 'md', 'lg', 'xl']),
		} as ComponentPropsByType[T];
	}

	if (type === 'Text') {
		const content = text(merged.text, 'text', 5000);
		const marks = normalizeTextMarks(content, merged.marks === undefined ? [] : merged.marks);
		return {
			text: content,
			...(marks.length ? { marks } : {}),
			align: enumValue(merged.align, 'align', ['start', 'center', 'end']),
			color: enumValue<ThemeColor>(merged.color, 'color', ['ink', 'muted', 'brand', 'surface', 'soft']),
			size: enumValue(merged.size, 'size', ['sm', 'md', 'lg']),
		} as ComponentPropsByType[T];
	}

	if (type === 'Image') {
		const src = text(merged.src, 'src', 500).trim();
		if (!safeImageSrc(src)) throw new Error('Image source must be an internal path, a stored media reference, or a safe HTTPS URL.');
		return {
			src,
			alt: text(merged.alt, 'alt', 240),
			caption: text(merged.caption, 'caption', 240),
			aspectRatio: enumValue(merged.aspectRatio, 'aspectRatio', ['auto', 'wide', 'square', 'portrait']),
			fit: enumValue(merged.fit, 'fit', ['cover', 'contain']),
		} as ComponentPropsByType[T];
	}

	if (type === 'Spacer') {
		if (typeof merged.size !== 'number' || !Number.isInteger(merged.size) || merged.size < 0 || merged.size > 1024) throw new Error('Spacer size must be an integer between 0 and 1024.');
		return { size: merged.size } as ComponentPropsByType[T];
	}
	if (type === 'Divider') {
		return {
			thickness: integerValue(merged.thickness, 'thickness', [1, 2, 4]),
			lineStyle: enumValue(merged.lineStyle, 'lineStyle', ['solid', 'dashed', 'dotted']),
			color: enumValue(merged.color, 'color', ['muted', 'ink', 'brand']),
		} as ComponentPropsByType[T];
	}


	if (type === 'Blockquote') {
		const content = text(merged.text, 'text', 5000);
		const marks = normalizeTextMarks(content, merged.marks === undefined ? [] : merged.marks);
		return { text: content, ...(marks.length ? { marks } : {}), author: text(merged.author, 'author', 160), role: text(merged.role, 'role', 160) } as ComponentPropsByType[T];
	}
	if (type === 'Accordion' || type === 'Tabs') {
		return { items: normalizeCollection(merged.items, type, ['id', 'title', 'body', 'titleMarks', 'bodyMarks'], (item) => {
			const title = text(item.title, 'title', 240); const body = text(item.body, 'body', 5000);
			const titleMarks = normalizeTextMarks(title, item.titleMarks === undefined ? [] : item.titleMarks);
			const bodyMarks = normalizeTextMarks(body, item.bodyMarks === undefined ? [] : item.bodyMarks);
			if (titleMarks.some((mark) => mark.kind === 'link')) throw new Error('Interactive collection titles cannot contain links.');
			return { id: collectionId(item.id), title, body, ...(titleMarks.length ? { titleMarks } : {}), ...(bodyMarks.length ? { bodyMarks } : {}) };
		}) } as ComponentPropsByType[T];
	}
	if (type === 'List') {
		return {
			kind: enumValue(merged.kind, 'kind', ['ordered', 'unordered']),
			items: normalizeCollection(merged.items, 'List', ['id', 'text', 'href', 'marks'], (item) => {
				const href = text(item.href, 'href', 500).trim();
				if (href && !safeHref(href)) throw new Error('List link is unsafe.');
				const content = text(item.text, 'text', 5000);
				const marks = normalizeTextMarks(content, item.marks === undefined ? [] : item.marks);
				if (href && marks.some((mark) => mark.kind === 'link')) throw new Error('A list item cannot contain nested links.');
				return { id: collectionId(item.id), text: content, href, ...(marks.length ? { marks } : {}) };
			}),
		} as ComponentPropsByType[T];
	}
	if (type === 'ImageGallery') {
		return {
			items: normalizeCollection(merged.items, 'ImageGallery', ['id', 'src', 'alt', 'caption'], (item) => {
				const src = text(item.src, 'src', 500).trim();
				if (!safeImageSrc(src)) throw new Error('Gallery image source is unsafe.');
				return { id: collectionId(item.id), src, alt: text(item.alt, 'alt', 240), caption: text(item.caption, 'caption', 240) };
			}),
			columns: integerValue(merged.columns, 'columns', [1, 2, 3, 4]),
		} as ComponentPropsByType[T];
	}
	if (type === 'VideoEmbed') {
		const youtubeId = text(merged.youtubeId, 'youtubeId', 11).trim();
		const vimeoId = text(merged.vimeoId, 'vimeoId', 12).trim();
		if (youtubeId && !/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) throw new Error('YouTube video ID is invalid.');
		if (vimeoId && !/^[1-9][0-9]{5,11}$/.test(vimeoId)) throw new Error('Vimeo video ID is invalid.');
		return { provider: enumValue(merged.provider, 'provider', ['youtube', 'vimeo']), youtubeId, vimeoId, title: text(merged.title, 'title', 160) } as ComponentPropsByType[T];
	}
	if (type === 'CodeWidget') {
		if (typeof merged.height !== 'number' || !Number.isInteger(merged.height) || merged.height < 80 || merged.height > 1200) throw new Error('Code widget height must be an integer from 80 to 1200.');
		const title = text(merged.title, 'title', 160).trim();
		if (!title) throw new Error('Code widget title is required.');
		return { title, html: text(merged.html, 'html', 16000), css: text(merged.css, 'css', 16000), javascript: text(merged.javascript, 'javascript', 16000), height: merged.height } as ComponentPropsByType[T];
	}
	if (type === 'GlobalCode') {
		const title = text(merged.title, 'title', 160).trim();
		if (!title) throw new Error('Global code title is required.');
		return { title, css: text(merged.css, 'css', 64000), javascript: text(merged.javascript, 'javascript', 64000) } as ComponentPropsByType[T];
	}
	if (type === 'PluginBlock') {
		return normalizePluginBlockProps(merged) as ComponentPropsByType[T];
	}

	if (type === 'InquiryForm') {
		const title = text(merged.title, 'title', 120).trim();
		const buttonLabel = text(merged.buttonLabel, 'buttonLabel', 80).trim();
		if (!title || !buttonLabel) throw new Error('Form title and button label are required.');
		return { title, description: text(merged.description, 'description', 300), buttonLabel,
			kind: enumValue(merged.kind, 'kind', ['contact', 'reservation', 'consultation', 'enrollment']),
		} as ComponentPropsByType[T];
	}

	if (type === 'ProductGrid') {
		return {
			heading: text(merged.heading, 'heading', 120),
			emptyMessage: text(merged.emptyMessage, 'emptyMessage', 180),
			binding: normalizeProductGridBinding(merged.binding),
		} as ComponentPropsByType[T];
	}

	const label = text(merged.label, 'label', 80);
	const href = text(merged.href, 'href', 500);
	if (!safeHref(href)) throw new Error('Button destination must be a safe internal or HTTP(S) URL.');
	return {
		label,
		href,
		variant: enumValue(merged.variant, 'variant', ['primary', 'outline']),
		align: enumValue(merged.align, 'align', ['start', 'center', 'end']),
	} as ComponentPropsByType[T];
}

const NODE_STYLE_KEYS = [
	'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
	'layout', 'direction', 'columns', 'gap', 'alignItems', 'justifyContent', 'overflow',
	'marginBlockStart', 'marginBlockEnd', 'paddingBlockStart', 'paddingBlockEnd', 'paddingInlineStart', 'paddingInlineEnd', 'borderRadius',
] as const;

export function normalizeNodeStyles(input: unknown): NodeStyles {
	if (input === undefined) return {};
	if (!isRecord(input)) throw new Error('Node styles must be an object.');
	assertOnlyKeys(input, NODE_STYLE_KEYS, 'Node styles');
	const output: NodeStyles = {};
	if (input.width !== undefined) {
		output.width = typeof input.width === 'string' && ['content', 'full', 'narrow', 'wide'].includes(input.width)
			? input.width : normalizeLayoutLength(input.width, 'styles.width');
	}
	for (const key of ['height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
		if (input[key] !== undefined) output[key] = normalizeLayoutLength(input[key], `styles.${key}`);
	}
	if (input.layout !== undefined) output.layout = enumValue<NonNullable<NodeStyles['layout']>>(input.layout, 'styles.layout', ['block', 'flex', 'grid', 'inline-block']);
	if (input.direction !== undefined) output.direction = enumValue<NonNullable<NodeStyles['direction']>>(input.direction, 'styles.direction', ['row', 'column']);
	if (input.columns !== undefined) output.columns = integerValue(input.columns, 'styles.columns', [1, 2, 3, 4, 6]) as NodeStyles['columns'];
	if (input.gap !== undefined) output.gap = integerValue(input.gap, 'styles.gap', SPACING_STEPS) as NodeStyles['gap'];
	if (input.alignItems !== undefined) output.alignItems = enumValue<NonNullable<NodeStyles['alignItems']>>(input.alignItems, 'styles.alignItems', ['start', 'center', 'end', 'stretch']);
	if (input.justifyContent !== undefined) output.justifyContent = enumValue<NonNullable<NodeStyles['justifyContent']>>(input.justifyContent, 'styles.justifyContent', ['start', 'center', 'end', 'space-between', 'space-around']);
	if (input.overflow !== undefined) output.overflow = enumValue<NonNullable<NodeStyles['overflow']>>(input.overflow, 'styles.overflow', ['visible', 'hidden', 'auto']);
	for (const key of ['marginBlockStart', 'marginBlockEnd', 'paddingBlockStart', 'paddingBlockEnd', 'paddingInlineStart', 'paddingInlineEnd'] as const) {
		if (input[key] !== undefined) output[key] = integerValue(input[key], `styles.${key}`, SPACING_STEPS) as NodeStyles[typeof key];
	}
	if (input.borderRadius !== undefined) output.borderRadius = enumValue<NonNullable<NodeStyles['borderRadius']>>(input.borderRadius, 'styles.borderRadius', ['none', 'sm', 'md', 'lg']);
	return output;
}

export function normalizeResponsiveStyles(input: unknown, allowed: readonly Breakpoint[] = BREAKPOINTS): Partial<Record<Breakpoint, ResponsiveNodeStyles>> | undefined {
	if (input === undefined) return undefined;
	if (!isRecord(input)) throw new Error('Responsive styles must be an object.');
	assertOnlyKeys(input, allowed, 'Responsive styles');
	const output: Partial<Record<Breakpoint, ResponsiveNodeStyles>> = {};
	for (const breakpoint of allowed) {
		const raw = input[breakpoint];
		if (raw === undefined) continue;
		if (!isRecord(raw)) throw new Error(`Responsive styles for ${breakpoint} must be an object.`);
		assertOnlyKeys(raw, [...NODE_STYLE_KEYS, 'hidden'], `Responsive styles for ${breakpoint}`);
		const hidden = raw.hidden;
		if (hidden !== undefined && typeof hidden !== 'boolean') throw new Error('Responsive hidden must be a boolean.');
		const { hidden: _hidden, ...styles } = raw;
		const normalizedStyles = normalizeNodeStyles(styles);
		if (Object.keys(normalizedStyles).length || hidden !== undefined) output[breakpoint] = { ...normalizedStyles, ...(hidden === undefined ? {} : { hidden }) };
	}
	return Object.keys(output).length ? output : undefined;
}

/** Validate declarative plugin snapshots independently of plugin availability. */
function normalizePluginBlockProps(raw: Record<string, unknown>): import('./types.ts').PluginBlockProps {
	const slug = (value: unknown, key: string) => {
		if (typeof value !== 'string' || value.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error(`Invalid ${key}.`);
		return value;
	};
	const pluginId = slug(raw.pluginId, 'pluginId');
	const componentId = slug(raw.componentId, 'componentId');
	const pluginVersion = text(raw.pluginVersion, 'pluginVersion', 80);
	if (!isSemVer(pluginVersion)) throw new Error('Invalid plugin version.');
	const label = text(raw.label, 'label', 100).trim();
	if (!label) throw new Error('Plugin label is required.');
	if (!Array.isArray(raw.fields) || raw.fields.length < 1 || raw.fields.length > 12 || !Array.isArray(raw.parts) || raw.parts.length < 1 || raw.parts.length > 12) throw new Error('Invalid plugin fields or parts.');
	const keys = new Set<string>();
	const fields: import('./types.ts').PluginBlockField[] = raw.fields.map((field: unknown) => {
		if (!isRecord(field)) throw new Error('Invalid plugin field.');
		assertOnlyKeys(field, ['key', 'label', 'kind', 'value', 'maxLength'], 'Plugin field');
		const key = slug(field.key, 'field key');
		if (keys.has(key)) throw new Error('Duplicate plugin field.');
		keys.add(key);
		const label = text(field.label, 'field label', 100).trim();
		if (!label) throw new Error('Field label is required.');
		const kind = enumValue(field.kind, 'field kind', ['text', 'textarea', 'url'] as const);
		if (typeof field.maxLength !== 'number' || !Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > (kind === 'url' ? 500 : 5000)) throw new Error('Invalid field length.');
		const value = text(field.value, 'field value', field.maxLength);
		if (kind === 'url' && !safeHref(value)) throw new Error('Unsafe plugin link.');
		return { key, label, kind, value, maxLength: field.maxLength };
	});
	const parts: import('./types.ts').PluginBlockPart[] = raw.parts.map((part: unknown) => {
		if (!isRecord(part)) throw new Error('Invalid plugin part.');
		assertOnlyKeys(part, ['type', 'textKey', 'hrefKey'], 'Plugin part');
		const type = enumValue(part.type, 'part type', ['heading', 'text', 'button'] as const);
		const textKey = slug(part.textKey, 'part text');
		const field = fields.find((item) => item.key === textKey);
		const limit = type === 'heading' ? 240 : type === 'button' ? 80 : 5000;
		if (!field || field.kind === 'url' || field.maxLength > limit) throw new Error('Invalid plugin text binding.');
		if (type === 'button') {
			const hrefKey = slug(part.hrefKey, 'part link');
			if (fields.find((item) => item.key === hrefKey)?.kind !== 'url') throw new Error('Invalid plugin link binding.');
			return { type, textKey, hrefKey };
		}
		if (part.hrefKey !== undefined) throw new Error('Unexpected plugin link binding.');
		return { type, textKey };
	});
	return { pluginId, componentId, pluginVersion, label, fields, parts };
}
