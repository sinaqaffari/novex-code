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
	type: 'text' | 'switch';
	default?: string | boolean;
	help?: string;
	placeholder?: string;
}

/** هدر افزونه — همان اطلاعاتی که در فهرست افزونه‌ها دیده می‌شود. */
export interface PluginManifest {
	name: string;
	version: string;
	description: string;
	author?: string;
	authorUri?: string;
	pluginUri?: string;
	license?: string;
	/** کمینهٔ نسخهٔ پنل که افزونه با آن کار می‌کند. */
	requires?: string;
	/** فهرست قلاب‌هایی که افزونه به آن‌ها گوش می‌دهد — برای بازبینی. */
	hooks?: string[];
	settings?: PluginSetting[];
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
	activate?(api: PluginApi): void | Promise<void>;
	deactivate?(api: PluginApi): void | Promise<void>;
}

/** وضعیت هر افزونه در پنل. */
export interface InstalledPlugin {
	id: string;
	manifest: PluginManifest;
	active: boolean;
	error?: string;
}

/** ویجتی که افزونه می‌تواند به داشبورد اضافه کند. */
export interface DashboardWidget {
	id: string;
	title: string;
	html: string;
}
