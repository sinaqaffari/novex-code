/** Runtime validation for extension manifests and admin-supplied settings. */

import {
	PLUGIN_CAPABILITIES,
	PLUGIN_HOOKS,
	SUPPORTED_PLUGIN_API_VERSION,
	type PluginCapability,
	type PluginHook,
	type PluginManifest,
	type PluginSetting,
} from './types.ts';

const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLUGIN_API_ROUTE_PATH = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SETTING_KEY = /^[a-z][a-zA-Z0-9_]{0,63}$/;
const KNOWN_CAPABILITIES = new Set<string>(PLUGIN_CAPABILITIES);
const KNOWN_HOOKS = new Set<string>(Object.keys(PLUGIN_HOOKS));

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUniqueStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string') && new Set(value).size === value.length;
}

export function isSemVer(value: unknown): value is string {
	return typeof value === 'string' && SEMVER.test(value);
}

export function isPluginApiRoutePath(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 120 && PLUGIN_API_ROUTE_PATH.test(value);
}

/** A true runtime read-only Set view; mutators and callback backdoors are blocked. */
export function readonlySetView<T>(values: Iterable<T>): ReadonlySet<T> {
	const backing = new Set(values);
	let view: ReadonlySet<T>;
	view = new Proxy(backing, {
		get(target, property) {
			if (property === 'add' || property === 'delete' || property === 'clear') {
				return () => {
					throw new TypeError('این فهرست توانایی‌ها فقط‌خواندنی است.');
				};
			}
			if (property === 'forEach') {
				return (callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown) =>
					target.forEach((value) => callback.call(thisArg, value, value, view));
			}
			const member = Reflect.get(target, property, target);
			return typeof member === 'function' ? member.bind(target) : member;
		},
	});
	return view;
}

function compareNumericText(left: string, right: string): number {
	const a = left.replace(/^0+(?=\d)/, '');
	const b = right.replace(/^0+(?=\d)/, '');
	if (a.length !== b.length) return a.length - b.length;
	return a < b ? -1 : a > b ? 1 : 0;
}

/** SemVer precedence for validated versions (build metadata is ignored). */
export function compareSemVer(left: string, right: string): number {
	const leftMatch = SEMVER.exec(left);
	const rightMatch = SEMVER.exec(right);
	if (!leftMatch || !rightMatch) throw new TypeError('نسخه باید از قالب معتبر SemVer پیروی کند.');

	for (let index = 1; index <= 3; index += 1) {
		const diff = compareNumericText(leftMatch[index]!, rightMatch[index]!);
		if (diff) return diff;
	}

	const leftPre = leftMatch[4]?.split('.') ?? [];
	const rightPre = rightMatch[4]?.split('.') ?? [];
	if (!leftPre.length || !rightPre.length) {
		if (leftPre.length === rightPre.length) return 0;
		return leftPre.length ? -1 : 1;
	}

	for (let index = 0; index < Math.max(leftPre.length, rightPre.length); index += 1) {
		const a = leftPre[index];
		const b = rightPre[index];
		if (a === undefined) return -1;
		if (b === undefined) return 1;
		if (a === b) continue;

		const aNumeric = /^\d+$/.test(a);
		const bNumeric = /^\d+$/.test(b);
		if (aNumeric && bNumeric) return compareNumericText(a, b);
		if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
		return a < b ? -1 : 1;
	}
	return 0;
}

