import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
	await page.getByLabel('نام کاربری').fill('novex-e2e-admin');
	await page.locator('#cms-password').fill('novex-e2e-password-only-for-local-tests');
	await page.getByRole('button', { name: 'ورود به پنل' }).click();
}
async function noOverflow(page: Page) {
	const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
	expect(size.content).toBeLessThanOrEqual(size.width + 1);
}
const uniqueSlug = (prefix: string) => `${prefix}-${Date.now().toString(36)}`;

test('browses, searches, filters and previews real bundled templates in RTL on desktop and mobile', async ({ page }) => {
	const runtimeErrors: string[] = [];
	page.on('pageerror', (error) => runtimeErrors.push(error.message));
	await page.goto('/');
	await expect(page.locator('.home-templates .market-card')).toHaveCount(4);
	await page.getByRole('link', { name: 'دیدن طرح‌های آماده' }).click();
	await expect(page).toHaveURL(/\/marketplace$/);
	await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	await expect(page.locator('.market-card')).toHaveCount(8);
	await noOverflow(page);
	for (const width of [1280, 1024, 960, 959, 768, 390, 320]) {
		await page.setViewportSize({ width, height: 844 });
		await noOverflow(page);
	}
	await page.getByRole('link', { name: /آموزشی/ }).click();
	await expect(page).toHaveURL(/category=education/);
	await expect(page.locator('.market-card')).toHaveCount(1);
	await expect(page.locator('.market-card')).toContainText('آموزش و دوره');
	await page.getByRole('link', { name: /همه/ }).first().click();
	await page.getByLabel('جست‌وجوی قالب‌ها').fill('طرح ناموجود آزمایشی');
	await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
	await expect(page.locator('.market-card')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'طرحی با این جست‌وجو پیدا نشد' })).toBeVisible();
	await page.getByLabel('جست‌وجوی قالب‌ها').fill('كلينيك');
	await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
	await expect(page.locator('.market-card')).toHaveCount(1);
	await expect(page.locator('.market-card')).toContainText('کلینیک و سلامت');
	await page.locator('.market-card__art').click();
	await expect(page).toHaveURL(/marketplace\/clinic-landing\/preview/);
	await expect(page.locator('[data-template-preview="clinic-landing"]')).toContainText('مراقبت بهتر');
	await expect(page.locator('.nvx-page__content img[src="/media/builder-clinic.jpg"]')).toBeVisible();
	await expect(page.locator('.nvx-builder-accordion details')).toHaveCount(2);
	await page.locator('.nvx-builder-accordion summary').first().click();
	await expect(page.locator('.nvx-builder-accordion details').first()).toHaveAttribute('open', '');
	await noOverflow(page);
	for (const id of ['restaurant-landing', 'education-landing', 'beauty-landing', 'shop-landing']) {
		const response = await page.goto(`/marketplace/${id}/preview`);
		expect(response?.status(), id).toBe(200);
		await expect(page.locator(`[data-template-preview="${id}"]`)).toBeVisible();
		await expect.poll(() => page.locator('.nvx-page__content img').first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
		await noOverflow(page);
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/marketplace/restaurant-landing/preview');
	const devices = page.getByRole('group', { name: 'اندازهٔ پیش‌نمایش' });
	await devices.getByRole('button', { name: 'موبایل' }).click();
	const frame = page.frameLocator('#preview-frame');
	await expect(frame.locator('[data-template-preview="restaurant-landing"]')).toBeVisible();
	await expect(frame.locator('.nvx-builder-container[data-layout="grid"]').first()).toHaveCSS('grid-template-columns', /^\d+(\.\d+)?px$/);
	await devices.getByRole('button', { name: 'دسکتاپ' }).click();
	await expect(page.locator('[data-template-preview="restaurant-landing"]')).toBeVisible();
	const missing = await page.request.get('/marketplace/template-private/preview');
	expect(missing.status()).toBe(404);
	expect(runtimeErrors).toEqual([]);
});

