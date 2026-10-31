import { readSettings, type SiteSettings } from './settings.ts';
import { readDatabase } from '../commerce/db.ts';
import type { Database } from '../commerce/types.ts';

interface RequestData {
	settings?: Promise<SiteSettings>;
	commerce?: Promise<Database>;
}

// Astro shares `locals` with the layout and page for one request. Never cache
// across requests: writers and other processes must remain immediately visible.
const requestData = new WeakMap<object, RequestData>();

function dataFor(locals: object): RequestData {
	let data = requestData.get(locals);
	if (!data) {
		data = {};
		requestData.set(locals, data);
	}
	return data;
}

export function requestSettings(locals: object): Promise<SiteSettings> {
	const data = dataFor(locals);
	return data.settings ??= readSettings();
}

/** Read-only snapshot for rendering. Mutations must still use updateDatabase. */
export function requestCommerce(locals: object): Promise<Database> {
	const data = dataFor(locals);
	return data.commerce ??= readDatabase();
}