function settingIssues(value: unknown, index: number): string[] {
	const prefix = `settings[${index}]`;
	if (!isRecord(value)) return [`${prefix} باید یک شیء باشد.`];
	const issues: string[] = [];

	if (typeof value.key !== 'string' || !SETTING_KEY.test(value.key)) {
		issues.push(`${prefix}.key باید شناسه‌ای کوتاه و امن باشد.`);
	}
	if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 120) {
		issues.push(`${prefix}.label باید متنی بین ۱ تا ۱۲۰ نویسه باشد.`);
	}
	if (!['text', 'number', 'switch'].includes(String(value.type))) {
		issues.push(`${prefix}.type باید text، number یا switch باشد.`);
	}
	for (const field of ['help', 'placeholder'] as const) {
		if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].length > 500)) {
			issues.push(`${prefix}.${field} باید متن کوتاه باشد.`);
		}
	}
	if (value.required !== undefined && typeof value.required !== 'boolean') {
		issues.push(`${prefix}.required باید boolean باشد.`);
	}
	if (value.secret !== undefined && typeof value.secret !== 'boolean') {
		issues.push(`${prefix}.secret باید boolean باشد.`);
	}
	if (value.public !== undefined && typeof value.public !== 'boolean') {
		issues.push(`${prefix}.public باید boolean باشد.`);
	}
	if (value.secret === true && value.type !== 'text') issues.push(`${prefix}.secret فقط برای تنظیم text معتبر است.`);
	if (value.secret === true && value.default !== undefined) issues.push(`${prefix}.secret نباید default داشته باشد.`);
	if (value.secret === true && value.public === true) issues.push(`${prefix}.secret نمی‌تواند public باشد.`);
	for (const field of ['minLength', 'maxLength'] as const) {
		if (value[field] !== undefined && (!Number.isInteger(value[field]) || Number(value[field]) < 0)) {
			issues.push(`${prefix}.${field} باید عدد صحیح نامنفی باشد.`);
		}
	}
	if (value.minLength !== undefined && value.maxLength !== undefined && Number(value.minLength) > Number(value.maxLength)) {
		issues.push(`${prefix}.minLength نمی‌تواند از maxLength بیشتر باشد.`);
	}

	if (value.type === 'number') {
		for (const field of ['min', 'max', 'step'] as const) {
			if (value[field] !== undefined && (typeof value[field] !== 'number' || !Number.isFinite(value[field]))) {
				issues.push(`${prefix}.${field} باید عدد متناهی باشد.`);
			}
		}
		if (typeof value.step === 'number' && value.step <= 0) issues.push(`${prefix}.step باید بزرگ‌تر از صفر باشد.`);
		if (typeof value.min === 'number' && typeof value.max === 'number' && value.min > value.max) {
			issues.push(`${prefix}.min نمی‌تواند از max بیشتر باشد.`);
		}
	} else if (value.min !== undefined || value.max !== undefined || value.step !== undefined) {
		issues.push(`${prefix}.min، max و step فقط برای تنظیم number معتبر هستند.`);
	}

	if (value.default !== undefined) {
		const typeValid = value.type === 'switch'
			? typeof value.default === 'boolean'
			: value.type === 'number'
				? typeof value.default === 'number' || typeof value.default === 'string'
				: value.type === 'text' && typeof value.default === 'string';
		if (!typeValid) issues.push(`${prefix}.default با نوع تنظیم سازگار نیست.`);
		else {
			try {
				parsePluginSettingValue(value as unknown as PluginSetting, value.default);
			} catch (error) {
				issues.push(`${prefix}.default نامعتبر است: ${error instanceof Error ? error.message : 'مقدار نامعتبر'}`);
			}
		}
	}

	return issues;
}