test('takes an unauthenticated visitor from preview through login, template creation, edit and publication', async ({ page }) => {
	const slug = uniqueSlug('market-restaurant');
	await page.goto('/marketplace/restaurant-landing/preview');
	await page.getByRole('link', { name: 'استفاده از این طرح' }).click();
	await expect(page).toHaveURL(/\/cms\/login\?next=/);
	await signIn(page);
	await expect(page).toHaveURL(/\/cms\/pages\/new\?template=restaurant-landing/);
	await expect(page.locator('.new-page-selection')).toContainText('رستوران و کافه');
	await expect(page.getByLabel('عنوان صفحه')).toHaveValue('رستوران و کافه');
	await page.getByLabel('عنوان صفحه').fill('رستوران من');
	await page.getByLabel('نامک لاتین').fill(slug);
	await page.getByRole('button', { name: 'ساخت و ویرایش' }).click();
	await page.waitForURL((url) => url.pathname === `/cms/builder/${slug}`);
	const canvas = page.getByTestId('builder-canvas');
	await expect(canvas).toContainText('هر میز، یک خاطرهٔ تازه');
	await expect(canvas.locator('img[src="/media/builder-restaurant.jpg"]')).toBeVisible();
	const headline = canvas.getByRole('heading', { name: 'هر میز، یک خاطرهٔ تازه' });
	await headline.dblclick();
	const editor = canvas.getByRole('textbox', { name: 'ویرایش تیتر' });
	await editor.fill('طعم خانهٔ ما');
	await editor.press('Enter');
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	await page.reload();
	await expect(canvas).toContainText('طعم خانهٔ ما');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('.nvx-page__content')).toContainText('طعم خانهٔ ما');
	await expect(page.locator('.nvx-page__content img[src="/media/builder-restaurant.jpg"]')).toBeVisible();
});

test('keeps the original draft and form values when a chosen template collides with an existing slug', async ({ page }) => {
	const slug = uniqueSlug('market-collision');
	await page.goto('/cms/login');
	await signIn(page);
	await page.waitForURL((url) => url.pathname === '/cms');
	const created = await page.request.post('/cms/api/builder/pages', { headers: { accept: 'application/json' }, data: { slug, title: 'صفحهٔ اصلی', templateId: 'clinic-landing' } });
	expect(created.status()).toBe(201);
	const original = (await created.json()).document;
	await page.goto('/cms/pages/new?template=beauty-landing');
	await page.getByLabel('عنوان صفحه').fill('نباید جایگزین شود');
	await page.getByLabel('نامک لاتین').fill(slug);
	await page.getByRole('button', { name: 'ساخت و ویرایش' }).click();
	await expect(page).toHaveURL(/\/cms\/pages\/new\?/);
	await expect(page.getByRole('alert')).toHaveCount(1);
	await expect(page.getByRole('alert')).toContainText('نامک دیگری انتخاب کنید');
	await expect(page.getByLabel('نامک لاتین')).toHaveValue(slug);
	await expect(page.getByLabel('عنوان صفحه')).toHaveValue('نباید جایگزین شود');
	await expect(page.locator('.new-page-selection')).toContainText('زیبایی و مراقبت');
	const stored = await page.request.get(`/cms/api/builder/pages/${slug}`);
	expect((await stored.json()).document).toEqual(original);
});

