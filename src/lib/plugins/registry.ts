/**
 * دفترچهٔ افزونه‌ها — کشف، بارگذاری و چرخهٔ عمر.
 *
 * کد افزونه‌ها در زمان ساخت باندل می‌شود، اما ماژول هر افزونه فقط هنگام
 * فعال‌سازی یا اجرای lifecycle/page بارگذاری می‌شود؛ شروع پنل، کد افزونهٔ
 * غیرفعال را ارزیابی نمی‌کند. در خروجی standalone هم نیازی به خواندن کد از دیسک
 * نیست. فعال/غیرفعال بودن با data/plugins.json کنترل می‌شود، نه با حذف فایل.
 *
 * The host lifecycle runs registration/activation before persisting active state,
 * and removes owned hooks on deactivation or uninstall. Imported modules remain
 * cached by Node after deactivation; lazy loading is not a security sandbox.
 */

import { addAction, addFilter, removePluginHooks } from './hooks';
import { createLazyModuleCache } from './lazy-module';
import { parseReadme } from './readme';
import { hasPluginSecret, readPluginSecret } from './secrets';
import { readPluginState, setPluginOption, setPluginOptions, updatePluginState, type PluginState } from './store';
import {
	SUPPORTED_PLUGIN_API_VERSION,
	type InstalledPlugin,
	type PluginAdminPage,
	type PluginApi,
	type PluginCapability,
	type PluginManifest,
	type PluginModule,
	type PluginPageRenderer,
	type PluginReadme,
} from './types';
import { compareSemVer, parsePluginSettingValue, readonlySetView, validateHookRegistration, validatePluginManifest } from './validation';

/** نسخهٔ پنل برای مقایسهٔ فیلد `requires` در هدر افزونه. */
export const PANEL_VERSION = '2.0.0';

const manifestModules = import.meta.glob('/plugins/*/plugin.json', { eager: true }) as Record<
	string,
	{ default?: PluginManifest }
>;
const codeModules = import.meta.glob('/plugins/*/index.ts') as Record<
	string,
	() => Promise<PluginModule>
>;
const readmeModules = import.meta.glob('/plugins/*/readme.txt', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

interface PluginEntry {
	id: string;
	manifest: PluginManifest;
	loadModule: () => Promise<PluginModule>;
	readme?: PluginReadme;
	validationError?: string;
}

const errors = new Map<string, string>();
const pluginModules = createLazyModuleCache<PluginModule>();
const registered = new Set<string>();
let cache: PluginState | null = null;
let stateError: string | undefined;
let booting: Promise<void> | null = null;

const FALLBACK_MANIFEST = {
	apiVersion: SUPPORTED_PLUGIN_API_VERSION,
	name: 'افزونهٔ دارای مانیفست نامعتبر',
	version: '0.0.0',
	description: 'قرارداد افزونه معتبر نیست و افزونه قابل فعال‌سازی نیست.',
	license: 'MIT',
	hooks: [],
	capabilities: [],
	settings: [],
} satisfies Omit<PluginManifest, 'id'>;

function folderId(file: string): string {
	return file.split('/')[2] ?? '';
}

function buildEntries(): PluginEntry[] {
	const entries: PluginEntry[] = [];

	for (const [file, module] of Object.entries(manifestModules)) {
		const id = folderId(file);
		const loadModule = codeModules[`/plugins/${id}/index.ts`];
		if (!id || !loadModule) continue;

		const rawManifest = module.default;
		const issues = validatePluginManifest(rawManifest, id);
		const validationError = issues.length ? issues.join(' ') : undefined;
		const manifest: PluginManifest = validationError
			? { id, ...FALLBACK_MANIFEST }
			: (rawManifest as PluginManifest);
		const rawReadme = readmeModules[`/plugins/${id}/readme.txt`];
		entries.push({
			id,
			manifest,
			loadModule,
			readme: typeof rawReadme === 'string' ? parseReadme(rawReadme) : undefined,
			validationError,
		});
	}

	return entries.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'fa'));
}

function loadPluginModule(entry: PluginEntry): Promise<PluginModule> {
	return pluginModules.load(entry.id, async () => {
		const module = await entry.loadModule();
		if (!module || typeof module.register !== 'function') {
			throw new Error(`افزونهٔ «${entry.manifest.name}» تابع register معتبر ندارد.`);
		}
		return module;
	});
}

function deepFreeze<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
	return Object.freeze(value);
}

