/** Shared URL policy for all author-supplied page links. URLs are never fetched. */
export function safeHref(value: string): boolean {
	const href = value.trim();
	if (!href || href.length > 500 || /[\\\u0000-\u001f\u007f]/.test(href)) return false;
	if (href.startsWith('/') && !href.startsWith('//')) return true;
	if (href.startsWith('#')) return true;
	try {
		const parsed = new URL(href);
		return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password;
	} catch {
		return false;
	}
}