/** Returns actionable validation issues; an empty array means the manifest is valid. */
export function validatePluginManifest(raw: unknown, expectedId: string): string[] {
	if (!isRecord(raw)) return ['plugin.json باید یک شیء JSON باشد.'];
	const issues: string[] = [];

	if (!PLUGIN_ID.test(expectedId)) issues.push('شناسهٔ پوشهٔ افزونه معتبر نیست.');
	if (raw.id !== expectedId) issues.push('فیلد id در مانیفست باید با نام پوشهٔ افزونه یکسان باشد.');
	if (raw.apiVersion !== SUPPORTED_PLUGIN_API_VERSION) {
		issues.push(`apiVersion باید ${SUPPORTED_PLUGIN_API_VERSION} باشد؛ نسخهٔ اعلام‌شده پشتیبانی نمی‌شود.`);
	}
	if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 120) {
		issues.push('name باید متنی بین ۱ تا ۱۲۰ نویسه باشد.');
	}
	if (!isSemVer(raw.version)) issues.push('version باید یک نسخهٔ معتبر SemVer باشد.');
	if (typeof raw.description !== 'string' || !raw.description.trim() || raw.description.length > 1000) {
		issues.push('description باید متنی بین ۱ تا ۱۰۰۰ نویسه باشد.');
	}
	for (const field of ['requires', 'testedUpTo'] as const) {
		if (raw[field] !== undefined && !isSemVer(raw[field])) issues.push(`${field} باید یک نسخهٔ معتبر SemVer باشد.`);
	}
	for (const field of ['pluginUri', 'author', 'authorUri', 'license', 'licenseUri', 'textDomain'] as const) {
		if (raw[field] !== undefined && (typeof raw[field] !== 'string' || raw[field].length > 500)) {
			issues.push(`${field} باید متن کوتاه باشد.`);
		}
	}

	const capabilities = raw.capabilities ?? [];
	if (!isUniqueStringArray(capabilities)) issues.push('capabilities باید فهرستی از شناسه‌های یکتا باشد.');
	else {
		for (const capability of capabilities) {
			if (!KNOWN_CAPABILITIES.has(capability)) issues.push(`توانایی ناشناخته: ${capability}.`);
		}
	}

	const hooks = raw.hooks ?? [];
	if (!isUniqueStringArray(hooks)) issues.push('hooks باید فهرستی از نام‌های یکتا باشد.');
	else {
		for (const hook of hooks) {
			if (!KNOWN_HOOKS.has(hook)) {
				issues.push(`قلاب ناشناخته یا پشتیبانی‌نشده: ${hook}.`);
				continue;
			}
			const required = PLUGIN_HOOKS[hook as PluginHook].capability;
			if (!Array.isArray(capabilities) || !capabilities.includes(required)) {
				issues.push(`قلاب ${hook} به توانایی ${required} نیاز دارد.`);
			}
		}
	}

	const dependencies = raw.requiresPlugins ?? [];
	if (!isUniqueStringArray(dependencies)) issues.push('requiresPlugins باید فهرستی از شناسه‌های یکتا باشد.');
	else {
		for (const dependency of dependencies) {
			if (!PLUGIN_ID.test(dependency)) issues.push(`شناسهٔ وابستگی نامعتبر است: ${dependency}.`);
			if (dependency === expectedId) issues.push('افزونه نمی‌تواند به خودش وابسته باشد.');
		}
	}

	if (raw.tags !== undefined && (!isUniqueStringArray(raw.tags) || raw.tags.some((tag) => !tag.trim() || tag.length > 40))) {
		issues.push('tags باید فهرستی از برچسب‌های کوتاه و یکتا باشد.');
	}

	if (raw.admin !== undefined) {
		if (!isRecord(raw.admin)) issues.push('admin باید یک شیء باشد.');
		else {
			const pages = raw.admin.pages ?? [];
			if (!Array.isArray(pages)) issues.push('admin.pages باید یک فهرست باشد.');
			else {
				const paths = new Set<string>();
				for (const [index, page] of pages.entries()) {
					if (!isRecord(page)) {
						issues.push(`admin.pages[${index}] باید یک شیء باشد.`);
						continue;
					}
					if (typeof page.path !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.path)) {
						issues.push(`admin.pages[${index}].path معتبر نیست.`);
					} else if (paths.has(page.path)) issues.push(`مسیر صفحهٔ تکراری است: ${page.path}.`);
					else paths.add(page.path);
					if (typeof page.title !== 'string' || !page.title.trim() || page.title.length > 120) {
						issues.push(`admin.pages[${index}].title معتبر نیست.`);
					}
					if (page.description !== undefined && (typeof page.description !== 'string' || page.description.length > 500)) {
						issues.push(`admin.pages[${index}].description باید متن کوتاه باشد.`);
					}
				}
			}
			if (Array.isArray(pages) && pages.length && (!Array.isArray(capabilities) || !capabilities.includes('admin:page'))) {
				issues.push('افزونه‌ای که صفحهٔ پنل دارد باید توانایی admin:page را اعلام کند.');
			}
		}
	}

	if (raw.routes !== undefined) {
		if (!Array.isArray(raw.routes)) issues.push('routes باید یک فهرست باشد.');
		else {
			if (raw.routes.length > 50) issues.push('حداکثر ۵۰ API route برای هر افزونه مجاز است.');
			const paths = new Set<string>();
			let hasPublicRoute = false;
			let hasCmsRoute = false;
			for (const [index, route] of raw.routes.entries()) {
				if (!isRecord(route)) {
					issues.push(`routes[${index}] باید یک شیء باشد.`);
					continue;
				}
				if (!isPluginApiRoutePath(route.path)) {
					issues.push(`routes[${index}].path باید مسیر نسبی کوتاه و امن باشد.`);
				} else if (paths.has(route.path)) {
					issues.push(`مسیر API تکراری است: ${route.path}.`);
				} else {
					paths.add(route.path);
				}

				const access = route.access;
				if (access !== 'public' && access !== 'cms') {
					issues.push(`routes[${index}].access باید public یا cms باشد.`);
				} else if (access === 'public') hasPublicRoute = true;
				else hasCmsRoute = true;

				const methods = route.methods;
				if (!isUniqueStringArray(methods) || methods.length === 0) {
					issues.push(`routes[${index}].methods باید فهرستی غیرخالی از روش‌های یکتا باشد.`);
				} else {
					for (const method of methods) {
						if (method !== 'GET' && method !== 'POST') {
							issues.push(`روش ${method} در routes[${index}] پشتیبانی نمی‌شود.`);
					}
					if (access === 'public' && method !== 'GET') {
						issues.push('API عمومی فقط می‌تواند روش GET را اعلام کند.');
					}
				}
				}
			}
			if (hasPublicRoute && (!Array.isArray(capabilities) || !capabilities.includes('api:public'))) {
				issues.push('API عمومی به توانایی api:public نیاز دارد.');
			}
			if (hasCmsRoute && (!Array.isArray(capabilities) || !capabilities.includes('api:cms'))) {
				issues.push('API پنل به توانایی api:cms نیاز دارد.');
			}
		}
	}

	if (raw.settings !== undefined) {
		if (!Array.isArray(raw.settings)) issues.push('settings باید یک فهرست باشد.');
		else {
			const keys = new Set<string>();
			for (const [index, setting] of raw.settings.entries()) {
				issues.push(...settingIssues(setting, index));
				if (isRecord(setting) && typeof setting.key === 'string') {
					if (keys.has(setting.key)) issues.push(`کلید تنظیم تکراری است: ${setting.key}.`);
					keys.add(setting.key);
				}
			}
		}
	}
	const usesSecrets = Array.isArray(raw.settings) && raw.settings.some((setting) => isRecord(setting) && setting.secret === true);
	if (usesSecrets && (!Array.isArray(capabilities) || !capabilities.includes('secrets:read'))) {
		issues.push('افزونه‌ای که تنظیم secret دارد باید توانایی secrets:read را اعلام کند.');
	}

	return [...new Set(issues)];
}

