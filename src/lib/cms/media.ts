/**
 * Media library. Uploads live in `src/assets/uploads` so Astro still optimises
 * them, and every file is previewed through the panel's own streaming route.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AppError as CmsError } from '../errors.ts';

export const ASSETS_DIR = path.resolve(process.env.CMS_ASSETS_DIR || path.join(process.cwd(), 'src/assets'));
export const UPLOAD_DIR = path.join(ASSETS_DIR, 'uploads');
export const BLOG_DIR = path.resolve(process.env.CMS_BLOG_DIR || path.join(process.cwd(), 'src/content/blog'));

export const ALLOWED_EXTENSIONS = [
	'jpg',
	'jpeg',
	'png',
	'webp',
	'avif',
	'gif',
	'svg',
] as const;

/** New SVG uploads are disabled until a proven sanitizer is in place. */
export const ALLOWED_UPLOAD_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] as const;

const MIME_BY_EXTENSION: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	avif: 'image/avif',
	gif: 'image/gif',
	svg: 'image/svg+xml',
};

const MAX_BYTES = 8 * 1024 * 1024; // ۸ مگابایت
const MAX_IMAGE_PIXELS = 40_000_000;

export interface MediaItem {
	name: string;
	/** Path relative to the blog folder — what a post's `heroImage` expects. */
	reference: string;
	previewUrl: string;
	/** Public URL (served by `/media/...`) — safe to use in storefront content. */
	publicUrl: string;
	bytes: number;
	modifiedAt: string;
	extension: string;
	mimeType: string;
	width?: number;
	height?: number;
	/** True for images that ship with the theme. */
	builtin: boolean;
}

function extensionOf(name: string): string {
	return name.split('.').pop()?.toLowerCase() ?? '';
}

function isInside(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Resolve a public-ish reference to a real file inside `src/assets`. */
export function resolveAssetPath(reference: string): string | null {
	const cleaned = reference.replace(/^\/+/, '');
	// Accept both `uploads/x.jpg` and `../../assets/uploads/x.jpg`.
	const normalized = cleaned.includes('assets/')
		? cleaned.slice(cleaned.lastIndexOf('assets/') + 'assets/'.length)
		: cleaned;
	const candidate = path.resolve(ASSETS_DIR, normalized);
	return isInside(ASSETS_DIR, candidate) ? candidate : null;
}

export function toReference(absolutePath: string): string {
	return path.relative(BLOG_DIR, absolutePath).split(path.sep).join('/');
}

export function previewUrlFor(absolutePath: string): string {
	const relative = path.relative(ASSETS_DIR, absolutePath).split(path.sep).join('/');
	return `/cms/media/file/${relative}`;
}

export function publicUrlFor(absolutePath: string): string {
	const relative = path.relative(ASSETS_DIR, absolutePath).split(path.sep).join('/');
	return `/media/${relative}`;
}

async function collect(directory: string, builtin: boolean): Promise<MediaItem[]> {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch {
		return [];
	}

	const items = await Promise.all(
		entries
			.filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
			.filter((entry) => ALLOWED_EXTENSIONS.includes(extensionOf(entry.name) as never))
			.map(async (entry) => {
				const absolute = path.join(directory, entry.name);
				const info = await stat(absolute);
				const dimensions = await imageDimensions(absolute).catch(() => ({}));
				return {
					name: entry.name,
					reference: toReference(absolute),
					previewUrl: previewUrlFor(absolute),
					publicUrl: publicUrlFor(absolute),
					bytes: info.size,
					modifiedAt: info.mtime.toISOString(),
					extension: extensionOf(entry.name),
					mimeType: MIME_BY_EXTENSION[extensionOf(entry.name)] ?? 'application/octet-stream',
					...dimensions,
					builtin,
				} satisfies MediaItem;
			}),
	);

	return items;
}

/** Newest uploads first, then the bundled theme artwork. */
export async function listMedia(): Promise<MediaItem[]> {
	await mkdir(UPLOAD_DIR, { recursive: true });
	const [uploads, builtin] = await Promise.all([
		collect(UPLOAD_DIR, false),
		collect(ASSETS_DIR, true),
	]);

	uploads.sort((a, b) => new Date(b.modifiedAt).valueOf() - new Date(a.modifiedAt).valueOf());
	builtin.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
	return [...uploads, ...builtin];
}

async function imageDimensions(input: string | Buffer): Promise<{ width?: number; height?: number }> {
	const metadata = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
	return { ...(metadata.width ? { width: metadata.width } : {}), ...(metadata.height ? { height: metadata.height } : {}) };
}

async function inspectUploadFile(file: File): Promise<{ width: number; height: number }> {
	const extension = extensionOf(file.name);
	if (!ALLOWED_UPLOAD_EXTENSIONS.includes(extension as never)) {
		throw new CmsError('فقط تصاویر JPG، PNG، WebP، AVIF و GIF مجاز هستند.', 'file');
	}
	if (file.size === 0) throw new CmsError('فایل خالی است.', 'file');
	if (file.size > MAX_BYTES) throw new CmsError('حجم هر فایل نمی‌تواند بیشتر از ۸ مگابایت باشد.', 'file');

	const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
	const ascii = (start: number, length: number) => String.fromCharCode(...header.slice(start, start + length));
	const validSignature = extension === 'jpg' || extension === 'jpeg'
		? header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
		: extension === 'png'
			? header.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => header[index] === value)
			: extension === 'webp'
				? header.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP'
				: extension === 'gif'
					? ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a'
					: header.length >= 12 && ascii(4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 4));
	if (!validSignature) throw new CmsError('محتوای فایل با قالب تصویر انتخاب‌شده سازگار نیست.', 'file');
	try {
		const metadata = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
		const width = metadata.width ?? 0;
		const height = metadata.height ?? 0;
		const totalPixels = width * (metadata.pageHeight ?? height) * (metadata.pages ?? 1);
		if (metadata.mediaType !== MIME_BY_EXTENSION[extension] || !width || !height || totalPixels > MAX_IMAGE_PIXELS) throw new Error('invalid image metadata');
		return { width, height };
	} catch {
		throw new CmsError('ساختار یا ابعاد تصویر معتبر نیست (حداکثر ۴۰ میلیون پیکسل).', 'file');
	}
}

