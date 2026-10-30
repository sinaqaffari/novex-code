import { createHash } from 'node:crypto';
import { readBoundedZip } from './bounded-zip.ts';
import { parseBuilderMediaReference } from './media-reference.ts';
import { validateSiteKit, type SiteKit } from './site-kits.ts';
import { rewriteDocumentMedia } from './rewrite-media.ts';
import { validateUploadFile } from '../cms/media.ts';

export const MAX_KIT_ARCHIVE_BYTES = 12 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 3_000_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 52;
const FILE_NAME = /^assets\/([A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:avif|gif|jpe?g|png|webp))$/i;
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif' };

export interface KitArchiveAsset { original: string; destination: string; file: File }
export interface InspectedKitArchive { kit: SiteKit; assets: KitArchiveAsset[] }

function readZipEntries(bytes: Uint8Array): Promise<Map<string, Buffer>> {
	return readBoundedZip(bytes, {
		maxArchiveBytes: MAX_KIT_ARCHIVE_BYTES, maxExpandedBytes: MAX_EXPANDED_BYTES, maxEntries: MAX_ENTRIES,
		entry(name) {
			if (name === 'assets/') return { directory: true, maxBytes: 0 };
			if (name === 'kit.json') return { maxBytes: MAX_MANIFEST_BYTES };
			const match = FILE_NAME.exec(name);
			return match && !match[1].includes('..') ? { maxBytes: MAX_IMAGE_BYTES } : null;
		},
	});
}

/** Validates the complete archive and all images without writes or network access. */
export async function inspectSiteKitArchive(bytes: Uint8Array): Promise<InspectedKitArchive> {
	const entries = await readZipEntries(bytes);
	const manifest = entries.get('kit.json');
	if (!manifest) throw new Error('فایل kit.json در بسته پیدا نشد.');
	let raw: unknown;
	try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest)); }
	catch { throw new Error('فایل kit.json معتبر نیست.'); }
	const original = validateSiteKit(raw);
	const expected = new Set<string>();
	const references = new Map<string, string>();
	const assets: KitArchiveAsset[] = [];
	for (const value of original.assets) {
		const ref = parseBuilderMediaReference(value)!;
		if (ref.bucket !== 'uploads') continue; // Bundled media://assets references are checked before installation.
		const name = `assets/${ref.name}`;
		const bytes = entries.get(name);
		if (!bytes) throw new Error(`دارایی ${ref.name} در بسته وجود ندارد.`);
		expected.add(name);
		const ext = ref.name.split('.').pop()!.toLowerCase();
		const file = new File([new Uint8Array(bytes)], ref.name, { type: MIME[ext] });
		await validateUploadFile(file);
		const destination = `media://uploads/kit-${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
		references.set(value, destination);
		assets.push({ original: value, destination, file });
	}
	for (const name of entries.keys()) if (name !== 'kit.json' && !expected.has(name)) throw new Error(`فایل ${name} در فهرست دارایی‌ها اعلام نشده است.`);
	const kit = validateSiteKit({
		...original,
		assets: [...new Set(original.assets.map((value) => references.get(value) ?? value))],
		pages: original.pages.map((page) => ({ ...page, document: rewriteDocumentMedia(page.document, references) })),
	});
	return { kit, assets };
}
