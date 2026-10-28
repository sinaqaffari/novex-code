/**
 * تست‌های احراز هویت — auth و users.
 * اجرا: `node --test tests/auth.test.ts`
 * نکته: فایل data/users.json را برای تست‌ها تغییر می‌دهد و بعداً بازمی‌گرداند.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { hashPassword, verifyPassword } from '../src/lib/cms/auth.ts';
import {
	createUser,
	getUserByUsername,
	updateUser,
	deleteUser,
	ensureDefaultAdmin,
	listUsers,
} from '../src/lib/cms/users.ts';

import * as fs from 'node:fs';
import * as path from 'node:path';

const BACKUP = path.join(process.cwd(), 'data/users.json.bak');
const USERS = path.join(process.cwd(), 'data/users.json');

beforeEach(() => {
	// بک‌آپ فایل کاربران فعلی (اگر وجود دارد)
	if (fs.existsSync(USERS)) {
		fs.copyFileSync(USERS, BACKUP);
	}
	// حذف فایل برای شروع تازه
	if (fs.existsSync(USERS)) {
		fs.rmSync(USERS);
	}
});

afterEach(() => {
	// بازگردانی فایل قبلی
	if (fs.existsSync(BACKUP)) {
		fs.copyFileSync(BACKUP, USERS);
		fs.rmSync(BACKUP);
	} else if (fs.existsSync(USERS)) {
		fs.rmSync(USERS);
	}
});

describe('Auth — password hashing', () => {
	it('hashes and verifies correctly', () => {
		const hash = hashPassword('raaz-1234');
		assert.ok(hash.startsWith('scrypt:'));
		assert.strictEqual(verifyPassword(hash, 'raaz-1234'), true);
		assert.strictEqual(verifyPassword(hash, 'wrong'), false);
	});

	it('rejects invalid hash format', () => {
		assert.strictEqual(verifyPassword('not-a-hash', 'anything'), false);
		assert.strictEqual(verifyPassword('scrypt:bad', 'anything'), false);
	});
});

describe('Users — CRUD', () => {
	it('creates and finds a user', async () => {
		const user = await createUser({ username: 'sara', password: 'pass123', role: 'editor' });
		assert.strictEqual(user.username, 'sara');
		assert.strictEqual(user.role, 'editor');
		assert.ok(user.id.startsWith('usr_'));

		const found = await getUserByUsername('sara');
		assert.ok(found);
		assert.strictEqual(found?.username, 'sara');
		assert.strictEqual(found?.role, 'editor');
		assert.ok(found?.passwordHash.startsWith('scrypt:'));
	});

	it('rejects duplicate username', async () => {
		await createUser({ username: 'amir', password: 'pass123' });
		await assert.rejects(
			createUser({ username: 'amir', password: 'pass456' }),
			/قبلاً استفاده شده است/
		);
	});

	it('initializes a missing user store once under concurrent first reads', async () => {
		const records = await Promise.all(
			Array.from({ length: 32 }, () => getUserByUsername('admin')),
		);
		assert.ok(records.every((user) => user?.username === 'admin'));

		const stored = JSON.parse(fs.readFileSync(USERS, 'utf8')) as { users: Array<{ id: string }> };
		assert.equal(stored.users.length, 1);
		assert.equal(stored.users[0].id, 'usr_admin');
		assert.deepEqual(
			fs.readdirSync(path.dirname(USERS)).filter((file) => file.startsWith('users.json.') && file.endsWith('.tmp')),
			[],
		);
	});

	it('rejects unknown roles before writing user data', async () => {
		await assert.rejects(
			createUser({ username: 'invalid-role', password: 'pass123', role: 'owner' as never }),
			/نقش کاربر معتبر نیست/
		);
		assert.strictEqual(fs.existsSync(USERS), false);
	});

	it('uses a configured admin username without duplicating the placeholder account', async () => {
		const prior = {
			username: process.env.CMS_USERNAME,
			password: process.env.CMS_PASSWORD,
			passwordHash: process.env.CMS_PASSWORD_HASH,
		};
		process.env.CMS_USERNAME = 'arena-custom-admin';
		process.env.CMS_PASSWORD = 'secure-test-password';
		delete process.env.CMS_PASSWORD_HASH;
		try {
			await ensureDefaultAdmin();
			const users = JSON.parse(fs.readFileSync(USERS, 'utf8')).users as Array<{ id: string; username: string }>;
			assert.equal(users.length, 1);
			assert.equal(users[0].username, 'arena-custom-admin');
			assert.equal(users[0].id, 'usr_admin');
			assert.equal(new Set(users.map((user) => user.id)).size, users.length);
		} finally {
			if (prior.username === undefined) delete process.env.CMS_USERNAME;
			else process.env.CMS_USERNAME = prior.username;
			if (prior.password === undefined) delete process.env.CMS_PASSWORD;
			else process.env.CMS_PASSWORD = prior.password;
			if (prior.passwordHash === undefined) delete process.env.CMS_PASSWORD_HASH;
			else process.env.CMS_PASSWORD_HASH = prior.passwordHash;
		}
	});

	it('updates user role and password', async () => {
		const user = await createUser({ username: 'negin', password: 'oldpass', role: 'contributor' });
		const updated = await updateUser(user.id, { role: 'admin', password: 'newpass' });
		assert.strictEqual(updated.role, 'admin');

		const found = await getUserByUsername('negin');
		assert.ok(found);
		assert.strictEqual(found.role, 'admin');
	});

	it('lists all users', async () => {
		await createUser({ username: 'u1', password: 'p1', role: 'subscriber' });
		await createUser({ username: 'u2', password: 'p2', role: 'editor' });
		const all = await listUsers();
		assert.ok(all.length >= 2);
		assert.ok(all.some((u) => u.username === 'u1'));
		assert.ok(all.some((u) => u.username === 'u2'));
		// passwordHash should be masked
		for (const u of all) {
			assert.strictEqual(u.passwordHash, '[redacted]');
		}
	});

	it('deletes a user', async () => {
		const user = await createUser({ username: 'temp', password: 'p', role: 'subscriber' });
		await deleteUser(user.id);
		const found = await getUserByUsername('temp');
		assert.strictEqual(found, null);
	});

	it('preserves malformed or structurally invalid existing user data', async () => {
		const validRecord = {
			id: 'usr_duplicate',
			username: 'first',
			passwordHash: 'scrypt:salt:hash',
			role: 'admin',
			isActive: true,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		};
		for (const contents of [
			'{"version":1,"users":[',
			'{"version":1,"users":[{"id":"usr_broken"}]}',
			JSON.stringify({ version: 1, users: [validRecord, { ...validRecord, username: 'second' }] }),
		]) {
			fs.writeFileSync(USERS, contents, 'utf8');
			await assert.rejects(getUserByUsername('admin'));
			assert.strictEqual(fs.readFileSync(USERS, 'utf8'), contents);
		}
	});
});
