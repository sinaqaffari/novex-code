/** Public image URLs include existing managed legacy references, but never
 * translate arbitrary relative paths into public files. */
export function publicImageSrc(value: string | undefined | null): string {
	if (!value) return '';
	const trimmed = value.trim();
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
	const managed = /^media:\/\/(uploads|assets)\/([A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:avif|gif|jpe?g|png|webp|svg))$/i.exec(trimmed);
	if (managed && !managed[2].includes('..')) return `/media/${managed[1].toLowerCase() === 'uploads' ? 'uploads/' : ''}${encodeURIComponent(managed[2])}`;
	const legacy = !/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !trimmed.startsWith('/')
		? /(?:^|\/)assets\/((?:uploads\/)?)([A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:avif|gif|jpe?g|png|webp|svg))$/i.exec(trimmed)
		: null;
	if (legacy && !legacy[2].includes('..')) return `/media/${legacy[1]}${encodeURIComponent(legacy[2])}`;
	return '';
}
