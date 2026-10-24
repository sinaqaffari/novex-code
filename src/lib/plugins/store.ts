/**
 * وضعیت افزونه‌ها — کدام افزونه روشن است و هر کدام چه تنظیماتی دارد.
 * فایل: data/plugins.json — با نوشتن اتمیک تا نیمه‌کاره نماند.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'plugins.json');

export interface PluginState {
	version: number;
	active: string[];
	options: Record<string, Record<string, unknown>>;
}

const EMPTY: PluginState = { version: 1, active: [], options: {} };

function normalize(raw: unknown): PluginState {
	if (!raw || typeof raw !== 'object') return { ...EMPTY, active: [], options: {} };
	const value = raw as Partial<PluginState>;
	return {
		version: 1,
		active: Array.isArray(value.active)
			? [...new Set(value.active.filter((id): id is string => typeof id === 'string'))]
			: [],
		options:
			value.options && typeof value.options === 'object'
				? (value.options as Record<string, Record<string, unknown>>)
				: {},
	};
}

export async function readPluginState(): Promise<PluginState> {
	try {
		return normalize(JSON.parse(await readFile(STATE_FILE, 'utf8')));
	} catch {
		return { ...EMPTY, active: [], options: {} };
	}
}

let queue: Promise<unknown> = Promise.resolve();

/** یک صف سریالی؛ نوشتن‌های هم‌زمان روی هم نمی‌افتند. */
export function updatePluginState(
	mutate: (state: PluginState) => PluginState | void,
): Promise<PluginState> {
	const run = queue.then(async () => {
		const current = await readPluginState();
		const draft = structuredClone(current);
		const normalized = normalize(mutate(draft) ?? draft);

		await mkdir(DATA_DIR, { recursive: true });
		const temporary = `${STATE_FILE}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(normalized, null, '\t')}\n`, 'utf8');
		await rename(temporary, STATE_FILE);
		return normalized;
	});

	queue = run.catch(() => undefined);
	return run;
}

export async function setPluginOption(
	pluginId: string,
	key: string,
	value: unknown,
): Promise<PluginState> {
	return updatePluginState((state) => {
		const options = { ...(state.options[pluginId] ?? {}) };
		if (value === undefined || value === null || value === '') delete options[key];
		else options[key] = value;
		state.options = { ...state.options, [pluginId]: options };
	});
}
