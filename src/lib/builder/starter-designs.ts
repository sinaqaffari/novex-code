import { createEmptyPageDocument, validatePageDocument } from './document.ts';
import { createBuilderNode } from './operations.ts';
import type { StarterTemplate } from './templates.ts';
import type {
	BuilderNode, BuilderThemeId, ComponentPropsByType, ContainerNode, NodeStyles, ResponsiveNodeStyles,
} from './types.ts';

/** These are ordinary, editable native nodes, not screenshots or embedded HTML. */
interface LandingDesign {
	id: string;
	label: string;
	description: string;
	theme: BuilderThemeId;
	brand: string;
	kicker: string;
	headline: string;
	intro: string;
	button: string;
	buttonHref: string;
	image: string;
	imageAlt: string;
	sectionTitle: string;
	sectionText: string;
	cards: readonly { title: string; text: string }[];
	ctaTitle: string;
	ctaText: string;
	store?: boolean;
	category: 'business' | 'travel' | 'creative' | 'shop' | 'food' | 'health' | 'education' | 'beauty';
	faq?: readonly { title: string; body: string }[];
}

const DESIGNS: readonly LandingDesign[] = [
	{
		id: 'studio-landing', label: 'استودیو معماری', description: 'صفحهٔ کامل معرفی استودیو با تصویر، خدمات و بخش تماس.', theme: 'warm', category: 'business',
		brand: 'استودیو فضا', kicker: 'معماری · طراحی · زندگی', headline: 'فضاهایی برای زندگی بهتر',
		intro: 'از ایده تا اجرا، فضایی بسازید که با شیوهٔ زندگی و نگاه شما هماهنگ باشد. این متن نمونه را با داستان استودیوی خود جایگزین کنید.',
		button: 'دربارهٔ پروژهٔ خود بگویید', buttonHref: '/contact', image: 'builder-studio.jpg', imageAlt: 'تصویر نمونه از فضای داخلی روشن با طاق‌های معماری',
		sectionTitle: 'نگاهی تازه به هر فضا', sectionText: 'خدمات و تخصص‌های خود را در این بخش معرفی کنید.',
		cards: [
			{ title: 'طراحی معماری', text: 'از نیازهای پروژه تا ایده‌پردازی و طراحی فضایی متناسب با شما.' },
			{ title: 'طراحی داخلی', text: 'ترکیب نور، متریال و جزئیات برای فضاهای کاربردی و دلنشین.' },
			{ title: 'مشاوره و اجرا', text: 'همراهی در انتخاب مسیر، بررسی جزئیات و پیشبرد پروژه.' },
		],
		ctaTitle: 'ایده‌ای در ذهن دارید؟', ctaText: 'از اولین گفت‌وگو شروع کنیم و مسیر پروژهٔ شما را با هم ترسیم کنیم.',
	},
	{
		id: 'travel-landing', label: 'سفر و طبیعت', description: 'صفحهٔ کامل برای معرفی تجربه‌های سفر، مقصد و ارتباط.', theme: 'ocean', category: 'travel',
		brand: 'راهِ دور', kicker: 'کمی دورتر، کمی نزدیک‌تر', headline: 'سفرهای کوچک، خاطره‌های بزرگ',
		intro: 'جایی میان کوه و آب، فرصتی برای کشف مسیرهای تازه پیدا کنید. متن و تصویر این طرح نمونه را با محتوای سفرهای خود عوض کنید.',
		button: 'برنامه‌ریزی سفر', buttonHref: '/contact', image: 'builder-journey.jpg', imageAlt: 'تصویر نمونه از دریاچه‌ای میان کوهستان',
		sectionTitle: 'سفر را به شیوهٔ خودتان ببینید', sectionText: 'آنچه سفرهای شما را متفاوت می‌کند اینجا بنویسید.',
		cards: [
			{ title: 'طبیعت‌گردی', text: 'مسیرهایی برای نفس کشیدن، تماشا و کشف زیبایی‌های طبیعت.' },
			{ title: 'سفرهای شخصی', text: 'ایده‌هایی برای برنامه‌ریزی سفری متناسب با زمان و سلیقهٔ شما.' },
			{ title: 'راهنمای مقصد', text: 'پیش از حرکت با دیدنی‌ها، مسیرها و نکته‌های سفر آشنا شوید.' },
		],
		ctaTitle: 'سفر بعدی از اینجا شروع می‌شود', ctaText: 'مقصد مورد علاقه‌تان را با ما در میان بگذارید.',
	},
	{
		id: 'portfolio-landing', label: 'نمونه‌کار خلاق', description: 'صفحهٔ معرفی طراح یا تیم خلاق با خدمات و دعوت به همکاری.', theme: 'site', category: 'creative',
		brand: 'استودیو فرم', kicker: 'ایده · طراحی · تجربه', headline: 'ایده‌های خوب، شکل تازه می‌گیرند',
		intro: 'یک فضای ساده برای معرفی کارها، رویکرد و پروژه‌هایی که دوست دارید خلق کنید. متن و تصویر نمونه را با نمونه‌کار خود جایگزین کنید.',
		button: 'شروع همکاری', buttonHref: '/contact', image: 'builder-portfolio.jpg', imageAlt: 'تصویر نمونه از یک فرم انتزاعی آبی',
		sectionTitle: 'از ایده تا تجربه', sectionText: 'مهارت‌ها یا حوزه‌های کاری خود را با چند جمله معرفی کنید.',
		cards: [
			{ title: 'هویت بصری', text: 'ساخت زبانی یکپارچه برای بیان شخصیت و داستان برند.' },
			{ title: 'طراحی دیجیتال', text: 'طراحی تجربه‌های روشن و کاربردی برای محیط‌های دیجیتال.' },
			{ title: 'مسیر خلاق', text: 'تبدیل مسئله‌های پیچیده به ایده‌هایی ساده و قابل اجرا.' },
		],
		ctaTitle: 'بیایید چیز خوبی بسازیم', ctaText: 'دربارهٔ ایده یا پروژهٔ تازه‌تان برای ما بنویسید.',
	},
	{
		id: 'shop-landing', label: 'فروشگاه خانه و زندگی', description: 'صفحهٔ فروشگاهی با تصویر نمونه و شبکهٔ متصل به محصولات واقعی.', theme: 'warm', category: 'shop',
		brand: 'خانهٔ آرام', kicker: 'جزئیات ساده، حال خوب', headline: 'زیبایی در چیزهای روزمره',
		intro: 'مجموعه‌ای برای خانه‌ای که دوستش دارید. این تصویر نمونه و نوشته‌ها را با محتوای فروشگاه خود جایگزین کنید.',
		button: 'دیدن فروشگاه', buttonHref: '/shop', image: 'builder-shop.jpg', imageAlt: 'تصویر نمونه از ظرف‌ها و فنجان‌های سرامیکی',
		sectionTitle: 'با سلیقه انتخاب کنید', sectionText: 'دسته‌ها یا ویژگی‌های فروشگاه خود را در این بخش معرفی کنید.',
		cards: [
			{ title: 'برای خانه', text: 'جزئیاتی برای فضاهای روزمره و لحظه‌های آرام.' },
			{ title: 'برای هدیه', text: 'ایده‌هایی برای انتخاب هدیه‌ای ساده و شخصی.' },
			{ title: 'برای هر روز', text: 'انتخاب‌هایی که زیبایی و کاربرد را کنار هم قرار می‌دهند.' },
		],
		ctaTitle: 'انتخاب بعدی شما اینجاست', ctaText: 'به فروشگاه سر بزنید و محصولات موجود را ببینید.', store: true,
	},
	{
		id: 'restaurant-landing', label: 'رستوران و کافه', description: 'معرفی رستوران با تصویر، بخش‌های قابل ویرایش و راه ارتباط.', theme: 'warm', category: 'food',
		brand: 'سفره', kicker: 'طعم خوب · دورهمی خوب', headline: 'هر میز، یک خاطرهٔ تازه',
		intro: 'داستان آشپزخانه، منو و فضای خود را اینجا بنویسید. تصویر و متن‌های این طرح نمونه را پیش از انتشار جایگزین کنید.',
		button: 'تماس و هماهنگی', buttonHref: '/contact', image: 'builder-restaurant.jpg', imageAlt: 'میز غذای ایرانی با سبزی، برنج زعفرانی و نان',
		sectionTitle: 'از آشپزخانهٔ ما', sectionText: 'با چند جمله، تجربه و سبک پذیرایی خود را معرفی کنید.',
		cards: [
			{ title: 'خوراک‌های روز', text: 'غذاهای دلخواه و شیوهٔ آماده‌سازی خود را معرفی کنید.' },
			{ title: 'فضای رستوران', text: 'از حال‌وهوای فضا و مهمانی‌های خود بگویید.' },
			{ title: 'پذیرایی و رویداد', text: 'امکانات و شرایط هماهنگی را برای مهمان‌ها شرح دهید.' },
		],
		ctaTitle: 'برای یک دیدار خوش‌طعم', ctaText: 'راه ارتباطی و ساعت کاری واقعی خود را در صفحهٔ تماس ثبت کنید.',
	},
	{
		id: 'clinic-landing', label: 'کلینیک و سلامت', description: 'صفحهٔ معرفی خدمات سلامت با پرسش‌های متداول و راه ارتباط.', theme: 'ocean', category: 'health',
		brand: 'رویش', kicker: 'آرامش · مراقبت · همراهی', headline: 'مراقبت بهتر، از یک گفت‌وگو آغاز می‌شود',
		intro: 'خدمات و رویکرد مجموعهٔ خود را معرفی کنید. این متن و تصویر صرفاً نمونه‌اند و باید با اطلاعات واقعی جایگزین شوند.',
		button: 'راه‌های ارتباط', buttonHref: '/contact', image: 'builder-clinic.jpg', imageAlt: 'فضای روشن و آرام نمونه برای کلینیک',
		sectionTitle: 'همراه شما در مسیر سلامت', sectionText: 'حوزه‌های فعالیت واقعی مجموعه را اینجا توضیح دهید.',
		cards: [
			{ title: 'آشنایی با خدمات', text: 'حوزهٔ تخصص و خدمات خود را روشن و دقیق معرفی کنید.' },
			{ title: 'آمادگی برای مراجعه', text: 'اطلاعات لازم پیش از مراجعه را با مخاطبان به اشتراک بگذارید.' },
			{ title: 'ارتباط با مجموعه', text: 'راه‌های تماس و پاسخ‌گویی را به‌روز نگه دارید.' },
		],
		faq: [
			{ title: 'چگونه با مجموعه تماس بگیرم؟', body: 'پاسخ نمونه است؛ شماره و شیوهٔ تماس واقعی مجموعه را جایگزین کنید.' },
			{ title: 'پیش از مراجعه چه باید بدانم؟', body: 'اطلاعات و شرایط واقعی مراجعه را در این بخش وارد کنید.' },
		],
		ctaTitle: 'پرسشی دارید؟', ctaText: 'برای دریافت اطلاعات بیشتر از راه‌های ارتباطی مجموعه استفاده کنید.',
	},
	{
		id: 'education-landing', label: 'آموزش و دوره', description: 'معرفی آموزش، سرفصل‌ها و پرسش‌های متداول با مؤلفه‌های بومی.', theme: 'site', category: 'education',
		brand: 'مدرسهٔ فردا', kicker: 'یادگیری برای مسیر پیش رو', headline: 'یاد گرفتن را از همین‌جا شروع کنید',
		intro: 'موضوع آموزش، مخاطبان و مسیر یادگیری را با محتوای خودتان معرفی کنید. ثبت‌نام آنلاین در این طرح نمونه تعریف نشده است.',
		button: 'دریافت اطلاعات', buttonHref: '/contact', image: 'builder-learning.jpg', imageAlt: 'میز مطالعه با دفتر، هدفون و نور طبیعی',
		sectionTitle: 'مسیر یادگیری شما', sectionText: 'سرفصل‌ها و شیوهٔ ارائهٔ آموزش را با اطلاعات واقعی جایگزین کنید.',
		cards: [
			{ title: 'آشنایی', text: 'مفاهیم و پیش‌نیازهای دوره را اینجا شرح دهید.' },
			{ title: 'تمرین', text: 'نمونه‌ای از تمرین‌ها و روند یادگیری را معرفی کنید.' },
			{ title: 'ادامهٔ مسیر', text: 'گام‌های بعدی و منابع آموزشی خود را بنویسید.' },
		],
		faq: [
			{ title: 'این آموزش برای چه کسانی است؟', body: 'مخاطبان و پیش‌نیازهای واقعی دوره را اینجا وارد کنید.' },
			{ title: 'چگونه اطلاعات بیشتری دریافت کنم؟', body: 'روش ارتباط و شرایط واقعی ارائهٔ دوره را اینجا بنویسید.' },
		],
		ctaTitle: 'آمادهٔ یادگیری هستید؟', ctaText: 'برای پرسیدن دربارهٔ دوره‌ها با ما در تماس باشید.',
	},
	{
		id: 'beauty-landing', label: 'زیبایی و مراقبت', description: 'صفحهٔ معرفی خدمات زیبایی با تصویر، جزئیات خدمات و تماس.', theme: 'warm', category: 'beauty',
		brand: 'ماه‌چهره', kicker: 'مراقبت روزانه · حال خوب', headline: 'زمانی برای رسیدگی به خودتان',
		intro: 'خدمات و رویکرد مجموعهٔ خود را با تصویر و متن واقعی معرفی کنید. این طرح فقط محتوای نمونه دارد.',
		button: 'آشنایی و تماس', buttonHref: '/contact', image: 'builder-beauty.jpg', imageAlt: 'چیدمان مینیمال محصولات مراقبت پوست و برگ',
		sectionTitle: 'ساده، شخصی، برای شما', sectionText: 'خدمات مجموعهٔ خود را به شکلی روشن معرفی کنید.',
		cards: [
			{ title: 'مراقبت پوست', text: 'در این بخش خدمات و شرایط واقعی مجموعه را توضیح دهید.' },
			{ title: 'مشاوره', text: 'روش ارتباط و دریافت مشاوره را مشخص کنید.' },
			{ title: 'تجربهٔ شما', text: 'از فضای مجموعه و شیوهٔ ارائهٔ خدمات بگویید.' },
		],
		ctaTitle: 'همراه زیبایی روزمرهٔ شما', ctaText: 'برای آشنایی بیشتر، با مجموعه در ارتباط باشید.',
	},
];

