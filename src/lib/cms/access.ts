/**
 * Central CMS route authorization. Every route under /cms is private in middleware;
 * this table additionally applies read/write/delete capabilities and fails closed
 * for an unmapped route.
 */

import type { Permission } from './rbac.ts';

interface CmsRouteRule {
	prefix: string;
	exact?: boolean;
	read: Permission | null;
	write?: Permission | null;
	delete?: Permission | null;
}

const RULES: CmsRouteRule[] = [
	{ prefix: '/cms/api/logout', exact: true, read: null, write: null },
	{ prefix: '/cms/api/login', exact: true, read: null, write: null },
	{ prefix: '/cms/api/preview', exact: true, read: 'cms.posts:read', write: 'cms.posts:write' },
	{ prefix: '/cms/api/media/upload', exact: true, read: 'cms.media:read', write: 'cms.media:write' },
	{ prefix: '/cms/posts/new', exact: true, read: 'cms.posts:write' },
	{ prefix: '/cms/posts/', read: 'cms.posts:write', write: 'cms.posts:write', delete: 'cms.posts:delete' },
	{ prefix: '/cms/products/new', exact: true, read: 'commerce.products:write' },
	{ prefix: '/cms/products/', read: 'commerce.products:write', write: 'commerce.products:write' },
	{ prefix: '/cms/orders/', read: 'commerce.orders:write', write: 'commerce.orders:write' },
	{ prefix: '/cms/api/users', read: 'cms.users:read', write: 'cms.users:write' },
	{ prefix: '/cms/users', read: 'cms.users:read', write: 'cms.users:write' },
	{ prefix: '/cms/api/plugins', read: 'cms.plugins:read', write: 'cms.plugins:write' },
	{ prefix: '/cms/plugins', read: 'cms.plugins:read', write: 'cms.plugins:write' },
	{ prefix: '/cms/api/settings', read: 'cms.settings:read', write: 'cms.settings:write' },
	{ prefix: '/cms/settings', read: 'cms.settings:write', write: 'cms.settings:write' },
	{ prefix: '/cms/api/builder', read: 'cms.pages:read', write: 'cms.pages:write' },
	{ prefix: '/cms/builder', read: 'cms.pages:read', write: 'cms.pages:write' },
	{ prefix: '/cms/pages', read: 'cms.pages:read', write: 'cms.pages:write' },
	{ prefix: '/cms/api/posts', read: 'cms.posts:read', write: 'cms.posts:write', delete: 'cms.posts:delete' },
	{ prefix: '/cms/posts', read: 'cms.posts:read', write: 'cms.posts:write', delete: 'cms.posts:delete' },
	{ prefix: '/cms/api/media', read: 'cms.media:read', write: 'cms.media:delete', delete: 'cms.media:delete' },
	{ prefix: '/cms/media/file', read: 'cms.media:read' },
	{ prefix: '/cms/media', read: 'cms.media:write', write: 'cms.media:write', delete: 'cms.media:delete' },
	{ prefix: '/cms/api/products', read: 'commerce.products:read', write: 'commerce.products:write' },
	{ prefix: '/cms/products', read: 'commerce.products:read', write: 'commerce.products:write' },
	{ prefix: '/cms/api/orders', read: 'commerce.orders:read', write: 'commerce.orders:write' },
	{ prefix: '/cms/orders', read: 'commerce.orders:read', write: 'commerce.orders:write' },
	{ prefix: '/cms/api/discounts', read: 'commerce.discounts:read', write: 'commerce.discounts:write' },
	{ prefix: '/cms/discounts', read: 'commerce.discounts:write', write: 'commerce.discounts:write' },
	{ prefix: '/cms/customers', read: 'commerce.customers:read' },
	{ prefix: '/cms/reports', read: 'commerce.orders:read' },
	{ prefix: '/cms/search', exact: true, read: 'commerce.orders:read' },
	{ prefix: '/cms/language', read: 'cms.settings:read', write: 'cms.settings:write' },
	{ prefix: '/cms', exact: true, read: 'commerce.orders:read', write: 'commerce.orders:write' },
];

function matches(pathname: string, rule: CmsRouteRule): boolean {
	if (rule.exact) return pathname === rule.prefix;
	if (rule.prefix.endsWith('/')) {
		return pathname.length > rule.prefix.length && pathname.startsWith(rule.prefix);
	}
	return pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`);
}

export function requiredCmsPermission(input: {
	pathname: string;
	method: string;
	action?: string | null;
}): Permission | null {
	const pathname = input.pathname.split('?')[0] || '/';
	const rule = RULES
		.filter((candidate) => matches(pathname, candidate))
		.sort((a, b) => b.prefix.length - a.prefix.length)[0];

	// New CMS routes must opt into an explicit role permission before being exposed.
	if (!rule) return 'cms.settings:write';

	const method = input.method.toUpperCase();
	if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return rule.read;
	if (method === 'DELETE' || input.action === 'delete') {
		if (rule.delete !== undefined) return rule.delete;
		if (rule.write !== undefined) return rule.write;
		return 'cms.settings:write';
	}
	return rule.write !== undefined ? rule.write : 'cms.settings:write';
}
