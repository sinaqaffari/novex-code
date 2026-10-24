/**
 * مدیریت کاربران پنل — ذخیره در `data/users.json` (همان الگو التجارة).
 * هر کاربر یک نقش RBAC دارد و می‌تواند ورود/خروج کند.
 *
 * در نسخه Starter Kit، مدیریت کاربران از طریق پنل `/cms/users` انجام می‌شود
 * و فقط مدیر می‌تواند کاربر بسازد/حذف کند.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashPassword, verifyPassword } from './auth.ts';
import type { Role } from './rbac';

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
	if (!raw || typeof raw !== 'object') return { ...EMPTY, users: [] };
	const value = raw as Partial<UserDb>;
	return {
		version: 1,
		users: Array.isArray(value.users)
			? value.users.filter((u): u is User => Boolean(u && u.id && u.username))
			: [],
	};
}

async function readUsers(): Promise<UserDb> {
	try {
		return normalize(JSON.parse(await readFile(USERS_FILE, 'utf8')));
	} catch {
		const seeded = { ...EMPTY, users: [DEFAULT_USER] };
		await writeUsers(seeded);
		return seeded;
	}
}

let queue: Promise<unknown> = Promise.resolve();

async function writeUsers(db: UserDb): Promise<void> {
	await mkdir(path.dirname(USERS_FILE), { recursive: true });
	const temporary = `${USERS_FILE}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(db, null, '\t')}\n`, 'utf8');
	await rename(temporary, USERS_FILE);
}

export async function updateUsers<T>(
	mutate: (db: UserDb) => T | Promise<T>,
): Promise<T> {
	const run = async () => {
		const current = await readUsers();
		const draft = structuredClone(current);
		const result = await mutate(draft);
		await writeUsers(draft);
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
		db.users.push({
			id: 'usr_admin',
			username: envUsername,
			passwordHash,
			role: 'admin',
			isActive: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});
	});
}
