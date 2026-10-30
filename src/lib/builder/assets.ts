import { parseBuilderMediaReference, resolveBuilderImageSource } from './media-reference.ts';
import { traversePageNodes } from './operations.ts';
import type { BuilderNode, PageDocument } from './types.ts';

export interface DocumentAssetUsage {
	nodeId: string;
	identity: string;
	publicUrl: string;
	property?: string;
}

export interface NodeImageReference { src: string; alt: string; property: string }

export interface AssetResolutionOptions {
	/** Only these explicit HTTP(S) origins are treated as local on save/publish. */
	origins?: readonly string[];
	/** Conservative deletion scan: any upload-like absolute URL may protect a file. */
	anyAbsolute?: boolean;
}

/** Canonicalize local media URLs, including legacy URLs with query strings. Never fetch. */
export function localBuilderAssetIdentity(source: string, options: AssetResolutionOptions = {}): string | null {
	const ref = parseBuilderMediaReference(source);
	if (ref) return `${ref.bucket.toLowerCase()}/${ref.name}`;
	if (/^https?:\/\//i.test(source)) {
		try {
			const url = new URL(source);
			if (url.username || url.password) return null;
			const sameOrigin = options.origins?.some((value) => {
				try { const origin = new URL(value); return !origin.username && !origin.password && origin.origin === url.origin; } catch { return false; }
			});
			if (!options.anyAbsolute && !sameOrigin) return null;
			return localBuilderAssetIdentity(`${url.pathname}${url.search}${url.hash}`);
		} catch { return null; }
	}
	if (!source.startsWith('/media/') || source.startsWith('//')) return null;
	try {
		const parsed = new URL(source, 'https://builder.invalid');
		const path = decodeURIComponent(parsed.pathname);
		const match = /^\/media\/(uploads\/)?([A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:avif|gif|jpe?g|png|webp|svg))$/i.exec(path);
		if (!match || match[2].includes('..')) return null;
		return `${match[1] ? 'uploads' : 'assets'}/${match[2]}`;
	} catch {
		return null;
	}
}

/** Every image-bearing native node uses this shared enumeration. */
export function nodeImageReferences(node: BuilderNode): NodeImageReference[] {
	if (node.type === 'Image') return [{ src: node.props.src, alt: node.props.alt, property: 'props.src' }];
	if (node.type === 'ImageGallery') return node.props.items.map((item, index) => ({ src: item.src, alt: item.alt, property: `props.items[${index}].src` }));
	return [];
}

export function collectDocumentAssets(document: PageDocument, options: AssetResolutionOptions = {}): DocumentAssetUsage[] {
	const uses: DocumentAssetUsage[] = [];
	traversePageNodes(document, (node) => {
		for (const image of nodeImageReferences(node)) {
			if (!image.src) continue;
			const identity = localBuilderAssetIdentity(image.src, options);
			if (identity) uses.push({ nodeId: node.id, identity, publicUrl: resolveBuilderImageSource(image.src), property: image.property });
		}
	});
	return uses;
}
