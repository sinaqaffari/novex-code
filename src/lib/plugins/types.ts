/**
 * Novex extension contract — stable identity, a separately versioned host API,
 * declared capabilities, validated settings, and host-owned extension points.
 * Bundled plugin code is trusted Node code; this interface is not a sandbox.
 */

/**
 * Least-privilege capabilities for host APIs and extension points.
 * Every built-in hook below maps to one required capability.
 */
export type PluginCapability =
	| 'site:render'
	| 'cms:widgets'
	| 'content:read'
	| 'commerce:payments'
	| 'secrets:read'
	| 'options:read'
	| 'options:write'
	| 'admin:page';

/** The host-owned extension points available to plugins. Unknown hooks fail closed. */
export const PLUGIN_HOOKS = {
	'site.head': { kind: 'filter', capability: 'site:render', failureMode: 'isolate' },
	'site.footer': { kind: 'filter', capability: 'site:render', failureMode: 'isolate' },
	'cms.dashboard.widgets': { kind: 'filter', capability: 'cms:widgets', failureMode: 'isolate' },
	'shop.payment.initiate': { kind: 'filter', capability: 'commerce:payments', failureMode: 'fail-closed' },
	'shop.payment.verify': { kind: 'filter', capability: 'commerce:payments', failureMode: 'fail-closed' },
} as const satisfies Record<string, {
	kind: 'action' | 'filter';
	capability: PluginCapability;
	failureMode: 'isolate' | 'fail-closed';
}>;

export type PluginHook = keyof typeof PLUGIN_HOOKS;
export const SUPPORTED_PLUGIN_API_VERSION = 1;

/** فهرست کامل توانایی‌ها — برای اعتبارسنجی مانیفست و نمایش در پنل. */
export const PLUGIN_CAPABILITIES: readonly PluginCapability[] = [
	'site:render',
	'cms:widgets',
	'content:read',
	'commerce:payments',
	'secrets:read',
	'options:read',
	'options:write',
	'admin:page',
];

/** توضیح کوتاه هر توانایی — در صفحهٔ افزونه‌ها نشان داده می‌شود. */
export const PLUGIN_CAPABILITY_LABELS: Record<PluginCapability, string> = {
	'site:render': 'افزودن تگ به head و پاورقی سایت',
	'cms:widgets': 'ساخت ویجت برای داشبورد',
	'content:read': 'خواندن نوشته‌ها',
	'commerce:payments': 'ایجاد و تأیید درخواست‌های پرداخت',
	'secrets:read': 'خواندن رازهای محیطی که در مانیفست افزونه اعلام شده‌اند',
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
	default?: string | number | boolean;
	help?: string;
	placeholder?: string;
	/** فقط برای `number`: بازهٔ مجاز و گام تغییر. */
	min?: number;
	max?: number;
	step?: number;
	minLength?: number;
	maxLength?: number;
	required?: boolean;
	/** Read only from a plugin-scoped environment variable; never saved in plugin state. */
	secret?: boolean;
}

/** Validated manifest contract. `id` is stable; `apiVersion` versions the host interface. */
export interface PluginManifest {
	/** Stable package identity — must equal the plugin folder name. */
	id: string;
	/** Version of the host extension contract, independent of plugin version. */
	apiVersion: number;
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
	hooks?: PluginHook[];
	/** توانایی‌های اعلام‌شده؛ هسته بر اساس همین‌ها API را محدود می‌کند. */
	capabilities?: PluginCapability[];
	/** صفحه‌های اختصاصی پنل — معادل `admin.pages` در مانیفست EmDash. */
	admin?: { pages?: PluginAdminPage[] };
	settings?: PluginSetting[];
}

/** A plugin-owned page mounted below its stable plugin id; host routes remain reserved. */
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

/** Supported host API surface; bundled code is still trusted and not process-isolated. */
export interface PluginApi {
	id: string;
	manifest: Readonly<PluginManifest>;
	/** توانایی‌های اعلام‌شده در مانیفست. */
	readonly capabilities: ReadonlySet<PluginCapability>;
	hasCapability(capability: PluginCapability): boolean;
	addAction(hook: string, callback: HookCallback, priority?: number): void;
	addFilter(hook: string, callback: FilterCallback, priority?: number): void;
	getOption<T = unknown>(key: string, fallback?: T): T;
	setOption(key: string, value: unknown): Promise<void>;
	/** Secret settings are read from plugin-scoped environment variables, never stored here. */
	getSecret(key: string): string;
	hasSecret(key: string): boolean;
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
