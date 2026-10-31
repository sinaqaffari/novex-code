import { expect, test, type Page } from '@playwright/test';
import { addNode } from '../../src/lib/builder/operations.ts';

const hasTestBackend = Boolean(process.env.NOVEX_E2E_BACKEND_URL && process.env.NOVEX_E2E_BACKEND_TOKEN);

async function signIn(page: Page) {
	await page.goto('/cms/login');
	await page.getByLabel('نام کاربری').fill('novex-e2e-admin');
	await page.locator('#cms-password').fill('novex-e2e-password-only-for-local-tests');
	await page.getByRole('button', { name: 'ورود به پنل' }).click();
	await page.waitForURL((url) => url.pathname === '/cms');
}

async function publishRestaurant(page: Page, slug: string, withSecondForm = false) {
	const created = await page.request.post('/cms/api/builder/pages', { headers: { accept: 'application/json' }, data: { slug, title: 'رستوران آزمایشی', templateId: 'restaurant-landing' } });
	expect(created.status()).toBe(201);
	const draft = await created.json();
	const document = withSecondForm ? addNode(draft.document, 'InquiryForm', { id: 'node_secondform1' }) : draft.document;
	const published = await page.request.post(`/cms/api/builder/pages/${slug}`, { headers: { accept: 'application/json' }, data: { document, expectedRevision: draft.revision } });
	expect(published.status()).toBe(200);
}

test('the editor and published form clearly report when the Go service is not configured', async ({ page }) => {
	test.skip(hasTestBackend, 'This case verifies the explicitly unconfigured mode.');
	const slug = `form-off-${Date.now().toString(36)}`;
	await page.goto('/marketplace/restaurant-landing/preview');
	await expect(page.locator('.nvx-inquiry')).toContainText('پیش‌نمایش فرم');
	await expect(page.locator('.nvx-inquiry input[name="name"]')).toBeDisabled();
	await signIn(page);
	await publishRestaurant(page, slug);
	await page.goto(`/cms/builder/${slug}`);
	await expect(page.getByTestId('builder-canvas').locator('.nvx-inquiry')).toContainText('پیش‌نمایش فرم');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('.nvx-inquiry')).toContainText('سرویس ثبت درخواست پیکربندی نشده است');
	await expect(page.locator('.nvx-inquiry button[type="submit"]')).toBeDisabled();
	await page.setViewportSize({ width: 320, height: 844 });
	const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
	expect(size.content).toBeLessThanOrEqual(size.width + 1);
});

test('a published form reaches PostgreSQL and is managed through the protected inbox', async ({ page }) => {
	test.skip(!hasTestBackend, 'Requires an explicitly isolated NOVEX_E2E_BACKEND_URL and token.');
	const slug = `form-on-${Date.now().toString(36)}`;
	const name = `بازدیدکنندهٔ آزمایشی ${Date.now()}`;
	await signIn(page);
	await publishRestaurant(page, slug, true);
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('.nvx-inquiry')).toHaveCount(2);
	const firstId = await page.locator('.nvx-inquiry').first().getAttribute('data-builder-id');
	expect(firstId).toBeTruthy();
	await expect(page.locator(`[id="${firstId}"]`)).toHaveCount(1);
	const form = page.locator('.nvx-inquiry').nth(1);
	await form.getByLabel('نام', { exact: true }).fill(name);
	await form.getByLabel('ایمیل یا شمارهٔ تماس').fill('playwright@example.invalid');
	await form.getByLabel('پیام', { exact: true }).fill('درخواست آزمایشی <script>window.badInquiry=1</script>');
	await form.getByRole('button', { name: 'ارسال درخواست' }).click();
	await expect(form.getByRole('status')).toContainText('درخواست شما ثبت شد');
	await expect(page).toHaveURL(/#node_secondform1$/);
	await page.goto('/cms/inquiries');
	const item = page.locator('.inquiry-card').filter({ hasText: name });
	await expect(item).toContainText('playwright@example.invalid');
	await expect(item).toContainText('<script>window.badInquiry=1</script>');
	expect(await item.locator('script').count()).toBe(0);
	expect(await page.evaluate(() => (window as Window & { badInquiry?: number }).badInquiry)).toBeUndefined();
	await item.getByRole('button', { name: 'علامت‌گذاری به‌عنوان بررسی‌شده' }).click();
	await expect(item).toContainText('بررسی‌شده');
	await item.getByRole('button', { name: 'بایگانی' }).click();
	await expect(item).toContainText('بایگانی');
	await item.getByText('حذف دائمی', { exact: true }).click();
	await item.getByLabel('حذف دائمی این درخواست را تأیید می‌کنم.').check();
	await item.getByRole('button', { name: 'حذف درخواست' }).click();
	await expect(page.locator('.inquiry-card').filter({ hasText: name })).toHaveCount(0);
});
