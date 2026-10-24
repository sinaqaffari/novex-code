/**
 * قرارداد افزونه — معادل تایپ‌شدهٔ ساختار افزونه‌های WordPress.
 *
 * همان الگو، بدون PHP:
 *  - هر افزونه یک پوشه در `plugins/<id>/` دارد.
 *  - `plugin.json` نقش هدر افزونه را دارد (نام، نسخه، نویسنده، مجوز، وابستگی).
 *  - `index.ts` نقطهٔ ورود است و `register` را صادر می‌کند.
 *  - چرخهٔ عمر: `activate` و `deactivate` هنگام روشن/خاموش‌شدن از پنل.
 *  - ارتباط با هسته فقط از راه اکشن‌ها و فیلترها با اولویت مشخص است.
 */

/**
 * توانایی‌هایی که افزونه اعلام می‌کند — همان ایدهٔ `capabilities` در EmDash.
 *
 * هسته فقط همان چیزی را به افزونه می‌دهد که در `plugin.json` اعلام شده باشد؛
 * افزونه‌ای که `site:render` نداشته باشد نمی‌تواند به `site.head` گوش بدهد.
 * مزیتش این است که کاربر پیش از فعال‌سازی می‌داند افزونه به چه چیزی دسترسی
 * دارد، نه اینکه بعد از نصب بفهمد.
 */
export type PluginCapability =
	| 'site:render'
	| 'cms:widgets'
	| 'content:read'
	| 'options:read'
	| 'options:write'
	| 'admin:page';

/** فهرست کامل توانایی‌ها — برای اعتبارسنجی مانیفست و نمایش در پنل. */
export const PLUGIN_CAPABILITIES: readonly PluginCapability[] = [
	'site:render',
	'cms:widgets',
	'content:read',
	'options:read',
	'options:write',
	'admin:page',
];

/** توضیح کوتاه هر توانایی — در صفحهٔ افزونه‌ها نشان داده می‌شود. */
export const PLUGIN_CAPABILITY_LABELS: Record<PluginCapability, string> = {
	'site:render': 'افزودن تگ به head و پاورقی سایت',
	'cms:widgets': 'ساخت ویجت برای داشبورد',
	'content:read': 'خواندن نوشته‌ها',
	'options:read': 'خواندن تنظیمات خودش',
	'options:write': 'ذخیرهٔ تنظیمات خودش',
	'admin:page': 'داشتن صفحهٔ اختصاصی در پنل',
};

/** فیلدهای قابل تنظیم که در صفحهٔ افزونه‌ها رندر می‌شوند. */
export interface PluginSetting {
	key: string;
	label: string;
	/** نوع فیلد در فرم تنظیمات؛ `number` مقدار عددی ذخیره می‌کند. */
	type: 'text' | 'number' | 'switch';
	default?: string | boolean;
	help?: string;
	placeholder?: string;
	/** فقط برای `number`: بازهٔ مجاز و گام تغییر. */
	min?: number;
	max?: number;
	step?: number;
}

/**
 * هدر افزونه — معادل فیلدهای هدر WordPress:
 *
 *   Plugin Name / Plugin URI / Description / Version / Requires at least /
 *   Requires PHP / Requires Plugins / Author / Author URI / License /
 *   License URI / Text Domain / Tested up to
 *
 * فیلدهای بی‌معنی در این پروژه (Requires PHP، Domain Path، Update URI) حذف
 * شده‌اند؛ بقیه نگه داشته شده‌اند تا قرارداد برای هر کسی که افزونهٔ وردپرسی
 * نوشته است، آشنا باشد.
 */
export interface PluginManifest {
	name: string;
	version: string;
	description: string;
	/** Plugin URI */
	pluginUri?: string;
	author?: string;
	authorUri?: string;
	license?: string;
	licenseUri?: string;
	/** Text Domain — برای پیام‌های قابل ترجمه. */
	textDomain?: string;
	/** Requires at least — کمینهٔ نسخهٔ پنل. */
	requires?: string;
	/** Tested up to — نسخه‌ای که افزونه با آن آزموده شده است. */
	testedUpTo?: string;
	/** Requires Plugins — شناسهٔ افزونه‌های وابسته که باید فعال باشند. */
	requiresPlugins?: string[];
	/** برچسب‌ها، معادل Tags در readme.txt. */
	tags?: string[];
	/** فهرست قلاب‌هایی که افزونه به آن‌ها گوش می‌دهد — برای بازبینی. */
	hooks?: string[];
	/** توانایی‌های اعلام‌شده؛ هسته بر اساس همین‌ها API را محدود می‌کند. */
	capabilities?: PluginCapability[];
	/** صفحه‌های اختصاصی پنل — معادل `admin.pages` در مانیفست EmDash. */
	admin?: { pages?: PluginAdminPage[] };
	settings?: PluginSetting[];
}