/** Parse and enforce a setting's runtime schema before persistence. */
export function parsePluginSettingValue(setting: PluginSetting, raw: unknown): string | number | boolean {
	if (setting.type === 'switch') {
		if (raw === true || raw === 'true' || raw === 'on' || raw === '1') return true;
		if (raw === false || raw === 'false' || raw === 'off' || raw === '0') return false;
		throw new Error(`مقدار «${setting.label}» باید روشن یا خاموش باشد.`);
	}

	if (setting.type === 'number') {
		if ((typeof raw !== 'number' && typeof raw !== 'string') || (typeof raw === 'string' && !raw.trim())) {
			throw new Error(`مقدار «${setting.label}» باید عدد باشد.`);
		}
		const value = typeof raw === 'number' ? raw : Number(raw.trim());
		if (!Number.isFinite(value)) throw new Error(`مقدار «${setting.label}» باید عدد متناهی باشد.`);
		if (setting.min !== undefined && value < setting.min) throw new Error(`مقدار «${setting.label}» کمتر از حداقل مجاز است.`);
		if (setting.max !== undefined && value > setting.max) throw new Error(`مقدار «${setting.label}» بیشتر از حداکثر مجاز است.`);
		const step = setting.step ?? 1;
		const base = setting.min ?? 0;
		if (Math.abs((value - base) / step - Math.round((value - base) / step)) > 1e-8) {
			throw new Error(`مقدار «${setting.label}» با گام مجاز سازگار نیست.`);
		}
		return value;
	}

	if (typeof raw !== 'string') throw new Error(`مقدار «${setting.label}» باید متن باشد.`);
	const value = raw.trim();
	const maxLength = setting.maxLength ?? 2048;
	if (setting.required && !value) throw new Error(`مقدار «${setting.label}» الزامی است.`);
	if (value.length < (setting.minLength ?? 0)) throw new Error(`مقدار «${setting.label}» کوتاه‌تر از حداقل مجاز است.`);
	if (value.length > maxLength) throw new Error(`مقدار «${setting.label}» بیش از حد بلند است.`);
	return value;
}

/** Validate that a plugin only registers a host-defined, declared hook of the right kind. */
export function validateHookRegistration(
	manifest: PluginManifest,
	hook: string,
	kind: 'action' | 'filter',
): PluginCapability {
	if (!KNOWN_HOOKS.has(hook)) throw new Error(`قلاب «${hook}» در قرارداد افزونه تعریف نشده است.`);
	if (!manifest.hooks?.includes(hook as PluginHook)) throw new Error(`قلاب «${hook}» در plugin.json اعلام نشده است.`);
	const definition = PLUGIN_HOOKS[hook as PluginHook];
	if (definition.kind !== kind) throw new Error(`قلاب «${hook}» فقط از نوع ${definition.kind} است.`);
	if (!manifest.capabilities?.includes(definition.capability)) {
		throw new Error(`قلاب «${hook}» به توانایی «${definition.capability}» نیاز دارد.`);
	}
	return definition.capability;
}
