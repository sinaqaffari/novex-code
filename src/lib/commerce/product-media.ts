import { lstat, readFile } from 'node:fs/promises';
import { AppError } from '../errors.ts';
import { assertPostUploadsExist, postUploadName } from '../cms/blog-media.ts';
import { DB_FILE } from './db.ts';
import { assertFileStoreNotMigrated, readPostgresCommerce } from './postgres.ts';

const MAX_CATALOG_BYTES = 64 * 1024 * 1024;

/** Product writes call this while the shared asset/commerce lock is held.
 * Unchanged missing legacy images remain editable; newly added local images
 * must still be regular files at commit time. No remote URL is requested. */
export async function assertProductUploadExists(image: string, previous?: string, origins: readonly string[] = []): Promise<void> {
	const { UPLOAD_DIR } = await import('../cms/media.ts');
	try {
		await assertPostUploadsExist(UPLOAD_DIR, image, '', previous === undefined ? undefined : { heroImage: previous, body: '' }, origins);
	} catch (error) {
		if (error instanceof AppError) throw new AppError(error.message, 'image', error.status);
		throw error;
	}
}

/** Inspect only an already existing catalog: media deletion must not create or
 * reset commerce data. Unknown/unsafe catalogs fail closed. Absolute URLs with
 * upload-like paths are conservatively protected even if their host is remote. */
export async function assertProductUploadUnused(name: string): Promise<void> {
	try {
		let raw: unknown;
		const mode = process.env.NOVEX_COMMERCE_STORE ?? 'file';
		if (mode === 'postgres') raw = (await readPostgresCommerce(DB_FILE)).raw;
		else if (mode === 'file') {
			await assertFileStoreNotMigrated(DB_FILE);
			const info = await lstat(DB_FILE);
			if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CATALOG_BYTES) throw new Error('unsafe catalog');
			raw = JSON.parse(await readFile(DB_FILE, 'utf8')) as unknown;
		} else throw new Error('invalid commerce storage mode');
		if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray((raw as { products?: unknown }).products)) throw new Error('invalid catalog');
		for (const value of (raw as { products: unknown[] }).products) {
			if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { image?: unknown }).image !== 'string') throw new Error('invalid product');
			const image = (value as { image: string }).image;
			let origin = '';
			try { origin = new URL(image).origin; } catch { /* relative reference */ }
			if (postUploadName(image, origin ? [origin] : []) === name) {
				throw new AppError('این رسانه در یک محصول استفاده شده است و حذف نمی‌شود.', 'file', 409);
			}
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		if (error instanceof AppError) throw error;
		throw new AppError('بررسی ایمن تصاویر محصولات ممکن نشد؛ رسانه حذف نشد.', 'file', 503);
	}
}