function createApi(entry: PluginEntry): PluginApi {
	const { id, manifest } = entry;
	const capabilities = new Set<PluginCapability>(manifest.capabilities ?? []);
	const publicManifest = deepFreeze(structuredClone(manifest)) as Readonly<PluginManifest>;
	const publicCapabilities = readonlySetView(capabilities);

	/** هر دسترسی، اول توانایی‌اش را می‌خواهد؛ پیام خطا هم روشن است. */
	const authorize = (capability: PluginCapability, action: string) => {
		if (capabilities.has(capability)) return;
		throw new Error(
			`افزونه «${manifest.name}» برای ${action} باید توانایی «${capability}» را در plugin.json اعلام کند.`,
		);
	};

	const authorizeHook = (hook: string, kind: 'action' | 'filter') => {
		const required = validateHookRegistration(manifest, hook, kind);
		authorize(required, `گوش‌دادن به قلاب ${hook}`);
	};

	const getSetting = (key: string) => {
		const setting = manifest.settings?.find((candidate) => candidate.key === key);
		if (!setting) throw new Error(`تنظیم «${key}» در مانیفست افزونه اعلام نشده است.`);
		return setting;
	};

	return {
		id,
		manifest: publicManifest,
		capabilities: publicCapabilities,
		hasCapability: (capability) => capabilities.has(capability),
		addAction: (hook, callback, priority = 10) => {
			authorizeHook(hook, 'action');
			addAction(hook, callback, priority, id);
		},
		addFilter: (hook, callback, priority = 10) => {
			authorizeHook(hook, 'filter');
			addFilter(hook, callback, priority, id);
		},
		getOption<T = unknown>(key: string, fallback?: T): T {
			authorize('options:read', 'خواندن تنظیمات');
			const setting = getSetting(key);
			if (setting.secret) throw new Error(`راز «${key}» باید با api.getSecret() خوانده شود.`);
			const stored = cache?.options[id]?.[key];
			const value = stored !== undefined ? stored : setting.default !== undefined ? setting.default : fallback;
			return (value === undefined ? undefined : parsePluginSettingValue(setting, value)) as T;
		},
		async setOption(key, value) {
			authorize('options:write', 'ذخیرهٔ تنظیمات');
			assertPluginStateHealthy();
			const setting = getSetting(key);
			if (setting.secret) throw new Error(`راز «${key}» فقط از محیط استقرار تأمین می‌شود.`);
			cache = await setPluginOption(id, key, parsePluginSettingValue(setting, value));
		},
		getSecret(key) {
			authorize('secrets:read', 'خواندن راز محیطی');
			const setting = getSetting(key);
			if (!setting.secret) throw new Error(`تنظیم «${key}» در مانیفست به‌عنوان secret اعلام نشده است.`);
			return readPluginSecret(id, key);
		},
		hasSecret(key) {
			authorize('secrets:read', 'بررسی وجود راز محیطی');
			const setting = getSetting(key);
			if (!setting.secret) throw new Error(`تنظیم «${key}» در مانیفست به‌عنوان secret اعلام نشده است.`);
			return hasPluginSecret(id, key);
		},
		async getPosts() {
			authorize('content:read', 'خواندن نوشته‌ها');
			const { listPosts } = await import('../cms/posts');
			return listPosts();
		},
	};
}

/** وابستگی‌های فعال‌نشده را برمی‌گرداند؛ خالی یعنی مشکلی نیست. */
function missingDependencies(entry: PluginEntry, active: string[]): string[] {
	return (entry.manifest.requiresPlugins ?? []).filter(
		(dependency) => dependency !== entry.id && !active.includes(dependency),
	);
}

async function registerPlugin(entry: PluginEntry, runActivate: boolean): Promise<void> {
	if (registered.has(entry.id)) return;
	if (entry.validationError) throw new Error(entry.validationError);

	if (entry.manifest.requires && compareSemVer(entry.manifest.requires, PANEL_VERSION) > 0) {
		const message = `این افزونه به پنل نسخهٔ ${entry.manifest.requires} یا بالاتر نیاز دارد.`;
		errors.set(entry.id, message);
		throw new Error(message);
	}

	const api = createApi(entry);
	let module: PluginModule | undefined;
	let activationStarted = false;
	try {
		module = await loadPluginModule(entry);
		const declaredPages = entry.manifest.admin?.pages ?? [];
		for (const page of declaredPages) {
			if (module.pages?.[page.path]) continue;
			throw new Error(`صفحهٔ «${page.title}» در مانیفست اعلام شده اما سازندهٔ آن در index.ts نیست.`);
		}

		await module.register(api);
		if (runActivate && module.activate) {
			activationStarted = true;
			await module.activate(api);
		}
		registered.add(entry.id);
		errors.delete(entry.id);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'خطای نامشخص در بارگذاری افزونه.';
		errors.set(entry.id, message);
		if (activationStarted && module) {
			try {
				await module.deactivate?.(api);
			} catch (rollbackError) {
				console.error(`[plugins] rollback ${entry.id} failed`, rollbackError);
			}
		}
		removePluginHooks(entry.id);
		registered.delete(entry.id);
		throw new Error(message, { cause: error });
	}
}

