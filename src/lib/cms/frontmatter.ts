/**
 * A deliberately small YAML-frontmatter reader/writer.
 *
 * The CMS only needs to round-trip the handful of scalar fields the blog
 * collection exposes, plus simple string arrays (tags). Anything it does not
 * understand is preserved as a raw string so editing a post never silently
 * destroys frontmatter written by hand.
 */

export type FrontmatterValue = string | boolean | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

export interface ParsedDocument {
	data: Frontmatter;
	body: string;
}

const DELIMITER = '---';

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed.at(-1);
		if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
			const inner = trimmed.slice(1, -1);
			return first === "'" ? inner.replace(/''/g, "'") : inner.replace(/\\"/g, '"');
		}
	}
	return trimmed;
}

function parseInlineArray(value: string): string[] {
	return value
		.slice(1, -1)
		.split(',')
		.map((item) => unquote(item))
		.filter((item) => item !== '');
}

/** Split `---\n…\n---\nbody` into data + body. */
export function parseFrontmatter(source: string): ParsedDocument {
	const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');

	if (lines[0]?.trim() !== DELIMITER) {
		return { data: {}, body: normalized.trim() };
	}

	const closing = lines.findIndex((line, index) => index > 0 && line.trim() === DELIMITER);
	if (closing === -1) {
		return { data: {}, body: normalized.trim() };
	}

	const headerLines = lines.slice(1, closing);
	const data: Frontmatter = {};
	let pendingKey: string | null = null;

	for (const line of headerLines) {
		if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

		const listItem = /^\s*-\s+(.*)$/.exec(line);
		if (listItem && pendingKey) {
			const current = data[pendingKey];
			const next = unquote(listItem[1]);
			if (Array.isArray(current)) current.push(next);
			else data[pendingKey] = [next];
			continue;
		}

		const pair = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
		if (!pair) continue;

		const key = pair[1];
		const rawValue = pair[2].trim();
		pendingKey = key;

		if (rawValue === '') {
			data[key] = [];
			continue;
		}
		if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
			data[key] = parseInlineArray(rawValue);
			continue;
		}
		if (rawValue === 'true' || rawValue === 'false') {
			data[key] = rawValue === 'true';
			continue;
		}
		data[key] = unquote(rawValue);
	}

	return {
		data,
		body: lines
			.slice(closing + 1)
			.join('\n')
			.replace(/^\n+/, '')
			.trimEnd(),
	};
}

function quote(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function serializeValue(value: FrontmatterValue): string {
	if (Array.isArray(value)) return `[${value.map((item) => quote(item)).join(', ')}]`;
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return quote(value);
}

/** Build a Markdown file with a stable, readable key order. */
export function serializeFrontmatter(data: Frontmatter, body: string, order: string[] = []): string {
	const keys = [
		...order.filter((key) => key in data),
		...Object.keys(data).filter((key) => !order.includes(key)),
	];

	const header = keys
		.filter((key) => data[key] !== undefined && data[key] !== '')
		.map((key) => `${key}: ${serializeValue(data[key])}`)
		.join('\n');

	return `${DELIMITER}\n${header}\n${DELIMITER}\n\n${body.trim()}\n`;
}

/** Coerce an unknown frontmatter value into a form-friendly string. */
export function asString(value: FrontmatterValue | undefined, fallback = ''): string {
	if (value === undefined) return fallback;
	if (Array.isArray(value)) return value.join('، ');
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return value;
}

/** Accept both `[a, b]` input and Persian/Arabic comma separated text. */
export function parseTags(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((tag) => String(tag).trim()).filter(Boolean);
	}
	if (typeof value !== 'string') return [];
	return value
		.split(/[،,]/)
		.map((tag) => tag.trim())
		.filter(Boolean);
}
