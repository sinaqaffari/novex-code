const MEDIA_REFERENCE = /^media:\/\/(uploads|assets)\/([A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:avif|gif|jpe?g|png|webp))$/i;

export interface BuilderMediaReference {
	bucket: 'uploads' | 'assets';
	name: string;
}

export function parseBuilderMediaReference(value: string): BuilderMediaReference | null {
	const match = MEDIA_REFERENCE.exec(value);
	if (!match || match[2].includes('..')) return null;
	return { bucket: match[1].toLowerCase() as BuilderMediaReference['bucket'], name: match[2] };
}

/** Convert a stable serialized asset reference to its public streaming URL. */
export function resolveBuilderImageSource(value: string): string {
	const reference = parseBuilderMediaReference(value);
	if (!reference) return value;
	const path = reference.bucket === 'uploads' ? `uploads/${reference.name}` : reference.name;
	return `/media/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function builderMediaReferenceFromPublicUrl(publicUrl: string): string | null {
	if (!publicUrl.startsWith('/media/')) return null;
	const path = publicUrl.slice('/media/'.length);
	const bucket = path.startsWith('uploads/') ? 'uploads' : 'assets';
	const name = bucket === 'uploads' ? path.slice('uploads/'.length) : path;
	if (!name || name.includes('/')) return null;
	const reference = `media://${bucket}/${name}`;
	return parseBuilderMediaReference(reference) ? reference : null;
}