function assertPluginStateHealthy(): void {
	if (stateError) throw new Error(`وضعیت افزونه‌ها نامعتبر است و در حالت فقط‌خواندنی قرار دارد: ${stateError}`);
}

async function boot(): Promise<void> {
	try {
		cache = await readPluginState();
		stateError = undefined;
	} catch (error) {
		cache = { version: 1, active: [], options: {} };
		stateError = error instanceof Error ? error.message : 'خواندن وضعیت افزونه‌ها ممکن نشد.';
		console.error('[plugins] state is invalid; plugins remain disabled and the file is preserved.', error);
		return;
	}
	for (const entry of buildEntries()) {
		if (!cache.active.includes(entry.id)) continue;
		try {
			await registerPlugin(entry, true);
		} catch {
			// خطای هر افزونه جدا نگه داشته می‌شود تا بقیهٔ پنل از کار نیفتد.
		}
	}
}

/** یک بار در طول عمر پروسه اجرا می‌شود؛ از middleware صدا زده می‌شود. */
export function ensurePluginsBooted(): Promise<void> {
	booting ??= boot();
	return booting;
}

export function listInstalledPlugins(): InstalledPlugin[] {
	const active = cache?.active ?? [];
	const activeIds = new Set(active);

	return buildEntries().map((entry) => ({
		id: entry.id,
		manifest: entry.manifest,
		active: activeIds.has(entry.id),
		error: stateError ?? entry.validationError ?? errors.get(entry.id),
		readme: entry.readme,
		missingDependencies: missingDependencies(entry, active),
	}));
}

export async function activatePlugin(id: string): Promise<void> {
	await ensurePluginsBooted();
	assertPluginStateHealthy();
	const entry = buildEntries().find((item) => item.id === id);
	if (!entry) throw new Error('افزونهٔ مورد نظر پیدا نشد.');
	if (entry.validationError) throw new Error(entry.validationError);

	const active = cache?.active ?? [];
	if (active.includes(id) && registered.has(id)) return;
	const missing = missingDependencies(entry, active);
	if (missing.length) {
		const names = missing
			.map((dependency) => buildEntries().find((item) => item.id === dependency)?.manifest.name ?? dependency)
			.join('، ');
		throw new Error(`برای فعال‌سازی این افزونه، ابتدا «${names}» را فعال کنید.`);
	}

	await registerPlugin(entry, true);
	try {
		cache = await updatePluginState((state) => {
			if (!state.active.includes(id)) state.active.push(id);
		});
	} catch (error) {
		try {
			await pluginModules.get(id)?.deactivate?.(createApi(entry));
		} catch (rollbackError) {
			console.error(`[plugins] activation persistence rollback ${id} failed`, rollbackError);
		}
		removePluginHooks(id);
		registered.delete(id);
		throw error;
	}
}

function activeDependents(pluginId: string): PluginEntry[] {
	const active = new Set(cache?.active ?? []);
	return buildEntries().filter(
		(entry) => active.has(entry.id) && entry.manifest.requiresPlugins?.includes(pluginId),
	);
}

export async function deactivatePlugin(id: string): Promise<void> {
	await ensurePluginsBooted();
	assertPluginStateHealthy();
	const entry = buildEntries().find((item) => item.id === id);
	if (!entry) throw new Error('افزونهٔ مورد نظر پیدا نشد.');

	const dependents = activeDependents(id);
	if (dependents.length) {
		throw new Error(`ابتدا افزونه‌های وابسته را غیرفعال کنید: ${dependents.map((item) => item.manifest.name).join('، ')}.`);
	}

	const wasActive = (cache?.active ?? []).includes(id);
	const api = createApi(entry);
	try {
		if (wasActive || registered.has(id)) {
			const module = await loadPluginModule(entry);
			await module.deactivate?.(api);
		}
	} finally {
		removePluginHooks(id);
		registered.delete(id);
		cache = await updatePluginState((state) => {
			state.active = state.active.filter((item) => item !== id);
		});
	}
}