export async function validateUploadFile(file: File): Promise<void> {
	await inspectUploadFile(file);
}

/** Reuse is opt-in and explicitly reported; ordinary uploads retain their own identity. */
export type MediaUploadResult = MediaItem & { reused: boolean };

export async function saveUpload(file: File, options: { deduplicate?: boolean } = {}): Promise<MediaUploadResult> {
	const dimensions = await inspectUploadFile(file);
	const bytes = Buffer.from(await file.arrayBuffer());
	const extension = extensionOf(file.name);
	const base = path.basename(file.name, path.extname(file.name)).toLowerCase()
		.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
	const { BuilderStoreError, withBuilderAssetLock } = await import('../builder/store.ts');
	try {
		return await withBuilderAssetLock(async () => {
			await mkdir(UPLOAD_DIR, { recursive: true });
			if (options.deduplicate) {
				// Only managed regular uploads of the same type and size are examined.
				// Exact byte equality avoids hash-collision ambiguity; nothing is deleted.
				const entries = (await readdir(UPLOAD_DIR, { withFileTypes: true }))
					.filter((entry) => entry.isFile() && !entry.name.startsWith('.') && MIME_BY_EXTENSION[extensionOf(entry.name)] === MIME_BY_EXTENSION[extension])
					.sort((a, b) => a.name.localeCompare(b.name));
				for (const entry of entries) {
					const absolute = path.join(UPLOAD_DIR, entry.name);
					const info = await stat(absolute);
					if (info.size !== bytes.length) continue;
					if (!bytes.equals(await readFile(absolute))) continue;
					return uploadItem(entry.name, absolute, info, dimensions, true);
				}
			}
			// Exclusive creation avoids overwriting an existing asset even if IDs collide.
			for (let attempt = 0; attempt < 8; attempt++) {
				const name = `${base}-${randomUUID().slice(0, 8)}.${extension}`;
				const absolute = path.join(UPLOAD_DIR, name);
				try {
					await writeFile(absolute, bytes, { flag: 'wx' });
					return uploadItem(name, absolute, await stat(absolute), dimensions, false);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
				}
			}
			throw new CmsError('ساخت نام یکتا برای فایل ممکن نشد.', 'file', 500);
		});
	} catch (error) {
		if (error instanceof BuilderStoreError) throw new CmsError(error.message, 'file', error.status);
		throw error;
	}
}

