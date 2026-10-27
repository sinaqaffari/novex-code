/**
 * مدیریت کاربران پنل — ذخیره در `data/users.json` (همان الگو التجارة).
 * هر کاربر یک نقش RBAC دارد و می‌تواند ورود/خروج کند.
 *
 * در نسخه Starter Kit، مدیریت کاربران از طریق پنل `/cms/users` انجام می‌شود
 * و فقط مدیر می‌تواند کاربر بسازد/حذف کند.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashPassword, verifyPassword } from './auth.ts';
import { isRole, type Role } from './rbac.ts';

export const USERS_FILE = path.resolve(process.cwd(), 'data/users.json');

export interface User {
	id: string;
	username: string;
	/** هش گذرواژه (scrypt:...) */
	passwordHash: string;
	role: Role;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
	lastLoginAt?: string;
}

export interface CreateUserInput {
	username: string;
	password: string;
	role?: Role;
}

export interface UpdateUserInput {
	password?: string;
	role?: Role;
	isActive?: boolean;
}

const DEFAULT_USER: User = {
	id: 'usr_admin',
	username: 'admin',
	passwordHash: '', // پر می‌شود از محیط
	role: 'admin',
	isActive: true,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
};

interface UserDb {
	version: number;
	users: User[];
}

const EMPTY: UserDb = { version: 1, users: [] };

function normalize(raw: unknown): UserDb {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error('User data must be a JSON object.');
	}
	const value = raw as Partial<UserDb>;
	if (value.version !== 1) throw new Error('Unsupported user data version.');
	if (!Array.isArray(value.users)) throw new Error('User data field "users" must be an array.');
	const ids = new Set<string>();
	const usernames = new Set<string>();
	for (const user of value.users) {
		if (
			!user ||
			typeof user !== 'object' ||
			typeof user.id !== 'string' ||
			!user.id.trim() ||
			typeof user.username !== 'string' ||
			!user.username.trim() ||
			typeof user.passwordHash !== 'string' ||
			!isRole(user.role) ||
			typeof user.isActive !== 'boolean' ||
			typeof user.createdAt !== 'string' ||
			typeof user.updatedAt !== 'string' ||
			(user.lastLoginAt !== undefined && typeof user.lastLoginAt !== 'string')
		) {
			throw new Error('User data contains an invalid user record.');
		}
		if (ids.has(user.id) || usernames.has(user.username)) {
			throw new Error('User data contains duplicate IDs or usernames.');
		}
		ids.add(user.id);
		usernames.add(user.username);
	}
	return { version: 1, users: value.users };
}

function isMissingFile(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

let initialization: Promise<void> | null = null;

async function initializeUsersFile(): Promise<void> {
	if (!initialization) {
		const pending = (async () => {
			// Recheck after joining the initializer: another request/process may have created it.
			try {
				await readFile(USERS_FILE, 'utf8');
				return;
			} catch (error) {
				if (!isMissingFile(error)) throw error;
			}

			await writeUsers({ ...EMPTY, users: [structuredClone(DEFAULT_USER)] });
		})();
		initialization = pending.finally(() => {
			initialization = null;
		});
	}
	await initialization;
}

async function readUsers(): Promise<UserDb> {
	let raw: string;
	try {
		raw = await readFile(USERS_FILE, 'utf8');
	} catch (error) {
		if (!isMissingFile(error)) throw error;
		await initializeUsersFile();
		raw = await readFile(USERS_FILE, 'utf8');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`User data at ${USERS_FILE} is not valid JSON; refusing to reset it.`, { cause: error });
	}
	return normalize(parsed);
}

let queue: Promise<unknown> = Promise.resolve();

async function writeUsers(db: UserDb): Promise<void> {
	await mkdir(path.dirname(USERS_FILE), { recursive: true });
	const temporary = `${USERS_FILE}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(db, null, '\t')}\n`, { encoding: 'utf8', mode: 0o600 });
		await rename(temporary, USERS_FILE);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => undefined);
		throw error;
	}
}

export async function updateUsers<T>(
	mutate: (db: UserDb) => T | Promise<T>,
): Promise<T> {
	const run = async () => {
		const current = await readUsers();
		const draft = structuredClone(current);
		const result = await mutate(draft);
		await writeUsers(normalize(draft));
		return result;
	};

	const next = queue.then(run, run);
	queue = next.then(() => undefined, () => undefined);
	return next;
}

