import { createHash } from 'node:crypto';
import { Parser } from 'htmlparser2';
import { readBoundedZip } from '../../builder/bounded-zip.ts';
import { validateUploadFile } from '../../cms/media.ts';
import { inspectWxr, type WxrInspection } from './wxr.ts';
import type { MigrationMediaMap } from '../media-map.ts';

export const MAX_WORDPRESS_ARCHIVE_BYTES = 32 * 1024 * 1024;
const UPLOADS = 'wp-content/uploads/';
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif' };
export interface WordPressArchiveAsset { path: string; destination: string; file: File }
export interface WordPressArchiveInspection { inspection: WxrInspection; assets: WordPressArchiveAsset[]; mediaMap: MigrationMediaMap; matchedAttachments: number; unmatchedAttachments: number }

function safeRelativePath(value: string): boolean {
	if (!value || value.length > 512 || value.startsWith('/') || value.endsWith('/') || /[\\:\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)) return false;
	const parts = value.split('/');
	return parts.length <= 10 && parts.every((part) => Boolean(part) && part !== '.' && part !== '..' && !part.startsWith('.') && part.length <= 120);
}
function imagePath(name: string): string | null {
	if (!name.startsWith(UPLOADS)) return null;
	const relative = name.slice(UPLOADS.length);
	if (!safeRelativePath(relative) || !/\.(?:avif|gif|jpe?g|png|webp)$/i.test(relative)) return null;
	return relative;
}
function sourcePath(value: string): string | null {
	try {
		if (!value || value.length > 2048 || value.startsWith('//')) return null;
		const url = new URL(value, 'https://migration.invalid');
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
		const decoded = decodeURIComponent(url.pathname);
		const index = decoded.lastIndexOf(`/${UPLOADS}`);
		if (index < 0) return null;
		const relative = decoded.slice(index + UPLOADS.length + 1);
		return safeRelativePath(relative) ? relative : null;
	} catch { return null; }
}
function addMapping(map: Map<string, string>, key: string, destination: string): void {
	if (!key) return;
	const existing = map.get(key);
	if (existing && existing !== destination) throw new Error('شناسه یا نشانی رسانه به چند فایل متفاوت اشاره دارد.');
	map.set(key, destination);
}

/** Inspect only: ZIP paths are never extracted or fetched. */
export async function inspectWordPressArchive(bytes: Uint8Array): Promise<WordPressArchiveInspection> {
	const entries = await readBoundedZip(bytes, {
		maxArchiveBytes: MAX_WORDPRESS_ARCHIVE_BYTES, maxExpandedBytes: 40 * 1024 * 1024, maxEntries: 102,
		entry(name) {
			if (name === 'wp-content/' || name === UPLOADS) return { directory: true, maxBytes: 0 };
			if (name.startsWith(UPLOADS) && name.endsWith('/') && safeRelativePath(name.slice(UPLOADS.length, -1))) return { directory: true, maxBytes: 0 };
			if (!name.includes('/') && safeRelativePath(name) && /\.xml$/i.test(name)) return { maxBytes: 1024 * 1024 };
			return imagePath(name) ? { maxBytes: 8 * 1024 * 1024 } : null;
		},
	});
	const xmlFiles = [...entries.keys()].filter((name) => !name.includes('/') && /\.xml$/i.test(name));
	if (xmlFiles.length !== 1) throw new Error('بسته باید دقیقاً یک فایل WXR XML در ریشه داشته باشد.');
	let xml: string; try { xml = new TextDecoder('utf-8', { fatal: true }).decode(entries.get(xmlFiles[0])!); } catch { throw new Error('متن XML معتبر نیست.'); }
	const inspection = inspectWxr(xml);
	const assets: WordPressArchiveAsset[] = [];
	const destinations = new Map<string, string>();
	for (const [name, contents] of entries) {
		const relative = imagePath(name);
		if (!relative) continue;
		if (assets.length >= 80) throw new Error('بسته بیش از ۸۰ تصویر دارد.');
		const filename = relative.split('/').at(-1)!;
		const ext = filename.split('.').at(-1)!.toLowerCase();
		const file = new File([new Uint8Array(contents)], filename, { type: MIME[ext] });
		await validateUploadFile(file);
		const destination = `media://uploads/kit-${createHash('sha256').update(contents).digest('hex')}.${ext}`;
		assets.push({ path: relative, destination, file });
		destinations.set(relative, destination);
	}
	const mediaMap = new Map<string, string>();
	let matchedAttachments = 0;
	for (const attachment of inspection.attachments) {
		const paths = [...new Set(attachment.paths.filter(Boolean))];
		if (paths.length > 1 || paths.some((item) => !safeRelativePath(item))) throw new Error('مسیر رسانهٔ وردپرس نامعتبر یا متعارض است.');
		const urlPath = sourcePath(attachment.url);
		if (paths[0] && urlPath && paths[0] !== urlPath) throw new Error('مسیر و نشانی رسانهٔ وردپرس تعارض دارند.');
		const relative = paths[0] ?? urlPath;
		const target = relative ? destinations.get(relative) : undefined;
		if (!target) continue;
		matchedAttachments++;
		if (/^[1-9][0-9]{0,19}$/.test(attachment.id)) addMapping(mediaMap, `id:${attachment.id}`, target);
		if (attachment.url) addMapping(mediaMap, attachment.url, target);
		addMapping(mediaMap, `/${UPLOADS}${relative}`, target);
	}
	// Match exact image URLs in HTML, even when attachment records were omitted.
	for (const item of inspection.items) {
		const parser = new Parser({ onopentag(name, attributes) {
			if (name !== 'img' || !attributes.src) return;
			const relative = sourcePath(attributes.src); const target = relative ? destinations.get(relative) : undefined;
			if (target) addMapping(mediaMap, attributes.src, target);
		} }, { decodeEntities: true });
		parser.end(item.content);
		if (item.elementorData) {
			let parsed: unknown; try { parsed = JSON.parse(item.elementorData); } catch { continue; }
			const pending: unknown[] = [parsed]; let visited = 0;
			while (pending.length) {
				if (++visited > 25_000) throw new Error('تعداد داده‌های Elementor بیش از حد مجاز است.');
				const value = pending.pop();
				if (typeof value === 'string') {
					const relative = sourcePath(value); const target = relative ? destinations.get(relative) : undefined;
					if (target) addMapping(mediaMap, value, target);
				} else if (Array.isArray(value) || (value && typeof value === 'object')) {
					const children = Array.isArray(value) ? value : Object.values(value);
					// Count queued entries too: a large flat JSON array must not fill the
					// stack or exceed the traversal budget before the next pop.
					if (visited + pending.length + children.length > 25_000) throw new Error('تعداد داده‌های Elementor بیش از حد مجاز است.');
					for (const child of children) pending.push(child);
				}
			}
		}
	}
	return { inspection, assets, mediaMap, matchedAttachments, unmatchedAttachments: inspection.attachments.length - matchedAttachments };
}
