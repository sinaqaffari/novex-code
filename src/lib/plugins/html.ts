/** کمک‌کننده‌های کوچکی که افزونه‌ها برای ساخت HTML امن لازم دارند. */

const ENTITIES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

export function escapeHtml(value: unknown): string {
	return String(value ?? '').replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character);
}

export function escapeAttribute(value: unknown): string {
	return escapeHtml(value).replace(/`/g, '&#96;');
}

/**
 * JSON-LD داخل <script> قرار می‌گیرد، پس نباید کاراکترهای HTML را کدگذاری کرد؛
 * فقط باید جلو بسته‌شدن ناخواستهٔ تگ گرفته شود.
 */
export function escapeJsonLd(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026');
}