export async function listUsers(): Promise<User[]> {
	const db = await readUsers();
	return db.users.map((u) => ({ ...u, passwordHash: '[redacted]' }));
}

export async function getUser(id: string): Promise<User | null> {
	const db = await readUsers();
	return db.users.find((u) => u.id === id) ?? null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
	const db = await readUsers();
	return db.users.find((u) => u.username === username) ?? null;
}

export async function createUser(input: CreateUserInput): Promise<User> {
	if (input.role !== undefined && !isRole(input.role)) throw new Error('نقش کاربر معتبر نیست.');
	const existing = await getUserByUsername(input.username);
	if (existing) throw new Error('این نام کاربری قبلاً استفاده شده است.');

	const passwordHash = hashPassword(input.password);

	const user: User = {
		id: `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
		username: input.username,
		passwordHash,
		role: input.role ?? 'contributor',
		isActive: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	await updateUsers((db) => {
		db.users.push(user);
		return user;
	});

	return user;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<User> {
	if (input.role !== undefined && !isRole(input.role)) throw new Error('نقش کاربر معتبر نیست.');
	return updateUsers((db) => {
		const user = db.users.find((u) => u.id === id);
		if (!user) throw new Error('کاربر پیدا نشد.');

		if (input.password) {
			user.passwordHash = hashPassword(input.password);
		}
		if (input.role !== undefined) user.role = input.role;
		if (input.isActive !== undefined) user.isActive = input.isActive;

		user.updatedAt = new Date().toISOString();
		return user;
	});
}

export async function deleteUser(id: string): Promise<void> {
	await updateUsers((db) => {
		const index = db.users.findIndex((u) => u.id === id);
		if (index === -1) throw new Error('کاربر پیدا نشد.');
		const target = db.users[index];
		if (target.role === 'admin') {
			const adminCount = db.users.filter((u) => u.role === 'admin' && u.isActive).length;
			if (adminCount <= 1) throw new Error('نمی‌توان آخرین مدیر فعال را حذف کرد.');
		}
		db.users.splice(index, 1);
	});
}

export async function authenticateUser(username: string, password: string): Promise<User | null> {
	const user = await getUserByUsername(username);
	if (!user || !user.isActive) return null;

	const ok = verifyPassword(user.passwordHash, password);
	if (!ok) return null;

	await updateUsers((db) => {
		const u = db.users.find((item) => item.id === user.id);
		if (u) u.lastLoginAt = new Date().toISOString();
	});

	return user;
}

export async function ensureDefaultAdmin(): Promise<void> {
	const envUsername = process.env.CMS_USERNAME ?? 'admin';
	const envPassword = process.env.CMS_PASSWORD ?? 'novex-admin';
	const envHash = process.env.CMS_PASSWORD_HASH;

	const existing = await getUserByUsername(envUsername);
	const passwordHash = envHash ?? hashPassword(envPassword);

	if (existing) {
		// اگر کاربر وجود دارد اما هش گذرواژه خالی یا نامعتبر دارد (مثلاً رکورد اولیه
		// با هش خالی ذخیره شده)، هش را از متغیر محیطی می‌سازیم تا ورود امکان‌پذیر باشد.
		if (!/^scrypt:/.test(existing.passwordHash ?? '')) {
			await updateUsers((db) => {
				const user = db.users.find((u) => u.id === existing.id);
				if (user) user.passwordHash = passwordHash;
			});
		}
		return;
	}

	await updateUsers((db) => {
		const concurrentlyCreated = db.users.find((user) => user.username === envUsername);
		if (concurrentlyCreated) {
			if (!/^scrypt:/.test(concurrentlyCreated.passwordHash)) {
				concurrentlyCreated.passwordHash = passwordHash;
				concurrentlyCreated.updatedAt = new Date().toISOString();
			}
			return;
		}

		const placeholder = db.users.find(
			(user) => user.id === 'usr_admin' && user.username === 'admin' && !user.passwordHash,
		);
		if (placeholder) {
			placeholder.username = envUsername;
			placeholder.passwordHash = passwordHash;
			placeholder.updatedAt = new Date().toISOString();
			return;
		}

		const now = new Date().toISOString();
		const id = db.users.some((user) => user.id === 'usr_admin')
			? `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
			: 'usr_admin';
		db.users.push({
			id,
			username: envUsername,
			passwordHash,
			role: 'admin',
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
	});
}