/** Stable content-addressed kit assets permit three-way updates to recognize
 * unchanged files. Existing files are verified, never overwritten or removed. */
export async function saveKitUpload(file: File): Promise<MediaUploadResult> {
	const dimensions = await inspectUploadFile(file);
	const bytes = Buffer.from(await file.arrayBuffer());
	const extension = extensionOf(file.name);
	const name = `kit-${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
	const absolute = path.join(UPLOAD_DIR, name);
	const { BuilderStoreError, withBuilderAssetLock } = await import('../builder/store.ts');
	try {
		return await withBuilderAssetLock(async () => {
			await mkdir(UPLOAD_DIR, { recursive: true });
			try {
				await writeFile(absolute, bytes, { flag: 'wx' });
				return uploadItem(name, absolute, await stat(absolute), dimensions, false);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
				const info = await lstat(absolute);
				if (!info.isFile() || info.isSymbolicLink() || info.size !== bytes.length || !bytes.equals(await readFile(absolute))) throw new CmsError('دارایی هم‌نام با محتوای متفاوت وجود دارد؛ بازنویسی نشد.', 'file', 409);
				return uploadItem(name, absolute, info, dimensions, true);
			}
		});
	} catch (error) {
		if (error instanceof BuilderStoreError) throw new CmsError(error.message, 'file', error.status);
		throw error;
	}
}

function uploadItem(name: string, absolute: string, info: Stats, dimensions: { width: number; height: number }, reused: boolean): MediaUploadResult {
	const extension = extensionOf(name);
	return {
		name, reference: toReference(absolute), previewUrl: previewUrlFor(absolute), publicUrl: publicUrlFor(absolute),
		bytes: info.size, modifiedAt: info.mtime.toISOString(), extension, mimeType: MIME_BY_EXTENSION[extension],
		...dimensions, builtin: false, reused,
	};
}

export async function deleteUpload(name: string): Promise<void> {
	let decoded: string;
	try { decoded = decodeURIComponent(name); } catch { throw new CmsError('نام فایل معتبر نیست.', 'file'); }
	if (decoded !== path.basename(decoded) || !ALLOWED_EXTENSIONS.includes(extensionOf(decoded) as never)) throw new CmsError('نام فایل معتبر نیست.', 'file');
	// Protect persisted Builder snapshots, CMS posts and product images under
	// the same lock. If a store cannot be inspected, fail closed.
	const { BuilderStoreError, withUnusedBuilderUpload } = await import('../builder/store.ts');
	try {
		await withUnusedBuilderUpload(decoded, async () => {
			const [{ BLOG_DIR: postDirectory }, { assertBlogUploadUnused }, { recoverPostBatchesUnderLock }, { assertProductUploadUnused }] = await Promise.all([import('./posts.ts'), import('./blog-media.ts'), import('./post-batch.ts'), import('../commerce/product-media.ts')]);
			await recoverPostBatchesUnderLock(postDirectory);
			await assertBlogUploadUnused(postDirectory, decoded);
			await assertProductUploadUnused(decoded);
			try { await unlink(path.join(UPLOAD_DIR, decoded)); }
			catch { throw new CmsError('فایل مورد نظر پیدا نشد.', 'file', 404); }
		});
	} catch (error) {
		if (error instanceof BuilderStoreError) throw new CmsError(error.message, 'file', error.status);
		throw error;
	}
}

export async function readAsset(reference: string): Promise<{ body: Buffer; type: string }> {
	const absolute = resolveAssetPath(reference);
	if (!absolute) throw new CmsError('مسیر فایل معتبر نیست.', 'file', 400);

	try {
		const body = await readFile(absolute);
		return { body, type: MIME_BY_EXTENSION[extensionOf(absolute)] ?? 'application/octet-stream' };
	} catch {
		throw new CmsError('فایل مورد نظر پیدا نشد.', 'file', 404);
	}
}

export async function assetExists(reference: string): Promise<boolean> {
	const absolute = resolveAssetPath(reference);
	if (!absolute) return false;
	try {
		const info = await lstat(absolute);
		return info.isFile() && !info.isSymbolicLink();
	} catch {
		return false;
	}
}
