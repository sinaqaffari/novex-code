/**
 * Media library. Uploads live in `src/assets/uploads` so Astro still optimises
 * them, and every file is previewed through the panel's own streaming route.
 */

import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CmsError } from './posts';

export const ASSETS_DIR = path.resolve(process.cwd(), 'src/assets');
export const UPLOAD_DIR = path.join(ASSETS_DIR, 'uploads');
export const BLOG_DIR = path.resolve(process.cwd(), 'src/content/blog');

export const ALLOWED_EXTENSIONS = [
	'jpg',
	'jpeg',
	'png',
	'webp',
	'avif',
	'gif',
	'svg',
] as const;

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
				return {
					name: entry.name,
					reference: toReference(absolute),
					previewUrl: previewUrlFor(absolute),
					publicUrl: publicUrlFor(absolute),
					bytes: info.size,
					modifiedAt: info.mtime.toISOString(),
					extension: extensionOf(entry.name),
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

export async function saveUpload(file: File): Promise<MediaItem> {
	await mkdir(UPLOAD_DIR, { recursive: true });

	const extension = extensionOf(file.name);
	if (!ALLOWED_EXTENSIONS.includes(extension as never)) {
		throw new CmsError('فقط تصاویر JPG، PNG، WebP، AVIF، GIF و SVG مجاز هستند.', 'file');
	}
	if (file.size === 0) throw new CmsError('فایل خالی است.', 'file');
	if (file.size > MAX_BYTES) {
		throw new CmsError('حجم فایل نمی‌تواند بیشتر از ۸ مگابایت باشد.', 'file');
	}

	const base =
		path
			.basename(file.name, path.extname(file.name))
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'image';

	const name = `${base}-${Date.now().toString(36)}.${extension}`;
	const absolute = path.join(UPLOAD_DIR, name);
	await writeFile(absolute, Buffer.from(await file.arrayBuffer()));

	const info = await stat(absolute);
	return {
		name,
		reference: toReference(absolute),
		previewUrl: previewUrlFor(absolute),
		publicUrl: publicUrlFor(absolute),
		bytes: info.size,
		modifiedAt: info.mtime.toISOString(),
		extension,
		builtin: false,
	};
}

export async function deleteUpload(name: string): Promise<void> {
	const safeName = path.basename(decodeURIComponent(name));
	if (!ALLOWED_EXTENSIONS.includes(extensionOf(safeName) as never)) {
		throw new CmsError('نام فایل معتبر نیست.', 'file');
	}
	try {
		await unlink(path.join(UPLOAD_DIR, safeName));
	} catch {
		throw new CmsError('فایل مورد نظر پیدا نشد.', 'file', 404);
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
