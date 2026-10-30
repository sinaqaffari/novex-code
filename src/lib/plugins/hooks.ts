/**
 * قلاب‌ها — اکشن و فیلتر با اولویت، مثل `add_action` / `add_filter` در WordPress.
 *
 * اولویت کوچک‌تر زودتر اجرا می‌شود (پیش‌فرض ۱۰). در اولویت برابر، ترتیب ثبت
 * تعیین‌کننده است تا نتیجه تکرارپذیر بماند.
 */

import { PLUGIN_HOOKS, type PluginHook } from './types.ts';

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
	if (!Number.isInteger(priority) || priority < -10_000 || priority > 10_000) {
		throw new RangeError(`اولویت قلاب «${hook}» باید یک عدد صحیح بین ۱۰۰۰۰- و ۱۰۰۰۰ باشد.`);
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

/** Whether at least one loaded component handles a filter. */
export function hasFilter(hook: string): boolean {
	return (registry.get(hook)?.length ?? 0) > 0;
}

/** اجرای یک اکشن؛ مقدار بازگشتی ندارد. */
export async function doAction(hook: string, ...args: unknown[]): Promise<void> {
	const entries = registry.get(hook) ?? [];
	for (const entry of [...entries]) {
		try {
			await entry.callback(...args);
		} catch (error) {
			console.error(`[plugins] action ${hook} failed for ${entry.owner}`, error);
		}
	}
}

/** عبور یک مقدار از فیلترها؛ هر افزونه می‌تواند مقدار را تغییر دهد. */
export async function applyFilters<T>(hook: string, value: T, ...args: unknown[]): Promise<T> {
	const entries = registry.get(hook) ?? [];
	let current = value;
	for (const entry of [...entries]) {
		try {
			current = (await entry.callback(current, ...args)) as T;
		} catch (error) {
			console.error(`[plugins] filter ${hook} failed for ${entry.owner}`, error);
			const definition = PLUGIN_HOOKS[hook as PluginHook];
			if (definition?.failureMode === 'fail-closed') throw error;
		}
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

/**
 * Collect builder component declarations per hook owner rather than chaining
 * mutable arrays between plugins. This remains trusted in-process code, not a sandbox.
 */
export async function collectOwnedBuilderComponents(): Promise<{ contributions: Array<{ owner: string; value: unknown }>; rejected: number }> {
	const entries = registry.get('builder.components') ?? [];
	const contributions: Array<{ owner: string; value: unknown }> = [];
	let rejected = 0;
	for (const entry of [...entries]) {
		try {
			const result = await entry.callback(Object.freeze([]));
			if (!Array.isArray(result)) { rejected++; continue; }
			const take = Math.min(result.length, 50, Math.max(0, 500 - contributions.length));
			for (let index = 0; index < take; index++) contributions.push({ owner: entry.owner, value: result[index] });
			rejected += result.length - take;
		} catch (error) {
			rejected++;
			console.error(`[plugins] builder.components failed for ${entry.owner}`, error);
		}
	}
	return { contributions, rejected };
}