/**
 * صفحهٔ اختصاصی افزونه در پنل.
 *
 * نشانی آن `/cms/plugins/<شناسهٔ افزونه>/<path>` است؛ یعنی صفحهٔ افزونه هرگز
 * جای صفحه‌های اصلی پنل را نمی‌گیرد — همان قاعده‌ای که EmDash هم دارد.
 */
export interface PluginAdminPage {
	/** بخش آخر نشانی، مثل `audit`. */
	path: string;
	title: string;
	description?: string;
}

/** نوشته‌ای که افزونهٔ دارای `content:read` می‌بیند. */
export interface PluginPost {
	id: string;
	slug: string;
	title: string;
	description: string;
	tags: string[];
	draft: boolean;
	pubDate: string;
	heroImage: string;
}

/** سازندهٔ HTML صفحهٔ افزونه؛ خروجی داخل پنل رندر می‌شود. */
export type PluginPageRenderer = (api: PluginApi) => string | Promise<string>;

/** بخش‌های readme.txt پس از تجزیه. */
export interface PluginReadme {
	/** سرصفحهٔ بخش ابتدایی: Contributors، Tags، Requires at least، … */
	header: Record<string, string>;
	/** بخش‌های نام‌دار: Description، Installation، FAQ، Changelog، … */
	sections: Array<{ title: string; body: string }>;
}

export type HookCallback = (...args: unknown[]) => unknown;
export type FilterCallback = (value: unknown, ...args: unknown[]) => unknown;

/** چیزی که هسته به افزونه می‌دهد. فقط همین — نه دسترسی مستقیم به فایل‌ها. */
export interface PluginApi {
	id: string;
	manifest: PluginManifest;
	/** توانایی‌های اعلام‌شده در مانیفست. */
	readonly capabilities: ReadonlySet<PluginCapability>;
	hasCapability(capability: PluginCapability): boolean;
	addAction(hook: string, callback: HookCallback, priority?: number): void;
	addFilter(hook: string, callback: FilterCallback, priority?: number): void;
	getOption<T = unknown>(key: string, fallback?: T): T;
	setOption(key: string, value: unknown): Promise<void>;
	/** فقط با توانایی `content:read`؛ نوشته‌های منتشرشده و پیش‌نویس‌ها. */
	getPosts(): Promise<PluginPost[]>;
}

/** ماژول هر افزونه. `register` الزامی است. */
export interface PluginModule {
	register(api: PluginApi): void | Promise<void>;
	/** معادل register_activation_hook */
	activate?(api: PluginApi): void | Promise<void>;
	/** معادل register_deactivation_hook */
	deactivate?(api: PluginApi): void | Promise<void>;
	/** معادل uninstall.php — هنگام حذف داده‌های افزونه اجرا می‌شود. */
	uninstall?(api: PluginApi): void | Promise<void>;
	/**
	 * صفحه‌های اختصاصی پنل، کلید‌شده با `path` اعلام‌شده در مانیفست.
	 * خروجی HTML است و داخل قالب پنل رندر می‌شود.
	 */
	pages?: Record<string, PluginPageRenderer>;
}

/** وضعیت هر افزونه در پنل. */
export interface InstalledPlugin {
	id: string;
	manifest: PluginManifest;
	active: boolean;
	error?: string;
	/** اگر readme.txt داشته باشد، محتوای تجزیه‌شده. */
	readme?: PluginReadme;
	/** وابستگی‌های فعال‌نشده — مانع فعال‌سازی. */
	missingDependencies?: string[];
}

/** ویجتی که افزونه می‌تواند به داشبورد اضافه کند. */
export interface DashboardWidget {
	id: string;
	title: string;
	html: string;
}
