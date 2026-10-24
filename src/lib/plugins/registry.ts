/**
 * دفترچهٔ افزونه‌ها — کشف، بارگذاری و چرخهٔ عمر.
 *
 * افزونه‌ها در زمان ساخت باندل می‌شوند (import.meta.glob)، پس روی خروجی
 * standalone هم بدون بارگذاری کد از دیسک کار می‌کنند. فعال/غیرفعال بودن با
 * data/plugins.json کنترل می‌شود، نه با حذف فایل.
 *
 * چرخهٔ عمر، معادل WordPress:
 *   register  ← هنگام فعال‌شدن و در هر راه‌اندازی برای افزونه‌های فعال
 *   activate  ← register_activation_hook
 *   deactivate← register_deactivation_hook
 *   uninstall ← uninstall.php (پاک‌سازی تنظیمات)
 */

import { addAction, addFilter, removePluginHooks } from './hooks';
import { parseReadme } from './readme';
import { readPluginState, setPluginOption, updatePluginState, type PluginState } from './store';
import type {
	InstalledPlugin,
	PluginApi,
	PluginManifest,
	PluginModule,
	PluginReadme,
	PluginSetting,
} from './types';

/** نسخهٔ پنل برای مقایسهٔ فیلد `requires` در هدر افزونه. */
export const PANEL_VERSION = '2.0.0';

const manifestModules = import.meta.glob('/plugins/*/plugin.json', { eager: true }) as Record<
	string,
	{ default?: PluginManifest }
>;
const codeModules = import.meta.glob('/plugins/*/index.ts', { eager: true }) as Record<
	string,
	PluginModule
>;
const readmeModules = import.meta.glob('/plugins/*/readme.txt', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

interface PluginEntry {
	id: string;
	manifest: PluginManifest;
	module: PluginModule;
	readme?: PluginReadme;
}

const errors = new Map<string, string>();
const registered = new Set<string>();
let cache: PluginState | null = null;
let booting: Promise<void> | null = null;

const FALLBACK_MANIFEST: PluginManifest = {
	name: 'افزونهٔ بدون هدر',
	version: '0.0.0',
	description: 'این افزونه فایل plugin.json معتبری ندارد.',
	license: 'MIT',
};

function folderId(file: string): string {
	return file.split('/')[2] ?? '';
}

function buildEntries(): PluginEntry[] {
	const entries: PluginEntry[] = [];

	for (const [file, module] of Object.entries(manifestModules)) {
		const id = folderId(file);
		const code = codeModules[`/plugins/${id}/index.ts`];
		if (!id || !code?.register) continue;

		const manifest = { ...FALLBACK_MANIFEST, ...(module.default ?? {}) };
		const rawReadme = readmeModules[`/plugins/${id}/readme.txt`];
		entries.push({
			id,
			manifest,
			module: code,
			readme: typeof rawReadme === 'string' ? parseReadme(rawReadme) : undefined,
		});
	}

	return entries.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'fa'));
}

function compareVersions(a: string, b: string): number {
	const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
	const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const diff = (left[index] ?? 0) - (right[index] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function settingDefault(settings: PluginSetting[] | undefined, key: string): unknown {
	return settings?.find((setting) => setting.key === key)?.default;
}

function createApi(entry: PluginEntry): PluginApi {
	const { id, manifest } = entry;

	return {
		id,
		manifest,
		addAction: (hook, callback, priority = 10) => addAction(hook, callback, priority, id),
		addFilter: (hook, callback, priority = 10) => addFilter(hook, callback, priority, id),
		getOption<T = unknown>(key: string, fallback?: T): T {
			const stored = cache?.options[id]?.[key];
			const value = stored === undefined ? settingDefault(manifest.settings, key) : stored;
			return (value === undefined ? fallback : value) as T;
		},
		async setOption(key, value) {
			cache = await setPluginOption(id, key, value);
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

	if (entry.manifest.requires && compareVersions(entry.manifest.requires, PANEL_VERSION) > 0) {
		const message = `این افزونه به پنل نسخهٔ ${entry.manifest.requires} یا بالاتر نیاز دارد.`;
		errors.set(entry.id, message);
		throw new Error(message);
	}

	const api = createApi(entry);
	try {
		await entry.module.register(api);
		if (runActivate) await entry.module.activate?.(api);
		registered.add(entry.id);
		errors.delete(entry.id);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'خطای نامشخص در بارگذاری افزونه.';
		errors.set(entry.id, message);
		removePluginHooks(entry.id);
		throw error;
	}
}

async function boot(): Promise<void> {
	cache = await readPluginState();
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
		error: errors.get(entry.id),
		readme: entry.readme,
		missingDependencies: missingDependencies(entry, active),
	}));
}

export async function activatePlugin(id: string): Promise<void> {
	const entry = buildEntries().find((item) => item.id === id);
	if (!entry) throw new Error('افزونهٔ مورد نظر پیدا نشد.');

	const active = cache?.active ?? [];
	const missing = missingDependencies(entry, active);
	if (missing.length) {
		const names = missing
			.map((dependency) => buildEntries().find((item) => item.id === dependency)?.manifest.name ?? dependency)
			.join('، ');
		throw new Error(`برای فعال‌سازی این افزونه، ابتدا «${names}» را فعال کنید.`);
	}

	cache = await updatePluginState((state) => {
		if (!state.active.includes(id)) state.active.push(id);
	});
	await registerPlugin(entry, true);
}

export async function deactivatePlugin(id: string): Promise<void> {
	const entry = buildEntries().find((item) => item.id === id);
	if (!entry) throw new Error('افزونهٔ مورد نظر پیدا نشد.');

	const api = createApi(entry);
	try {
		await entry.module.deactivate?.(api);
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
	const entry = buildEntries().find((item) => item.id === id);
	if (!entry) throw new Error('افزونهٔ مورد نظر پیدا نشد.');

	const active = cache?.active ?? [];
	if (active.includes(id)) await deactivatePlugin(id);

	const api = createApi(entry);
	await entry.module.uninstall?.(api);

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
	return cache?.options[id] ?? {};
}

/** ذخیرهٔ یک تنظیم و تازه‌سازی کش — تا افزونه مقدار تازه را همان لحظه ببیند. */
export async function savePluginOption(id: string, key: string, value: unknown): Promise<void> {
	cache = await setPluginOption(id, key, value);
}
