/**
 * Plugin state — active package ids and per-plugin settings.
 * Writes are atomic and serialized within this process. Corrupt data fails closed.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.resolve(process.env.PLUGIN_STATE_FILE ?? path.join(DATA_DIR, 'plugins.json'));
const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPTION_KEY = /^[a-z][a-zA-Z0-9_]{0,63}$/;

export interface PluginState {
	version: number;
	active: string[];
	options: Record<string, Record<string, unknown>>;
}

const EMPTY: PluginState = { version: 1, active: [], options: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown): boolean {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (!isRecord(value)) return false;
	return Object.entries(value).every(([key, item]) =>
		!['__proto__', 'prototype', 'constructor'].includes(key) && isJsonValue(item),
	);
}

/** Validate without repairing so an update cannot silently overwrite user data. */
export function validatePluginState(raw: unknown): PluginState {
	if (!isRecord(raw)) throw new Error('فایل وضعیت افزونه‌ها باید یک شیء JSON باشد.');
	if (raw.version !== 1) throw new Error('نسخهٔ فایل وضعیت افزونه‌ها پشتیبانی نمی‌شود.');
	if (!Array.isArray(raw.active) || !raw.active.every((id) => typeof id === 'string' && PLUGIN_ID.test(id))) {
		throw new Error('فهرست افزونه‌های فعال نامعتبر است.');
	}
	if (new Set(raw.active).size !== raw.active.length) throw new Error('شناسهٔ افزونهٔ تکراری در وضعیت فعال پیدا شد.');
	if (!isRecord(raw.options)) throw new Error('تنظیمات افزونه‌ها باید یک شیء باشد.');

	const options: Record<string, Record<string, unknown>> = {};
	for (const [pluginId, rawOptions] of Object.entries(raw.options)) {
		if (!PLUGIN_ID.test(pluginId) || !isRecord(rawOptions)) {
			throw new Error(`ساختار تنظیمات افزونهٔ «${pluginId}» نامعتبر است.`);
		}
		const pluginOptions: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(rawOptions)) {
			if (!OPTION_KEY.test(key) || !isJsonValue(value)) {
				throw new Error(`تنظیم «${pluginId}.${key}» نامعتبر است.`);
			}
			pluginOptions[key] = value;
		}
		options[pluginId] = pluginOptions;
	}

	return { version: 1, active: [...raw.active], options };
}

function missingFile(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

export function parsePluginStateContent(content: string, source = STATE_FILE): PluginState {
	let raw: unknown;
	try {
		raw = JSON.parse(content);
	} catch {
		throw new Error(`فایل ${source} خراب است؛ برای جلوگیری از حذف داده، تغییری روی آن انجام نشد.`);
	}
	return validatePluginState(raw);
}

export async function readPluginState(): Promise<PluginState> {
	let content: string;
	try {
		content = await readFile(STATE_FILE, 'utf8');
	} catch (error) {
		if (missingFile(error)) return structuredClone(EMPTY);
		throw error;
	}
	return parsePluginStateContent(content);
}

let queue: Promise<unknown> = Promise.resolve();

/** Serialize writes in-process and atomically replace the state file. */
export function updatePluginState(
	mutate: (state: PluginState) => PluginState | void,
): Promise<PluginState> {
	const run = queue.then(async () => {
		const current = await readPluginState();
		const draft = structuredClone(current);
		const normalized = validatePluginState(mutate(draft) ?? draft);

		await mkdir(path.dirname(STATE_FILE), { recursive: true });
		const temporary = `${STATE_FILE}.${process.pid}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, `${JSON.stringify(normalized, null, '\t')}\n`, { encoding: 'utf8', mode: 0o600 });
			await rename(temporary, STATE_FILE);
			return normalized;
		} catch (error) {
			await rm(temporary, { force: true }).catch(() => undefined);
			throw error;
		}
	});

	queue = run.catch(() => undefined);
	return run;
}

export function setPluginOptions(
	pluginId: string,
	values: Record<string, unknown>,
): Promise<PluginState> {
	if (!PLUGIN_ID.test(pluginId)) throw new Error('شناسهٔ افزونه معتبر نیست.');
	for (const key of Object.keys(values)) {
		if (!OPTION_KEY.test(key)) throw new Error(`کلید تنظیم «${key}» معتبر نیست.`);
	}

	return updatePluginState((state) => {
		const options = { ...(state.options[pluginId] ?? {}) };
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined || value === null || value === '') delete options[key];
			else options[key] = value;
		}
		if (Object.keys(options).length) state.options = { ...state.options, [pluginId]: options };
		else {
			const next = { ...state.options };
			delete next[pluginId];
			state.options = next;
		}
	});
}

export function setPluginOption(
	pluginId: string,
	key: string,
	value: unknown,
): Promise<PluginState> {
	return setPluginOptions(pluginId, { [key]: value });
}
