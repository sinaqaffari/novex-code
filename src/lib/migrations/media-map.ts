import { parseBuilderMediaReference } from '../builder/media-reference.ts';

/** Exact source identifier to an existing managed image. Source URLs are never fetched. */
export type MigrationMediaMap = ReadonlyMap<string, string>;
export const MAX_MIGRATION_MEDIA_MAP_BYTES = 256_000;

function validSourceKey(value: string): boolean {
	if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
	if (/^id:[1-9][0-9]{0,19}$/.test(value)) return true;
	if (value.startsWith('/') && !value.startsWith('//')) return true;
	try {
		const url = new URL(value);
		return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
	} catch { return false; }
}

export function parseMigrationMediaMap(input: unknown): MigrationMediaMap {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('نگاشت رسانه باید یک شیء JSON باشد.');
	const entries = Object.entries(input);
	if (entries.length > 200) throw new Error('نگاشت رسانه بیش از ۲۰۰ مورد دارد.');
	const result = new Map<string, string>();
	for (const [source, target] of entries) {
		if (!validSourceKey(source) || typeof target !== 'string' || !parseBuilderMediaReference(target)) throw new Error('شناسهٔ منبع یا رسانهٔ مقصد در نگاشت معتبر نیست.');
		result.set(source, target);
	}
	return result;
}

/** Matching by ID or exact source URL never requests or copies the source. */
export function mappedMigrationMedia(mapping: MigrationMediaMap | undefined, source: { id?: unknown; url?: unknown }): string | null {
	if (!mapping?.size) return null;
	const id = typeof source.id === 'number' && Number.isSafeInteger(source.id) && source.id > 0 ? String(source.id) : typeof source.id === 'string' && /^[1-9][0-9]{0,19}$/.test(source.id) ? source.id : '';
	const byId = id ? mapping.get(`id:${id}`) : undefined;
	const byUrl = typeof source.url === 'string' ? mapping.get(source.url) : undefined;
	if (byId && byUrl && byId !== byUrl) throw new Error('نگاشت شناسه و نشانی یک تصویر با هم تعارض دارند.');
	const target = byId ?? byUrl;
	if (target && !parseBuilderMediaReference(target)) throw new Error('رسانهٔ مقصد در نگاشت معتبر نیست.');
	return target ?? null;
}
