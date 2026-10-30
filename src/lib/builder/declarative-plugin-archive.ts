import { createHash } from 'node:crypto';
import { readBoundedZip } from './bounded-zip.ts';
import { nodeImageReferences } from './assets.ts';
import { traversePageNodes } from './operations.ts';
import { parseBuilderMediaReference } from './media-reference.ts';
import { rewriteDocumentMedia } from './rewrite-media.ts';
import { validateDeclarativePluginPackage, type DeclarativePluginPackage } from './declarative-plugin-package.ts';
import { validateUploadFile } from '../cms/media.ts';

export const MAX_PLUGIN_ARCHIVE_BYTES = 12 * 1024 * 1024;
const IMAGE = /^assets\/([A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:avif|gif|jpe?g|png|webp))$/i;
const MODULE = /^modules\/([A-Za-z0-9][A-Za-z0-9._-]{0,119}\.wasm)$/;
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif' };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export interface PluginArchiveAsset { original: string; destination: string; file: File }

/** Inspect without writes. Only declared Wasm and referenced raster images are accepted. */
export async function inspectDeclarativePluginArchive(bytes: Uint8Array): Promise<{ package: DeclarativePluginPackage; readme: string; assets: PluginArchiveAsset[] }> {
	const entries = await readBoundedZip(bytes, {
		maxArchiveBytes: MAX_PLUGIN_ARCHIVE_BYTES, maxExpandedBytes: 20 * 1024 * 1024, maxEntries: 52,
		entry(name) {
			if (name === 'assets/' || name === 'modules/') return { directory: true, maxBytes: 0 };
			if (name === 'plugin.json') return { maxBytes: 500_000 };
			if (name === 'README.txt') return { maxBytes: 20_000 };
			const image = IMAGE.exec(name); if (image && !image[1].includes('..')) return { maxBytes: 8 * 1024 * 1024 };
			const module = MODULE.exec(name); if (module && !module[1].includes('..')) return { maxBytes: 64 * 1024 };
			return null;
		},
	});
	const manifest = entries.get('plugin.json');
	if (!manifest) throw new Error('فایل plugin.json در بسته پیدا نشد.');
	let raw: unknown;
	let readme = '';
	try {
		const decoder = new TextDecoder('utf-8', { fatal: true });
		raw = JSON.parse(decoder.decode(manifest));
		const text = entries.get('README.txt');
		if (text) readme = decoder.decode(text);
	} catch { throw new Error('متن یا JSON بسته معتبر نیست.'); }
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(readme)) throw new Error('متن راهنمای بسته دارای نویسهٔ کنترلی نامعتبر است.');
	const expected = new Set(['plugin.json', ...(entries.has('README.txt') ? ['README.txt'] : [])]);
	if (record(raw) && raw.schemaVersion === 3 && Array.isArray(raw.processors)) {
		raw = { ...raw, processors: raw.processors.map((entry: unknown) => {
			if (!record(entry) || !Object.hasOwn(entry, 'modulePath')) return entry;
			if (typeof entry.modulePath !== 'string' || !MODULE.test(entry.modulePath) || entry.modulePath.includes('..') || Object.hasOwn(entry, 'moduleBase64')) throw new Error('مسیر ماژول بسته معتبر نیست.');
			const contents = entries.get(entry.modulePath);
			if (!contents) throw new Error('ماژول اعلام‌شده در بسته پیدا نشد.');
			expected.add(entry.modulePath);
			const { modulePath: _modulePath, ...processor } = entry;
			return { ...processor, moduleBase64: contents.toString('base64') };
		}) };
	}
	const original = validateDeclarativePluginPackage(raw);
	const imageReferences = new Set<string>();
	for (const preset of original.presets ?? []) traversePageNodes(preset.document, (node) => {
		for (const image of nodeImageReferences(node)) if (image.src) imageReferences.add(image.src);
	});
	const references = new Map<string, string>();
	const assets: PluginArchiveAsset[] = [];
	for (const value of imageReferences) {
		const ref = parseBuilderMediaReference(value)!;
		if (ref.bucket !== 'uploads') continue;
		const name = `assets/${ref.name}`;
		const contents = entries.get(name);
		if (!contents) continue; // Existing managed uploads remain possible; installation checks them.
		expected.add(name);
		const ext = ref.name.split('.').pop()!.toLowerCase();
		const file = new File([new Uint8Array(contents)], ref.name, { type: MIME[ext] });
		await validateUploadFile(file);
		const destination = `media://uploads/kit-${createHash('sha256').update(contents).digest('hex')}.${ext}`;
		references.set(value, destination);
		assets.push({ original: value, destination, file });
	}
	for (const name of entries.keys()) if (!expected.has(name)) throw new Error(`فایل ${name} در بسته ارجاع نشده است.`);
	const rewritten = validateDeclarativePluginPackage({ ...original, ...(original.presets ? { presets: original.presets.map((preset) => ({ ...preset, document: rewriteDocumentMedia(preset.document, references) })) } : {}) });
	return { package: rewritten, readme, assets };
}
