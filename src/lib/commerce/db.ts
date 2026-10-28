/**
 * Single-process, filesystem-backed commerce store.
 *
 * Writes are serialized within this Node process and committed by atomic rename.
 * This is suitable for a single-instance local deployment; it is not a
 * cross-process transaction store. The path can be overridden for isolated
 * integration tests with COMMERCE_DB_FILE. A missing file initializes empty —
 * corrupt or unreadable data is never silently replaced.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Database } from './types.ts';

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
	await writeFile(temporary, `${JSON.stringify(db, null, '\t')}\n`, 'utf8');
	await rename(temporary, DB_FILE);
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

export async function readDatabase(): Promise<Database> {
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
				await writeDatabase(empty);
				return empty;
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

/** Serialized read, modify, write cycle within this process. */
export function updateDatabase<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
	const run = async () => {
		const db = await readDatabase();
		const result = await mutator(db);
		await writeDatabase(db);
		return result;
	};

	const next = queue.then(run, run);
	queue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}
