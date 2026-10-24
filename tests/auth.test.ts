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
});
