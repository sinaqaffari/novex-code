import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { BackendError } from './inquiries.ts';
import { checkSnapshotRequestSize, type SnapshotClient } from './versioned-client.ts';
import { AppError } from '../errors.ts';

export interface StoreMarker {
	version: 1;
	state: 'pending' | 'complete';
	storeId: string;
	sourceHash: string;
	source: 'file' | 'empty';
}

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const markerPath = (file: string) => `${file}.novex-postgres`;
const hash = (raw: unknown) => createHash('sha256').update(JSON.stringify(raw)).digest('hex');

/** Never fall back to the stale file after an explicit migration has begun. */
export async function assertFileStoreNotMigrated(file: string): Promise<void> {
	try { await lstat(markerPath(file)); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
	throw new AppError('این داده‌ها برای PostgreSQL علامت‌گذاری شده‌اند؛ استفاده از فایل قدیمی مجاز نیست.', undefined, 503);
}

async function readMarker(file: string): Promise<StoreMarker | null> {
	let handle;
	try {
		const entry = await lstat(markerPath(file));
		if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Store migration marker must be a regular file, not a symlink.');
		handle = await open(markerPath(file), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > 4096) throw new Error('Invalid store migration marker.');
		const raw: unknown = JSON.parse(await handle.readFile('utf8'));
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid store migration marker.');
		const marker = raw as Partial<StoreMarker>;
		if (marker.version !== 1 || !['pending', 'complete'].includes(marker.state ?? '') ||
			!['file', 'empty'].includes(marker.source ?? '') || typeof marker.storeId !== 'string' ||
			!/^[a-f0-9]{32}$/.test(marker.storeId) || typeof marker.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(marker.sourceHash)) {
			throw new Error('Invalid store migration marker.');
		}
		return marker as StoreMarker;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	} finally { if (handle) await handle.close(); }
}

function remoteError(error: unknown): never {
	if (error instanceof BackendError) {
		if (error.status === 409) throw new AppError('داده‌ها هم‌زمان تغییر کرده‌اند یا مقصد متعلق به مخزن دیگری است؛ دوباره بررسی کنید.', undefined, 409);
		if (error.status === 413) throw new AppError('حجم داده‌ها بیش از ظرفیت این مخزن است؛ فایل اصلی تغییر نکرده است.', undefined, 413);
		throw new AppError('مخزن PostgreSQL در دسترس نیست یا پیکربندی آن معتبر نیست.', undefined, 503);
	}
	throw error;
}

export async function readSnapshotStore(file: string, adapter: SnapshotClient): Promise<{ raw: unknown; revision: number; marker: StoreMarker }> {
	const marker = await readMarker(file);
	if (!marker || marker.state !== 'complete') throw new AppError('انتقال داده‌ها به PostgreSQL تکمیل نشده است؛ ابتدا انتقال صریح را اجرا کنید.', undefined, 503);
	try {
		const remote = await adapter.get();
		if (remote.storeId !== marker.storeId || remote.sourceHash !== marker.sourceHash) throw new AppError('شناسهٔ مخزن PostgreSQL با داده‌های محلی مطابقت ندارد.', undefined, 503);
		return { raw: remote.snapshot, revision: remote.revision, marker };
	} catch (error) { return remoteError(error); }
}

export async function writeSnapshotStore(marker: StoreMarker, revision: number, raw: unknown, adapter: SnapshotClient): Promise<void> {
	try { await adapter.update(marker.storeId, revision, raw); }
	catch (error) { remoteError(error); }
}

async function sourceSnapshot(file: string, source: StoreMarker['source'], empty: unknown): Promise<unknown> {
	if (source === 'empty') {
		try { await lstat(file); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty; throw error; }
		throw new Error('A local store file appeared after empty-store migration began; refusing to continue.');
	}
	let handle;
	try {
		const entry = await lstat(file);
		if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Store source must be a regular file, not a symlink.');
		handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) throw new Error('Store source is not a suitable regular file or is too large.');
		const text = await handle.readFile('utf8');
		if (Buffer.byteLength(text, 'utf8') > MAX_SOURCE_BYTES) throw new Error('Store source is too large.');
		return JSON.parse(text) as unknown;
	} finally { if (handle) await handle.close(); }
}

