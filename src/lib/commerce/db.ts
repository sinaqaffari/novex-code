/**
 * The default commerce store remains file-backed; writes use atomic rename.
 * An explicit offline migration can instead opt into Go/PostgreSQL snapshots.
 * Both modes retain the shared Builder/media filesystem lock: all cooperating
 * processes must share that filesystem, and it is not distributed fencing.
 * COMMERCE_DB_FILE identifies the original file and its migration marker.
 * Corrupt, missing-marker or unreachable migrated data is never reset silently.
 */

import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { AppError } from '../errors.ts';
import path from 'node:path';
import type { Database } from './types.ts';
import { assertFileStoreNotMigrated, exportCommerceFile, migrateCommerceFile, readPostgresCommerce, writePostgresCommerce } from './postgres.ts';

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');
export const DB_FILE = path.resolve(process.env.COMMERCE_DB_FILE || path.join(DEFAULT_DATA_DIR, 'commerce.json'));

export const newId = (prefix: string) =>
	`${prefix}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

/** Empty initial state — the storefront must not publish invented catalog or sales records. */
export function createEmptyDatabase(): Database {
	return {
		version: 1,
		counters: { order: 0 },
		products: [],
		orders: [],
		customers: [],
		discounts: [],
	};
}

function normalize(raw: unknown): Database {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error('Commerce data must be a JSON object.');
	}

	const value = raw as Partial<Database>;
	for (const key of ['products', 'orders', 'customers', 'discounts'] as const) {
		if (!Array.isArray(value[key])) {
			throw new Error(`Commerce data field "${key}" must be an array.`);
		}
	}
	if (!value.counters || typeof value.counters !== 'object' || Array.isArray(value.counters)) {
		throw new Error('Commerce data counters are missing or invalid.');
	}
	const version = Number(value.version);
	if (!Number.isSafeInteger(version) || version < 1) {
		throw new Error('Commerce data version is missing or invalid.');
	}

	const orderCounter = value.counters.order;
	if (!Number.isSafeInteger(orderCounter) || orderCounter < 0) {
		throw new Error('Commerce order counter must be a non-negative safe integer.');
	}

	return {
		version,
		counters: { order: orderCounter },
		products: value.products as Database['products'],
		orders: value.orders as Database['orders'],
		customers: value.customers as Database['customers'],
		discounts: value.discounts as Database['discounts'],
	};
}

async function writeDatabase(db: Database): Promise<void> {
	await mkdir(path.dirname(DB_FILE), { recursive: true });
	const temporary = `${DB_FILE}.${process.pid}.${randomUUID()}.tmp`;
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	let owned = false;
	try {
		const existing = await lstat(DB_FILE);
		if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('Commerce database is not a regular file.');
		handle = await open(temporary, 'wx', existing.mode & 0o777); owned = true;
		await handle.writeFile(`${JSON.stringify(db, null, '\t')}\n`, 'utf8');
		await handle.close(); handle = undefined;
		await rename(temporary, DB_FILE);
	} finally {
		if (handle) await handle.close();
		if (owned) await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
	}
}

/** An initial read must never replace a database concurrently created by a
 * different process. The staged inode is linked only if the target is absent. */
async function createInitialDatabase(db: Database): Promise<boolean> {
	await mkdir(path.dirname(DB_FILE), { recursive: true });
	const temporary = `${DB_FILE}.${process.pid}.${randomUUID()}.init`;
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	let owned = false;
	try {
		handle = await open(temporary, 'wx', 0o600); owned = true;
		await handle.writeFile(`${JSON.stringify(db, null, '\t')}\n`, 'utf8');
		await handle.close(); handle = undefined;
		try { await link(temporary, DB_FILE); return true; }
		catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
	} finally {
		if (handle) await handle.close();
		if (owned) await unlink(temporary);
	}
}

async function readPersistedDatabase(): Promise<Database> {
	const raw = await readFile(DB_FILE, 'utf8');
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Commerce data at ${DB_FILE} is not valid JSON; refusing to reset it.`, { cause: error });
	}
	return normalize(parsed);
}

let initialization: Promise<Database> | null = null;

function storeMode(): 'file' | 'postgres' {
	const mode = process.env.NOVEX_COMMERCE_STORE ?? 'file';
	if (mode !== 'file' && mode !== 'postgres') throw new AppError('تنظیم مخزن فروشگاه معتبر نیست.', undefined, 503);
	return mode;
}

export async function readDatabase(): Promise<Database> {
	if (storeMode() === 'postgres') return normalize((await readPostgresCommerce(DB_FILE)).raw);
	await assertFileStoreNotMigrated(DB_FILE);
	try {
		return await readPersistedDatabase();
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
	}

	if (!initialization) {
		initialization = (async () => {
			// Recheck after entering the shared initializer in case another process
			// created the file between the first read and this one.
			try {
				return await readPersistedDatabase();
			} catch (error) {
				if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
				const empty = createEmptyDatabase();
				return await createInitialDatabase(empty) ? empty : readPersistedDatabase();
			}
		})();
	}

	const pending = initialization;
	try {
		return await pending;
	} finally {
		if (initialization === pending) initialization = null;
	}
}

let queue: Promise<unknown> = Promise.resolve();

/** Serialized read, modify, write cycle under the shared asset lock. */
export function updateDatabase<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
	const run = async () => {
		const { BuilderStoreError, withBuilderAssetLock } = await import('../builder/store.ts');
		try {
			return await withBuilderAssetLock(async () => {
				if (storeMode() === 'postgres') {
					const persisted = await readPostgresCommerce(DB_FILE);
					const db = normalize(persisted.raw);
					const result = await mutator(db);
					// Keep legacy extension fields on both the root and counters. The
					// existing domain owns the standard fields and all array elements.
					const source = persisted.raw as Record<string, unknown>;
					const counters = source.counters as Record<string, unknown>;
					await writePostgresCommerce(persisted.marker, persisted.revision, { ...source, ...db, counters: { ...counters, ...db.counters } });
					return result;
				}
				const db = await readDatabase();
				const result = await mutator(db);
				await writeDatabase(db);
				return result;
			});
		} catch (error) {
			if (error instanceof BuilderStoreError) throw new AppError(error.message, undefined, error.status);
			throw error;
		}
	};

	const next = queue.then(run, run);
	queue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

/** Explicit offline import; never modifies or removes the original JSON file. */
export async function migrateCommerceToPostgres(options: { allowEmpty?: boolean } = {}): Promise<void> {
	const { BuilderStoreError, withBuilderAssetLock } = await import('../builder/store.ts');
	try {
		await withBuilderAssetLock(() => migrateCommerceFile(DB_FILE, createEmptyDatabase(), (raw) => { normalize(raw); }, options.allowEmpty === true));
	} catch (error) {
		if (error instanceof BuilderStoreError) throw new AppError(error.message, undefined, error.status);
		throw error;
	}
}

/** Export one consistent PostgreSQL snapshot to a new private file. Never overwrites. */
export async function exportPostgresCommerce(destination: string): Promise<void> {
	if (storeMode() !== 'postgres') throw new AppError('برای خروجی‌گرفتن، مخزن PostgreSQL باید صریحاً فعال باشد.', undefined, 503);
	await exportCommerceFile(DB_FILE, destination, (raw) => { normalize(raw); });
}
