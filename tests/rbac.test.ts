/**
 * تست‌های RBAC — controllo دسترسی بر اساس نقش.
 * اجرا: `node --test tests/rbac.test.ts`
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	hasPermission,
	can,
	canEditPost,
	isRole,
	ROLE_PERMISSIONS,
	ROLE_OPTIONS,
	type Role,
	type Permission,
} from '../src/lib/cms/rbac.ts';
import { requiredCmsPermission } from '../src/lib/cms/access.ts';

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

	it('contributor can write drafts but cannot publish, delete, or read customer orders', () => {
		assert.strictEqual(hasPermission('contributor', 'cms.posts:write'), true);
		assert.strictEqual(hasPermission('contributor', 'cms.posts:publish'), false);
		assert.strictEqual(hasPermission('contributor', 'cms.posts:delete'), false);
		assert.strictEqual(hasPermission('contributor', 'commerce.orders:read'), false);
	});

	it('prevents contributors from changing published posts or publishing drafts', () => {
		assert.equal(canEditPost('contributor', true, true), true);
		assert.equal(canEditPost('contributor', true, false), false);
		assert.equal(canEditPost('contributor', false, true), false);
		assert.equal(canEditPost('editor', false, true), true);
	});

	it('editor can publish but not manage users', () => {
		assert.strictEqual(hasPermission('editor', 'cms.posts:publish'), true);
		assert.strictEqual(hasPermission('editor', 'cms.users:write'), false);
		assert.strictEqual(hasPermission('editor', 'cms.plugins:write'), false);
	});

	it('unknown role returns false and is rejected by role validation', () => {
		assert.strictEqual(hasPermission('guest' as Role, 'cms.posts:read'), false);
		assert.strictEqual(isRole('guest'), false);
		assert.strictEqual(isRole('admin'), true);
	});

	it('limits media deletion, settings, and discount controls by capability', () => {
		assert.equal(can('editor', 'cms.media:write'), true);
		assert.equal(can('editor', 'cms.media:delete'), false);
		assert.equal(can('contributor', 'cms.media:read'), true);
		assert.equal(can('contributor', 'cms.media:write'), false);
		assert.equal(can('editor', 'cms.settings:write'), false);
		assert.equal(can('editor', 'commerce.discounts:write'), false);
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

describe('CMS route authorization', () => {
	it('distinguishes list reads from sensitive edit/detail pages', () => {
		const postList = requiredCmsPermission({ pathname: '/cms/posts', method: 'GET' });
		const postListSlash = requiredCmsPermission({ pathname: '/cms/posts/', method: 'GET' });
		const postEditor = requiredCmsPermission({ pathname: '/cms/posts/post-1', method: 'GET' });
		const orderList = requiredCmsPermission({ pathname: '/cms/orders', method: 'GET' });
		const orderListSlash = requiredCmsPermission({ pathname: '/cms/orders/', method: 'GET' });
		const orderDetail = requiredCmsPermission({ pathname: '/cms/orders/NVX-1', method: 'GET' });
		const customerList = requiredCmsPermission({ pathname: '/cms/customers', method: 'GET' });
		assert.equal(postList, 'cms.posts:read');
		assert.equal(postListSlash, 'cms.posts:read');
		assert.equal(postEditor, 'cms.posts:write');
		assert.equal(orderList, 'commerce.orders:read');
		assert.equal(orderListSlash, 'commerce.orders:read');
		assert.equal(orderDetail, 'commerce.orders:write');
		assert.equal(customerList, 'commerce.customers:read');
		assert.equal(can('subscriber', orderList!), false);
		assert.equal(can('contributor', orderList!), false);
		assert.equal(can('subscriber', customerList!), false);
	});

	it('applies plugin read/write authorization to every nested plugin API route', () => {
		assert.equal(
			requiredCmsPermission({ pathname: '/cms/api/plugins/content-audit/audit', method: 'GET' }),
			'cms.plugins:read',
		);
		assert.equal(
			requiredCmsPermission({ pathname: '/cms/api/plugins/content-audit/audit', method: 'POST' }),
			'cms.plugins:write',
		);
		assert.equal(can('editor', 'cms.plugins:read'), false);
		assert.equal(can('admin', 'cms.plugins:write'), true);
	});

	it('uses action-specific delete permission and keeps media upload separate', () => {
		assert.equal(
			requiredCmsPermission({ pathname: '/cms/api/posts/post-1', method: 'POST', action: 'delete' }),
			'cms.posts:delete',
		);
		assert.equal(
			requiredCmsPermission({ pathname: '/cms/api/media/upload', method: 'POST' }),
			'cms.media:write',
		);
		assert.equal(
			requiredCmsPermission({ pathname: '/cms/api/media/image.png', method: 'DELETE' }),
			'cms.media:delete',
		);
	});

	it('restricts sensitive management pages and fails closed for new routes', () => {
		assert.equal(requiredCmsPermission({ pathname: '/cms/settings', method: 'GET' }), 'cms.settings:write');
		assert.equal(requiredCmsPermission({ pathname: '/cms/discounts', method: 'GET' }), 'commerce.discounts:write');
		assert.equal(requiredCmsPermission({ pathname: '/cms/media', method: 'GET' }), 'cms.media:write');
		assert.equal(requiredCmsPermission({ pathname: '/cms/media/file/image.png', method: 'GET' }), 'cms.media:read');
		assert.equal(
			requiredCmsPermission({ pathname: '/cms/unmapped-sensitive-route', method: 'GET' }),
			'cms.settings:write',
		);
		assert.equal(
			requiredCmsPermission({ pathname: '/cms/unmapped-sensitive-route', method: 'POST' }),
			'cms.settings:write',
		);
		assert.equal(requiredCmsPermission({ pathname: '/cms/api/logout', method: 'POST' }), null);
	});
});
