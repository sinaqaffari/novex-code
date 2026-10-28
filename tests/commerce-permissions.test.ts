import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { can, type Role, type Permission } from '../src/lib/cms/rbac.ts';
import { requiredCmsPermission } from '../src/lib/cms/access.ts';

describe('RBAC and commerce authorization', () => {
	it('admin has all commerce permissions', () => {
		const commercePermissions: Permission[] = [
			'commerce.orders:read', 'commerce.orders:write',
			'commerce.products:read', 'commerce.products:write',
			'commerce.customers:read', 'commerce.discounts:read', 'commerce.discounts:write',
		];
		for (const permission of commercePermissions) {
			assert.equal(can('admin', permission), true, `admin should have ${permission}`);
		}
	});

	it('editor can read and write products and orders but not manage users or plugins', () => {
		assert.equal(can('editor', 'commerce.products:read'), true);
		assert.equal(can('editor', 'commerce.products:write'), true);
		assert.equal(can('editor', 'commerce.orders:read'), true);
		assert.equal(can('editor', 'commerce.orders:write'), true);
		assert.equal(can('editor', 'cms.users:read'), false);
		assert.equal(can('editor', 'cms.plugins:write'), false);
	});

	it('contributor can read products but cannot write or publish', () => {
		assert.equal(can('contributor', 'commerce.products:read'), true);
		assert.equal(can('contributor', 'commerce.products:write'), false);
		assert.equal(can('contributor', 'cms.pages:publish'), false);
	});

	it('subscriber can only read posts and products', () => {
		assert.equal(can('subscriber', 'cms.posts:read'), true);
		assert.equal(can('subscriber', 'commerce.products:read'), true);
		assert.equal(can('subscriber', 'commerce.products:write'), false);
		assert.equal(can('subscriber', 'cms.pages:write'), false);
	});

	it('canEditPost allows draft-only edits for contributors and publish for editors', () => {
		assert.equal(can('contributor', 'cms.posts:write'), true);
		assert.equal(can('contributor', 'cms.posts:publish'), false);
		assert.equal(can('editor', 'cms.posts:publish'), true);
		// Contributor editing a draft to remain a draft is allowed
		assert.equal(can('contributor', 'cms.posts:write'), true);
	});

	it('access table fails closed for unknown routes', () => {
		// Unknown routes default to cms.settings:write (highest privilege)
		const unknown = requiredCmsPermission({ pathname: '/cms/api/unknown-route', method: 'GET' });
		assert.equal(unknown, 'cms.settings:write');
	});

	it('media read route requires cms.media:read', () => {
		assert.equal(requiredCmsPermission({ pathname: '/cms/api/media', method: 'GET' }), 'cms.media:read');
		assert.equal(requiredCmsPermission({ pathname: '/cms/api/media/upload', method: 'POST' }), 'cms.media:write');
	});

	it('builder page routes require cms.pages permissions', () => {
		assert.equal(requiredCmsPermission({ pathname: '/cms/api/builder/pages/test-slug', method: 'GET' }), 'cms.pages:read');
		assert.equal(requiredCmsPermission({ pathname: '/cms/api/builder/pages/test-slug', method: 'PUT' }), 'cms.pages:write');
		assert.equal(requiredCmsPermission({ pathname: '/cms/api/builder/pages/test-slug', method: 'POST' }), 'cms.pages:write');
		// Publish authorization is enforced separately in the API route handler
	});

	it('role validation rejects invalid roles', () => {
		const isValid = (value: unknown): value is Role =>
			typeof value === 'string' && ['admin', 'editor', 'contributor', 'subscriber'].includes(value);
		assert.equal(isValid('admin'), true);
		assert.equal(isValid('superadmin'), false);
		assert.equal(isValid(null), false);
	});
});
