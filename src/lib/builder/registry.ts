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
		],
	},
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
			...commonStyleFields,
		],
		allowedChildren: ['Container', 'Heading', 'Text', 'Image', 'Button', 'ProductGrid', 'PluginBlock'],
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
			{ key: 'text', label: 'متن تیتر', kind: 'text', group: 'content', maxLength: 240 },
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
		description: 'پاراگراف ساده و امن برای توضیح و محتوای صفحه.',
		documentation: 'متن به‌صورت متن ساده ذخیره می‌شود؛ HTML یا اسکریپت دلخواه اجرا نمی‌شود.',
		example: 'توضیح محصول، معرفی خدمات یا متن راهنما.',
		defaultProps: { text: 'متن خود را اینجا بنویسید.', align: 'start', color: 'ink', size: 'md' },
		fields: [
			{ key: 'text', label: 'متن', kind: 'textarea', group: 'content', maxLength: 5000 },
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

export function safeHref(value: string): boolean {
	const href = value.trim();
	if (!href || href.length > 500 || /[\\\u0000-\u001f\u007f]/.test(href)) return false;
	if (href.startsWith('/') && !href.startsWith('//')) return true;
	if (href.startsWith('#')) return true;
	try {
		const parsed = new URL(href);
		return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password;
	} catch {
		return false;
	}
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

export function normalizeProps<T extends BuilderComponentType>(
	type: T,
	input: unknown,
): ComponentPropsByType[T] {
	const definition = COMPONENT_REGISTRY[type] as unknown as ComponentDefinition<T>;
	if (input === undefined && type === 'PluginBlock') throw new Error('Plugin snapshot is required.');
	if (input === undefined) return structuredClone(definition.defaultProps);
	if (!isRecord(input)) throw new Error(`Properties for ${type} must be an object.`);
	const allowed = Object.keys(definition.defaultProps);
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
		return {
			text: text(merged.text, 'text', 240),
			level: integerValue(merged.level, 'level', [1, 2, 3, 4]),
			align: enumValue(merged.align, 'align', ['start', 'center', 'end']),
			color: enumValue<ThemeColor>(merged.color, 'color', ['ink', 'muted', 'brand', 'surface', 'soft']),
			size: enumValue(merged.size, 'size', ['sm', 'md', 'lg', 'xl']),
		} as ComponentPropsByType[T];
	}

	if (type === 'Text') {
		return {
			text: text(merged.text, 'text', 5000),
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

	if (type === 'PluginBlock') {
		return normalizePluginBlockProps(merged) as ComponentPropsByType[T];
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

export function normalizeNodeStyles(input: unknown): NodeStyles {
	if (input === undefined) return {};
	if (!isRecord(input)) throw new Error('Node styles must be an object.');
	const allowedKeys = [
		'width',
		'marginBlockStart',
		'marginBlockEnd',
		'paddingBlockStart',
		'paddingBlockEnd',
		'paddingInlineStart',
		'paddingInlineEnd',
		'borderRadius',
	];
	assertOnlyKeys(input, allowedKeys, 'Node styles');
	const output: NodeStyles = {};
	if (input.width !== undefined) output.width = enumValue<NonNullable<NodeStyles['width']>>(input.width, 'styles.width', ['content', 'full', 'narrow', 'wide']);
	for (const key of allowedKeys.slice(1, -1) as Array<keyof Omit<NodeStyles, 'width' | 'borderRadius'>>) {
		if (input[key] !== undefined) output[key] = integerValue(input[key], `styles.${key}`, SPACING_STEPS) as never;
	}
	if (input.borderRadius !== undefined) {
		output.borderRadius = enumValue<NonNullable<NodeStyles['borderRadius']>>(input.borderRadius, 'styles.borderRadius', ['none', 'sm', 'md', 'lg']);
	}
	return output;
}

export function normalizeResponsiveStyles(input: unknown): Partial<Record<Breakpoint, ResponsiveNodeStyles>> | undefined {
	if (input === undefined) return undefined;
	if (!isRecord(input)) throw new Error('Responsive styles must be an object.');
	assertOnlyKeys(input, BREAKPOINTS, 'Responsive styles');
	const output: Partial<Record<Breakpoint, ResponsiveNodeStyles>> = {};
	for (const breakpoint of BREAKPOINTS) {
		const raw = input[breakpoint];
		if (raw === undefined) continue;
		if (!isRecord(raw)) throw new Error(`Responsive styles for ${breakpoint} must be an object.`);
		assertOnlyKeys(raw, [...Object.keys({ width: 1, marginBlockStart: 1, marginBlockEnd: 1, paddingBlockStart: 1, paddingBlockEnd: 1, paddingInlineStart: 1, paddingInlineEnd: 1, borderRadius: 1 }), 'hidden'], `Responsive styles for ${breakpoint}`);
		const hidden = raw.hidden;
		if (hidden !== undefined && typeof hidden !== 'boolean') throw new Error('Responsive hidden must be a boolean.');
		const { hidden: _hidden, ...styles } = raw;
		const normalizedStyles = normalizeNodeStyles(styles);
		if (breakpoint === 'desktop' && Object.keys(normalizedStyles).length) {
			throw new Error('Desktop style overrides must use the base styles object.');
		}
		output[breakpoint] = { ...normalizedStyles, ...(hidden === undefined ? {} : { hidden }) };
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