/**
 * حذف داده‌های افزونه — معادل uninstall.php.
 *
 * فایل‌های افزونه داخل مخزن‌اند و در زمان اجرا حذف نمی‌شوند؛ پس این عملیات
 * افزونه را غیرفعال، قلاب‌هایش را برمی‌دارد و همهٔ تنظیماتش را پاک می‌کند.
 */
export async function uninstallPlugin(id: string): Promise<void> {
	await ensurePluginsBooted();
	assertPluginStateHealthy();
	const entry = buildEntries().find((item) => item.id === id);
	if (!entry) throw new Error('افزونهٔ مورد نظر پیدا نشد.');

	const dependents = activeDependents(id);
	if (dependents.length) {
		throw new Error(`ابتدا افزونه‌های وابسته را غیرفعال کنید: ${dependents.map((item) => item.manifest.name).join('، ')}.`);
	}

	const active = cache?.active ?? [];
	if (active.includes(id)) await deactivatePlugin(id);

	const api = createApi(entry);
	const module = await loadPluginModule(entry);
	await module.uninstall?.(api);

	cache = await updatePluginState((state) => {
		state.active = state.active.filter((item) => item !== id);
		const options = { ...state.options };
		delete options[id];
		state.options = options;
	});
	errors.delete(id);
}

export function findPlugin(id: string): InstalledPlugin | undefined {
	return listInstalledPlugins().find((plugin) => plugin.id === id);
}

export function pluginOptions(id: string): Record<string, unknown> {
	return structuredClone(cache?.options[id] ?? {});
}

/** ذخیرهٔ گروهی تنظیمات — اعتبارسنجی پیش از فراخوانی انجام می‌شود و یک نوشتن اتمیک دارد. */
export async function savePluginOptions(id: string, values: Record<string, unknown>): Promise<void> {
	assertPluginStateHealthy();
	const entry = buildEntries().find((plugin) => plugin.id === id);
	if (!entry || entry.validationError) throw new Error('مانیفست افزونه برای ذخیرهٔ تنظیمات معتبر نیست.');
	const safeValues: Record<string, unknown> = {};
	for (const [key, rawValue] of Object.entries(values)) {
		const setting = entry.manifest.settings?.find((candidate) => candidate.key === key);
		if (!setting) throw new Error(`تنظیم «${key}» در مانیفست افزونه اعلام نشده است.`);
		if (setting.secret) throw new Error(`راز «${key}» باید از متغیر محیطی تأمین شود و در فایل تنظیمات ذخیره نمی‌شود.`);
		safeValues[key] = parsePluginSettingValue(setting, rawValue);
	}
	if (Object.keys(safeValues).length) cache = await setPluginOptions(id, safeValues);
}

/** صفحه‌های اعلام‌شدهٔ افزونه‌های فعال — برای ناوبری پنل. */
export interface PluginPageEntry {
	pluginId: string;
	pluginName: string;
	page: PluginAdminPage;
}

export function listPluginPages(): PluginPageEntry[] {
	const active = new Set(cache?.active ?? []);

	return buildEntries()
		.filter((entry) => active.has(entry.id) && !entry.validationError)
		.flatMap((entry) => {
			const module = pluginModules.get(entry.id);
			return (entry.manifest.admin?.pages ?? [])
				.filter((page) => typeof module?.pages?.[page.path] === 'function')
				.map((page) => ({ pluginId: entry.id, pluginName: entry.manifest.name, page }));
		});
}

/**
 * رندر صفحهٔ اختصاصی یک افزونهٔ فعال.
 *
 * فقط صفحه‌هایی که هم در مانیفست اعلام شده‌اند و هم سازنده دارند اجرا می‌شوند؛
 * در غیر این صورت `null` برمی‌گردد تا مسیر Astro به ۴۰۴ برود.
 */
export async function renderPluginPage(
	pluginId: string,
	path: string,
): Promise<{ manifest: PluginManifest; page: PluginAdminPage; html: string } | null> {
	const entry = buildEntries().find((item) => item.id === pluginId);
	if (!entry || entry.validationError) return null;
	if (!(cache?.active ?? []).includes(pluginId)) return null;

	const page = (entry.manifest.admin?.pages ?? []).find((item) => item.path === path);
	if (!page) return null;

	const module = await loadPluginModule(entry);
	const renderer: PluginPageRenderer | undefined = module.pages?.[page.path];
	if (!renderer) return null;

	const html = await renderer(createApi(entry));
	return { manifest: entry.manifest, page, html };
}
