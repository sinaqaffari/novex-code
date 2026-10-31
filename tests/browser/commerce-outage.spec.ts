import { expect, test } from '@playwright/test';

test('a PostgreSQL outage does not lock the user out of CMS content or fake empty commerce data', async ({ page }) => {
	test.skip(process.env.NOVEX_E2E_COMMERCE_OUTAGE_READY !== '1', 'Requires the isolated unavailable-backend fixture.');
	await page.goto('/cms/login');
	await page.getByLabel('نام کاربری').fill('novex-e2e-admin');
	await page.locator('#cms-password').fill('novex-e2e-password-only-for-local-tests');
	await page.getByRole('button', { name: 'ورود به پنل' }).click();
	await page.waitForURL((url) => url.pathname === '/cms');
	await expect(page.locator('[data-commerce-unavailable]')).toContainText('شمارش سفارش‌ها نامشخص است');
	await expect(page.locator('main')).toContainText('آمار فروش و موجودی خالی فرض نمی‌شود');
	for (const route of ['/cms/pages', '/cms/settings', '/cms/posts']) {
		const response = await page.goto(route);
		expect(response?.status()).toBe(200);
		await expect(page.locator('[data-commerce-unavailable]')).toBeVisible();
	}
	await page.goto('/cms/settings');
	await expect(page.locator('[data-commerce-storage]')).toContainText('PostgreSQL');
	await expect(page.locator('input[name="commerceEnabled"][type="checkbox"]')).toBeEnabled();
	const search = await page.goto('/cms/search?q=not-a-real-post');
	expect(search?.status()).toBe(200);
	await expect(page.locator('main')).toContainText('جست‌وجوی فروشگاه انجام نشد');
	const inbox = await page.goto('/cms/inquiries');
	expect(inbox?.status()).toBe(503);
	await expect(page.locator('main')).toContainText('صندوق درخواست‌ها در دسترس نیست');
	const orders = await page.request.get('/cms/orders');
	expect(orders.status()).toBe(503);
	const shop = await page.request.get('/shop');
	expect(shop.status()).toBe(503);
	const slug = `outage-${Date.now().toString(36)}`;
	const created = await page.request.post('/cms/api/builder/pages', { headers: { accept: 'application/json' }, data: { slug, title: 'صفحهٔ آزمایشی', templateId: 'shop-landing' } });
	expect(created.status()).toBe(201);
	const draft = await created.json();
	const published = await page.request.post(`/cms/api/builder/pages/${slug}`, { headers: { accept: 'application/json' }, data: { document: draft.document, expectedRevision: draft.revision } });
	expect(published.status()).toBe(200);
	const publishedPage = await page.goto(`/pages/${slug}`);
	expect(publishedPage?.status()).toBe(200);
	await expect(page.locator('.nvx-builder-product-grid [role="alert"]')).toContainText('بارگیری محصولات در حال حاضر ممکن نیست');
	const form = page.locator('.nvx-inquiry');
	const submission = await page.request.post('/api/inquiries', { headers: { accept: 'application/json' }, data: {
		slug, nodeId: await form.getAttribute('data-builder-id'), requestId: '1234567890abcdef1234567890abcdef', name: 'نام آزمایشی', contact: 'test@example.invalid', message: 'درخواست آزمایشی',
	} });
	expect(submission.status()).toBe(503);
	expect((await submission.json()).ok).toBe(false);
});
