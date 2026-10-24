/**
 * کنترل دسترسی بر اساس نقش (RBAC) — لایه مجوزهای پنل مدیریت نووکس‌کد.
 *
 * نقش‌ها (از بالاترین به پایین‌ترین):
 *   admin   — دسترسی کامل به پنل (ساختن/حذف کاربر، تنظیمات، افزونه‌ها)
 *   editor  — ایجاد/ویرایش/پرس산ッシュ نوشته‌ها و محصولات (بدون حذف permanente)
 *   contributor — ایجاد نوشته/محصول (م청د تایید مدیر)
 *   subscriber — فقط خواندن pancreatitis
 *
 * هر مجوز یک رشته است، مثل `cms.posts:write`. افزونه‌ها می‌توانند مجوزهای سفارشی
 * تولید کنند، اما هسته فقط همین فهرست را در مدیر مجوزهای داخلی می‌پذیرد.
 */

export type Role = 'admin' | 'editor' | 'contributor' | 'subscriber';

export type Permission =
	| 'cms.posts:read'
	| 'cms.posts:write'
	| 'cms.posts:publish'
	| 'cms.posts:delete'
	| 'cms.media:read'
	| 'cms.media:write'
	| 'cms.media:delete'
	| 'cms.settings:read'
	| 'cms.settings:write'
	| 'cms.plugins:read'
	| 'cms.plugins:write'
	| 'cms.users:read'
	| 'cms.users:write'
	| 'commerce.orders:read'
	| 'commerce.orders:write'
	| 'commerce.products:read'
	| 'commerce.products:write'
	| 'commerce.customers:read'
	| 'commerce.discounts:read'
	| 'commerce.discounts:write';

/** مجوزهای پیش‌فرض هر نقش. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
	admin: [
		'cms.posts:read',
		'cms.posts:write',
		'cms.posts:publish',
		'cms.posts:delete',
		'cms.media:read',
		'cms.media:write',
		'cms.media:delete',
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
		'commerce.customers:read',
		'commerce.discounts:read',
		'commerce.discounts:write',
	],
	editor: [
		'cms.posts:read',
		'cms.posts:write',
		'cms.posts:publish',
		'cms.media:read',
		'cms.media:write',
		'cms.settings:read',
		'commerce.orders:read',
		'commerce.orders:write',
		'commerce.products:read',
		'commerce.products:write',
		'commerce.customers:read',
	],
	contributor: [
		'cms.posts:read',
		'cms.posts:write',
		'cms.media:read',
		'cms.settings:read',
		'commerce.orders:read',
		'commerce.products:read',
	],
	subscriber: ['cms.posts:read', 'commerce.products:read'],
};

/** توضیح خوانا هر نقش — برای نمایش در پنل کاربران. */
export const ROLE_LABELS: Record<Role, string> = {
	admin: 'مدیر کل',
	editor: 'ویراستار',
	contributor: 'مشارکت‌کننده',
	subscriber: 'مشترک',
};

/** بررسی اگر کاربر دارای مجوز است. */
export function hasPermission(role: Role, permission: Permission): boolean {
	return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** بررسی اگر کاربر حداقل به یک نقش در سطح مجاز دسترسی دارد. */
export function can(role: Role, permission: Permission): boolean {
	return hasPermission(role, permission);
}

/** لیست نقش‌های قابل انتخاب در فرم مدیریت کاربران. */
export const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
	{ value: 'admin', label: 'مدیر کل' },
	{ value: 'editor', label: 'ویراستار' },
	{ value: 'contributor', label: 'مشارکت‌کننده' },
	{ value: 'subscriber', label: 'مشترک' },
];
