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
	settings?: PluginSetting[];
}

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
	addAction(hook: string, callback: HookCallback, priority?: number): void;
	addFilter(hook: string, callback: FilterCallback, priority?: number): void;
	getOption<T = unknown>(key: string, fallback?: T): T;
	setOption(key: string, value: unknown): Promise<void>;
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