function buildDesign(spec: LandingDesign): StarterTemplate {
	const id = (part: string) => `node_${spec.id.replaceAll('-', '_')}_${part}`;
	function container(part: string, props: Partial<ComponentPropsByType['Container']>, children: BuilderNode[], styles?: NodeStyles, responsiveStyles?: Partial<Record<'tablet' | 'mobile', ResponsiveNodeStyles>>): ContainerNode {
		const base = createBuilderNode('Container', id(part));
		return { ...base, props: { ...base.props, maxWidth: 'full', ...props }, children, ...(styles ? { styles } : {}), ...(responsiveStyles ? { responsiveStyles } : {}) };
	}
	function heading(part: string, text: string, options: Partial<ComponentPropsByType['Heading']> = {}): BuilderNode {
		const base = createBuilderNode('Heading', id(part));
		return { ...base, props: { ...base.props, text, ...options } };
	}
	function text(part: string, content: string, options: Partial<ComponentPropsByType['Text']> = {}): BuilderNode {
		const base = createBuilderNode('Text', id(part));
		return { ...base, props: { ...base.props, text: content, color: 'soft', ...options } };
	}
	function button(part: string, label: string, href: string, options: Partial<ComponentPropsByType['Button']> = {}): BuilderNode {
		const base = createBuilderNode('Button', id(part));
		return { ...base, props: { ...base.props, label, href, ...options }, ...(part === 'header_button' ? { styles: { width: 'content' } } : {}) };
	}
	const image = createBuilderNode('Image', id('hero_image'));
	const centeredHero = spec.id === 'travel-landing' || spec.id === 'clinic-landing';
	const imageFirst = centeredHero || spec.id === 'portfolio-landing' || spec.id === 'restaurant-landing';
	const heroImage: BuilderNode = { ...image, props: { ...image.props, src: `media://assets/${spec.image}`, alt: spec.imageAlt, aspectRatio: centeredHero ? 'wide' : 'square' } };
	const heroCopy = container('hero_copy', { background: 'none', gap: 24, padding: 16 }, [
		text('kicker', spec.kicker, { color: 'brand', size: 'sm', align: centeredHero ? 'center' : 'start' }),
		heading('headline', spec.headline, { level: 2, size: 'xl', align: centeredHero ? 'center' : 'start' }),
		text('intro', spec.intro, { size: 'lg', align: centeredHero ? 'center' : 'start' }),
		button('primary', spec.button, spec.buttonHref, { align: centeredHero ? 'center' : 'start' }),
	], centeredHero ? { width: 'narrow' } : undefined);
	const cards = spec.cards.map((card, index) => container(`card_${index}`, { background: 'surface', gap: 12, padding: 24 }, [
		heading(`card_number_${index}`, `۰${index + 1}`, { level: 3, size: 'sm', color: 'brand' }),
		heading(`card_title_${index}`, card.title, { level: 3, size: 'md' }),
		text(`card_text_${index}`, card.text, { size: 'sm' }),
	]));
	const nodes: BuilderNode[] = [
		container('header', { layout: 'row', background: 'none', gap: 16, padding: 16 }, [
			heading('brand', spec.brand, { level: 2, size: 'md' }),
			button('header_button', 'تماس با ما', '/contact', { variant: 'outline', align: 'end' }),
		], { alignItems: 'center', justifyContent: 'space-between' }),
		container('hero', { layout: centeredHero ? 'stack' : 'grid', background: spec.id === 'portfolio-landing' ? 'surface' : 'soft', gap: 32, padding: 32 }, imageFirst ? [heroImage, heroCopy] : [heroCopy, heroImage], centeredHero ? { alignItems: 'center' } : { columns: 2, alignItems: 'center' }, centeredHero ? undefined : { tablet: { columns: 1 } }),
		container('services', { background: 'none', gap: 24, padding: 32 }, [
			heading('section_title', spec.sectionTitle, { level: 2, size: 'lg' }),
			text('section_text', spec.sectionText),
			container('cards', { layout: 'grid', background: 'soft', gap: 16, padding: 16 }, cards, { columns: 3, alignItems: 'stretch' }, { tablet: { columns: 2 }, mobile: { columns: 1 } }),
		]),
	];
	if (spec.faq?.length) {
		const accordion = createBuilderNode('Accordion', id('faq_items'));
		nodes.push(container('faq', { background: 'soft', gap: 16, padding: 32 }, [
			heading('faq_title', 'پرسش‌های متداول', { level: 2, size: 'lg' }),
			{ ...accordion, props: { items: spec.faq.map((item, index) => ({ id: `item_faq${index + 1}`, ...item })) } },
		]));
	}
	if (spec.store) {
		const productGrid = createBuilderNode('ProductGrid', id('products'));
		nodes.push(container('products_section', { background: 'none', gap: 16, padding: 32 }, [
			{ ...productGrid, props: { ...productGrid.props, heading: 'محصولات تازه', binding: { provider: 'novex-commerce-products', version: 1, selection: 'latest', limit: 4 } } },
			button('shop_link', 'همهٔ محصولات', '/shop', { variant: 'outline' }),
		]));
	}
	nodes.push(container('cta', { background: 'brand', gap: 16, padding: 48 }, [
		heading('cta_title', spec.ctaTitle, { level: 2, size: 'lg', color: 'surface', align: 'center' }),
		text('cta_text', spec.ctaText, { color: 'surface', align: 'center' }),
		button('cta_button', spec.store ? 'رفتن به فروشگاه' : 'تماس با ما', spec.store ? '/shop' : '/contact', { align: 'center', variant: 'outline' }),
	]));
	nodes.push(container('footer', { background: 'none', gap: 8, padding: 24 }, [
		text('footer_text', `${spec.brand} · متن و تصویر این طرح را برای کسب‌وکار خود ویرایش کنید.`, { color: 'muted', size: 'sm', align: 'center' }),
	]));
	return {
		id: spec.id,
		label: spec.label,
		description: spec.description,
		kind: 'page',
		document: validatePageDocument({ ...createEmptyPageDocument(spec.id, spec.label), themeId: spec.theme, nodes }),
	};
}

export type VisualDesignCategory = LandingDesign['category'];

/** Lightweight metadata: listing cards must not construct or validate every document. */
export function visualStarterDesignSummaries() {
	return DESIGNS.map(({ id, label, description, theme, category, image }) => ({
		id, label, description, kind: 'page' as const, themeId: theme, category, image: `/media/${encodeURIComponent(image)}`,
	}));
}

export function visualStarterDesign(id: string): StarterTemplate | undefined {
	const spec = DESIGNS.find((design) => design.id === id);
	return spec ? buildDesign(spec) : undefined;
}

export function visualStarterDesigns(): StarterTemplate[] {
	return DESIGNS.map(buildDesign);
}
