/**
 * تست‌های RBAC — controllo دسترسی بر اساس نقش.
 * اجرا: `node --test tests/rbac.test.ts`
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	hasPermission,
	can,
	ROLE_PERMISSIONS,
	ROLE_OPTIONS,
	type Role,
	type Permission,
} from '../src/lib/cms/rbac.ts';

describe('RBAC — hasPermission', () => {
	it('admin has all core permissions', () => {
		const core: Permission[] = [
			'cms.posts:read',
			'cms.posts:write',
			'cms.posts:publish',
			'cms.posts:delete',
			'cms.media:read',
			'cms.media:write',
			'cms.settings:read',
			'cms.settings:write',
			'cms.plugins:read',
			'cms.plugins:write',
			'cms.users:read',
			'cms.users:write',
			'commerce.orders:read',
			'commerce.orders:write',
			'commerce.products:read',
			'commerce.products:write',
		];
		for (const perm of core) {
			assert.strictEqual(hasPermission('admin', perm), true);
		}
	});

	it('subscriber cannot write posts', () => {
		assert.strictEqual(hasPermission('subscriber', 'cms.posts:write'), false);
		assert.strictEqual(hasPermission('subscriber', 'cms.posts:publish'), false);
		assert.strictEqual(hasPermission('subscriber', 'cms.settings:write'), false);
	});

	it('contributor cannot publish', () => {
		assert.strictEqual(hasPermission('contributor', 'cms.posts:write'), true);
		assert.strictEqual(hasPermission('contributor', 'cms.posts:publish'), false);
		assert.strictEqual(hasPermission('contributor', 'cms.posts:delete'), false);
	});

	it('editor can publish but not manage users', () => {
		assert.strictEqual(hasPermission('editor', 'cms.posts:publish'), true);
		assert.strictEqual(hasPermission('editor', 'cms.users:write'), false);
		assert.strictEqual(hasPermission('editor', 'cms.plugins:write'), false);
	});

	it('unknown role returns false', () => {
		assert.strictEqual(hasPermission('guest' as Role, 'cms.posts:read'), false);
	});
});

describe('RBAC — can (alias)', () => {
	it('matches hasPermission', () => {
		assert.strictEqual(can('admin', 'cms.posts:delete'), true);
		assert.strictEqual(can('subscriber', 'cms.posts:delete'), false);
	});
});

describe('RBAC — role options', () => {
	it('has 4 roles with labels', () => {
		assert.strictEqual(ROLE_OPTIONS.length, 4);
		for (const opt of ROLE_OPTIONS) {
			assert.ok(opt.value);
			assert.ok(opt.label);
			assert.ok(opt.label.length > 0);
		}
	});

	it('all roles defined in ROLE_PERMISSIONS', () => {
		for (const opt of ROLE_OPTIONS) {
			assert.ok(opt.value in ROLE_PERMISSIONS);
		}
	});
});
