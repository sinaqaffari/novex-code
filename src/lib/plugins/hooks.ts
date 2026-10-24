/**
 * قلاب‌ها — اکشن و فیلتر با اولویت، مثل `add_action` / `add_filter` در WordPress.
 *
 * اولویت کوچک‌تر زودتر اجرا می‌شود (پیش‌فرض ۱۰). در اولویت برابر، ترتیب ثبت
 * تعیین‌کننده است تا نتیجه تکرارپذیر بماند.
 */

export type HookCallback = (...args: unknown[]) => unknown;

interface HookEntry {
	callback: HookCallback;
	priority: number;
	order: number;
	owner: string;
}

const registry = new Map<string, HookEntry[]>();
let sequence = 0;

function register(hook: string, callback: HookCallback, priority: number, owner: string): void {
	if (typeof callback !== 'function') {
		throw new TypeError(`افزونه «${owner}» یک callback نامعتبر برای قلاب «${hook}» ثبت کرد.`);
	}
	const entries = registry.get(hook) ?? [];
	entries.push({ callback, priority, order: sequence++, owner });
	entries.sort((a, b) => a.priority - b.priority || a.order - b.order);
	registry.set(hook, entries);
}

export function addAction(hook: string, callback: HookCallback, priority = 10, owner = 'core'): void {
	register(hook, callback, priority, owner);
}

export function addFilter(hook: string, callback: HookCallback, priority = 10, owner = 'core'): void {
	register(hook, callback, priority, owner);
}

/** اجرای یک اکشن؛ مقدار بازگشتی ندارد. */
export async function doAction(hook: string, ...args: unknown[]): Promise<void> {
	const entries = registry.get(hook) ?? [];
	for (const entry of [...entries]) {
		await entry.callback(...args);
	}
}

/** عبور یک مقدار از فیلترها؛ هر افزونه می‌تواند مقدار را تغییر دهد. */
export async function applyFilters<T>(hook: string, value: T, ...args: unknown[]): Promise<T> {
	const entries = registry.get(hook) ?? [];
	let current = value;
	for (const entry of [...entries]) {
		current = (await entry.callback(current, ...args)) as T;
	}
	return current;
}

/** همهٔ قلاب‌های یک افزونه را برمی‌دارد (هنگام خاموش‌کردن). */
export function removePluginHooks(owner: string): void {
	for (const [hook, entries] of registry) {
		const remaining = entries.filter((entry) => entry.owner !== owner);
		if (remaining.length) registry.set(hook, remaining);
		else registry.delete(hook);
	}
}

/** برای صفحهٔ افزونه‌ها: قلاب‌های ثبت‌شده به تفکیک افزونه. */
export function listHooks(): Array<{ hook: string; owner: string; priority: number }> {
	return [...registry.entries()].flatMap(([hook, entries]) =>
		entries.map((entry) => ({ hook, owner: entry.owner, priority: entry.priority })),
	);
}