async function writeNewMarker(file: string, marker: StoreMarker): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	const destination = markerPath(file);
	const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
	let handle;
	let owned = false;
	try {
		handle = await open(temporary, 'wx', 0o600); owned = true;
		await handle.writeFile(`${JSON.stringify(marker)}\n`, 'utf8');
		await handle.sync(); await handle.close(); handle = undefined;
		// A crash before linking leaves no partial marker and no PostgreSQL write.
		await link(temporary, destination);
	} finally {
		if (handle) await handle.close();
		if (owned) await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
	}
}

async function completeMarker(file: string, marker: StoreMarker): Promise<void> {
	const destination = markerPath(file);
	const current = await readMarker(file);
	if (!current || current.state !== 'pending' || current.storeId !== marker.storeId || current.sourceHash !== marker.sourceHash || current.source !== marker.source) {
		throw new Error('Store migration marker changed; refusing to finalize.');
	}
	const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
	let handle;
	let owned = false;
	try {
		handle = await open(temporary, 'wx', 0o600); owned = true;
		await handle.writeFile(`${JSON.stringify({ ...marker, state: 'complete' })}\n`, 'utf8');
		await handle.sync(); await handle.close(); handle = undefined;
		await rename(temporary, destination);
	} finally {
		if (handle) await handle.close();
		if (owned) await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
	}
}

/** Run only under the shared Builder/media lock while all app instances are stopped. */
export async function migrateSnapshotFile(file: string, empty: unknown, validate: (raw: unknown) => void, allowEmpty: boolean, adapter: SnapshotClient): Promise<void> {
	let marker = await readMarker(file);
	let raw: unknown;
	if (marker?.state === 'complete') throw new Error('This store file has already been migrated; no data was overwritten.');
	if (!marker) {
		let source: StoreMarker['source'] = 'file';
		try { await lstat(file); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			if (!allowEmpty) throw new Error('Store source is missing; use the explicit empty-store option only for a new store.');
			source = 'empty';
		}
		raw = await sourceSnapshot(file, source, empty);
		validate(raw);
		marker = { version: 1, state: 'pending', source, storeId: randomBytes(16).toString('hex'), sourceHash: hash(raw) };
		// Fail before creating a marker if the input is too large, the service is
		// unavailable, or PostgreSQL already belongs to any existing store.
		try {
			checkSnapshotRequestSize({ storeId: marker.storeId, sourceHash: marker.sourceHash, snapshot: raw });
			await adapter.get();
			throw new AppError('مخزن PostgreSQL از پیش دارای داده است و بازنویسی نمی‌شود.', undefined, 409);
		} catch (error) {
			if (!(error instanceof BackendError && error.status === 404 && error.code === 'not_initialized')) throw error;
		}
		await writeNewMarker(file, marker);
	} else {
		raw = await sourceSnapshot(file, marker.source, empty);
		validate(raw);
		if (hash(raw) !== marker.sourceHash) throw new Error('Store source changed during an interrupted migration; refusing to overwrite either copy.');
	}
	try {
		await adapter.bootstrap(marker.storeId, marker.sourceHash, raw);
		const remote = await adapter.get();
		if (remote.storeId !== marker.storeId || remote.sourceHash !== marker.sourceHash || remote.revision !== 0) throw new Error('PostgreSQL migration state changed; refusing to finalize.');
	} catch (error) { remoteError(error); }
	const after = await sourceSnapshot(file, marker.source, empty);
	if (hash(after) !== marker.sourceHash) throw new Error('Store source changed during migration; both copies are retained and finalization is stopped.');
	await completeMarker(file, marker);
}

/** Write a point-in-time snapshot to a new private file without overwriting. */
export async function exportSnapshotFile(file: string, destination: string, validate: (raw: unknown) => void, adapter: SnapshotClient): Promise<void> {
	const output = path.resolve(destination);
	if (output === path.resolve(file) || output === markerPath(path.resolve(file))) throw new Error('The export destination must be a new, separate file.');
	const { raw } = await readSnapshotStore(file, adapter);
	validate(raw);
	const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
	let handle;
	let owned = false;
	try {
		handle = await open(temporary, 'wx', 0o600); owned = true;
		await handle.writeFile(`${JSON.stringify(raw, null, '\t')}\n`, 'utf8');
		await handle.sync(); await handle.close(); handle = undefined;
		await link(temporary, output);
	} finally {
		if (handle) await handle.close();
		if (owned) await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
	}
}
