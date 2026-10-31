import { expect, test } from '@playwright/test';

test('an unavailable Builder store does not fall back to an empty file or block unrelated CMS and shop', async ({ page }) => {
	test.skip(process.env.NOVEX_E2E_BUILDER_OUTAGE_READY !== '1', 'Requires the isolated unavailable-Builder fixture.');
	await page.goto('/cms/login');
	await page.getByLabel('نام کاربری').fill('novex-e2e-admin');
	await page.locator('#cms-password').fill('novex-e2e-password-only-for-local-tests');
	await page.getByRole('button', { name: 'ورود به پنل' }).click();
	await page.waitForURL((url) => url.pathname === '/cms');
	for (const route of ['/cms', '/cms/posts', '/cms/settings', '/shop']) expect((await page.goto(route))?.status()).toBe(200);
	await page.goto('/cms/settings');
	await expect(page.locator('[data-builder-storage]')).toContainText('PostgreSQL');
	const pages = await page.request.get('/cms/pages');
	expect(pages.status()).toBe(503); expect(pages.headers()['cache-control']).toContain('no-store');
	const publicPage = await page.request.get('/pages/unavailable');
	expect(publicPage.status()).toBe(503);
	const api = await page.request.get('/cms/api/builder/pages', { headers: { accept: 'application/json' } });
	expect(api.status()).toBe(503);
	expect(await api.json()).toMatchObject({ ok: false, code: 'storage_unavailable' });
	const attempted = await page.request.post('/cms/api/builder/pages', { headers: { accept: 'application/json' }, data: { slug: 'must-not-exist', title: 'نباید ساخته شود', templateId: 'shop-landing' } });
	expect(attempted.status()).toBe(503);
});