test('activates the real section plugin, searches its palette, inserts a customized section and retains it when disabled', async ({ page }) => {
	const slug = uniqueSlug('blocks');
	await page.goto('/cms/login');
	await signIn(page);
	await page.waitForURL((url) => url.pathname === '/cms');
	await page.goto('/cms/plugins');
	const card = page.locator('[data-builder-extension="design-blocks"]');
	await expect(card).toContainText('چهار بخش');
	try {
		await card.getByRole('button', { name: 'فعال‌سازی', exact: true }).click();
		await expect(page.locator('[data-builder-extension="design-blocks"]')).toContainText('فعال');
		await page.goto('/cms/pages/new');
		await page.getByLabel('عنوان صفحه').fill('بخش آزمایشی');
		await page.getByLabel('نامک لاتین').fill(slug);
		await page.getByRole('button', { name: 'ساخت و ویرایش' }).click();
		await page.waitForURL((url) => url.pathname === `/cms/builder/${slug}`);
		await page.getByRole('group', { name: 'دستهٔ عناصر' }).getByRole('button', { name: 'افزونه‌ها' }).click();
		await page.getByLabel('جست‌وجوی عناصر صفحه').fill('بخشی که وجود ندارد');
		await expect(page.getByRole('status').filter({ hasText: 'عنصری پیدا نشد.' })).toBeVisible();
		await page.getByLabel('جست‌وجوی عناصر صفحه').fill('دعوت به اقدام');
		await page.getByRole('button', { name: /دعوت به اقدام/ }).click();
		const dialog = page.getByRole('dialog', { name: 'دعوت به اقدام' });
		await dialog.getByLabel('تیتر', { exact: true }).fill('بخش اختصاصی ما');
		await dialog.getByLabel('متن دکمه').fill('تماس');
		await dialog.getByLabel('نشانی دکمه').fill('/contact');
		await dialog.getByRole('button', { name: 'افزودن به صفحه' }).click();
		await expect(page.getByTestId('builder-canvas')).toContainText('بخش اختصاصی ما');
		await page.getByTestId('save-page').click();
		await expect(page.locator('.builder-save-state--saved')).toBeVisible();
		await page.goto('/cms/plugins');
		await page.locator('[data-builder-extension="design-blocks"]').getByRole('button', { name: 'غیرفعال‌سازی', exact: true }).click();
		await page.goto(`/cms/builder/${slug}`);
		await expect(page.getByTestId('builder-canvas')).toContainText('بخش اختصاصی ما');
		await page.getByRole('group', { name: 'دستهٔ عناصر' }).getByRole('button', { name: 'افزونه‌ها' }).click();
		await expect(page.getByRole('button', { name: /دعوت به اقدام/ })).toHaveCount(0);
		await page.getByTestId('publish-page').click();
		await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
		await page.goto(`/pages/${slug}`);
		await expect(page.locator('.nvx-page__content')).toContainText('بخش اختصاصی ما');
		await expect(page.locator('.nvx-page__content').getByRole('link', { name: 'تماس' })).toHaveAttribute('href', '/contact');
	} finally {
		await page.request.post('/cms/api/plugins', { headers: { accept: 'application/json' }, data: { pluginId: 'design-blocks', action: 'deactivate' } }).catch(() => undefined);
	}
});

test('keeps the empty shop honest while suggesting actual editable designs', async ({ page }) => {
	await page.goto('/cms/login');
	await signIn(page);
	await page.waitForURL((url) => url.pathname === '/cms');
	const change = (status: string) => page.request.post('/cms/api/products/e2e_product_internal_id?action=status', { headers: { accept: 'application/json' }, data: { status } });
	expect((await change('draft')).ok()).toBeTruthy();
	try {
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: 844 });
			await page.goto('/shop');
			await expect(page.getByRole('heading', { name: 'هنوز محصول فعالی ثبت نشده است' })).toBeVisible();
			await expect(page.locator('.product-card')).toHaveCount(0);
			await expect(page.locator('.catalog-templates .market-card')).toHaveCount(4);
			await noOverflow(page);
		}
		await page.locator('.catalog-templates .market-card').first().getByRole('link', { name: /استفاده از طرح/ }).click();
		await expect(page).toHaveURL(/\/cms\/pages\/new\?template=/);
	} finally {
		expect((await change('active')).ok()).toBeTruthy();
	}
});
