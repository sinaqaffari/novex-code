import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
	await page.goto('/cms/login');
	await page.getByLabel('نام کاربری').fill('novex-e2e-admin');
	await page.locator('#cms-password').fill('novex-e2e-password-only-for-local-tests');
	await page.getByRole('button', { name: 'ورود به پنل' }).click();
	await page.waitForURL((url) => url.pathname === '/cms');
}
const slugFor = (name: string) => `${name}-${Date.now().toString(36)}`;
async function createDraft(page: Page, slug: string, templateId?: string) {
	const response = await page.request.post('/cms/api/builder/pages', { headers: { accept: 'application/json' }, data: { slug, title: 'صفحهٔ بخش‌ها', ...(templateId ? { templateId } : {}) } });
	expect(response.status()).toBe(201);
	return (await response.json()).document;
}
async function savedDraft(page: Page, slug: string) {
	const response = await page.request.get(`/cms/api/builder/pages/${slug}`);
	expect(response.status()).toBe(200);
	return (await response.json()).document;
}
async function rootIds(page: Page): Promise<string[]> {
	return page.getByTestId('builder-canvas').locator(':scope > [data-builder-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-builder-id')!));
}

test('discovers separately filtered native sections with truthful thumbnails and compiled responsive previews', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/marketplace');
	await page.getByRole('navigation', { name: 'نوع طرح' }).getByRole('link', { name: /بخش‌های آماده/ }).click();
	await expect(page).toHaveURL(/kind=section/);
	await expect(page.locator('.market-card')).toHaveCount(8);
	for (const width of [1280, 768, 390, 320]) {
		await page.setViewportSize({ width, height: 844 });
		const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
		expect(size.content).toBeLessThanOrEqual(size.width + 1);
	}
	const card = page.locator('[data-template-id="section-shop-products"]');
	await card.scrollIntoViewIfNeeded();
	await expect.poll(() => card.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
	await card.getByRole('link', { name: /پیش‌نمایش/ }).click();
	await expect(page.locator('[data-template-preview="section-shop-products"]')).toContainText('محصول آزمایشی');
	await expect(page.locator('[data-template-preview="section-shop-products"]')).not.toContainText('پیش‌نویس آزمایشی');
	await expect(page.getByRole('link', { name: 'انتخاب صفحه برای این بخش' })).toHaveAttribute('href', '/cms/pages?section=section-shop-products');
	await page.getByRole('group', { name: 'اندازهٔ پیش‌نمایش' }).getByRole('button', { name: 'موبایل' }).click();
	await expect(page.frameLocator('#preview-frame').locator('[data-template-preview="section-shop-products"]')).toContainText('محصول آزمایشی');
	await page.goto('/marketplace?kind=section');
	await page.getByRole('navigation', { name: 'دسته‌بندی طرح‌ها' }).getByRole('link', { name: /پرسش‌های متداول/ }).click();
	await expect(page.locator('.market-card')).toHaveCount(2);
	await page.getByLabel('جست‌وجوی قالب‌ها').fill('كلينيك');
	await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
	await expect(page.locator('.market-card')).toHaveCount(1);
	await expect(page.locator('.market-card')).toContainText('پرسش‌های کلینیک');
	expect(errors).toEqual([]);
});

test('marketplace section selection opens review only, then inserts into an existing page and publishes', async ({ page }) => {
	const slug = slugFor('section-market');
	await signIn(page);
	const original = await createDraft(page, slug, 'clinic-landing');
	await page.goto('/marketplace/section-studio-hero/preview');
	await page.getByRole('link', { name: 'انتخاب صفحه برای این بخش' }).click();
	await expect(page).toHaveURL(/\/cms\/pages\?section=section-studio-hero/);
	await expect(page.locator('.section-destination')).toContainText('فقط پس از تأیید شما');
	expect(await savedDraft(page, slug)).toEqual(original);
	await page.getByRole('row').filter({ hasText: 'صفحهٔ بخش‌ها' }).getByRole('link', { name: 'انتخاب و ویرایش' }).click();
	await page.waitForURL((url) => url.pathname === `/cms/builder/${slug}`);
	const library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	const card = library.getByTestId('template-card-section-studio-hero');
	await expect(card).toBeVisible();
	await expect(card.getByRole('button', { name: 'استفاده', exact: true })).toHaveCount(0);
	expect(await savedDraft(page, slug)).toEqual(original);
	await card.getByRole('button', { name: 'پیش‌نمایش' }).click();
	const preview = page.getByRole('dialog', { name: 'پیش‌نمایش معرفی تصویری استودیو' });
	await expect(preview).toContainText('فضاهایی برای زندگی بهتر');
	await preview.getByRole('button', { name: 'افزودن این بخش' }).click();
	await expect(library).toHaveCount(0);
	const after = await rootIds(page);
	expect(after.slice(0, original.nodes.length)).toEqual(original.nodes.map((node: { id: string }) => node.id));
	expect(after).toHaveLength(original.nodes.length + 1);
	await page.getByTestId('undo').click();
	expect(await rootIds(page)).toEqual(original.nodes.map((node: { id: string }) => node.id));
	await page.getByTestId('redo').click();
	expect(await rootIds(page)).toEqual(after);
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	const saved = await savedDraft(page, slug);
	expect(saved.themeId).toBe(original.themeId);
	expect(saved.nodes.slice(0, original.nodes.length)).toEqual(original.nodes);
	await page.reload();
	await expect(page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' })).toHaveCount(0);
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('.nvx-page__content')).toContainText('فضاهایی برای زندگی بهتر');
	await expect(page.locator('.nvx-page__content')).toContainText('مراقبت بهتر');
});

test('inserts at a canvas gap as a root sibling, preserves order, and supports undo and reload', async ({ page }) => {
	const slug = slugFor('section-gap');
	await signIn(page);
	const original = await createDraft(page, slug, 'restaurant-landing');
	await page.goto(`/cms/builder/${slug}`);
	const first = original.nodes[0].id as string;
	const second = original.nodes[1].id as string;
	await page.getByTestId(`canvas-insert-after-${first}`).click();
	const library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	await expect(library.getByRole('button', { name: 'بخش‌ها', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await expect(library.locator('.builder-template-card').first()).toHaveAttribute('data-testid', 'template-card-section-studio-hero');
	const basicImage = library.getByTestId('template-card-hero-intro').locator('img');
	await basicImage.scrollIntoViewIfNeeded();
	await expect.poll(() => basicImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
	await library.getByTestId('template-card-section-clinic-faq').getByRole('button', { name: 'افزودن بخش' }).click();
	await expect(library).toHaveCount(0);
	const roots = await rootIds(page);
	expect(roots).toHaveLength(original.nodes.length + 1);
	expect(roots[0]).toBe(first);
	expect(roots[2]).toBe(second);
	await page.getByTestId('undo').click();
	expect(await rootIds(page)).toEqual(original.nodes.map((node: { id: string }) => node.id));
	await page.getByTestId('redo').click();
	expect(await rootIds(page)).toEqual(roots);
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	const saved = await savedDraft(page, slug);
	expect(saved.nodes.map((node: { id: string }) => node.id)).toEqual(roots);
	expect(saved.nodes[0]).toEqual(original.nodes[0]);
	expect(saved.nodes[2]).toEqual(original.nodes[1]);
	await page.reload();
	expect(await rootIds(page)).toEqual(roots);
	await page.getByTestId(`canvas-insert-before-${first}`).click();
	await page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' }).getByTestId('template-card-section-education-cta').getByRole('button', { name: 'افزودن بخش' }).click();
	await expect(library).toHaveCount(0);
	const withBefore = await rootIds(page);
	expect(withBefore[1]).toBe(first);
	await page.getByTestId('undo').click();
	expect(await rootIds(page)).toEqual(roots);
});

test('cancelling an in-flight request and duplicate clicks cannot mutate the page', async ({ page }) => {
	const slug = slugFor('section-cancel');
	await signIn(page);
	const original = await createDraft(page, slug, 'clinic-landing');
	await page.goto(`/cms/builder/${slug}`);
	await page.getByTestId('open-template-library').click();
	const library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	const button = library.getByTestId('template-card-section-clinic-faq').getByRole('button', { name: 'افزودن بخش' });
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	let requests = 0;
	await page.route('**/cms/api/builder/templates/section-clinic-faq', async (route) => {
		requests++;
		await gate;
		await route.continue().catch(() => undefined);
	});
	try {
		await button.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
		await expect.poll(() => requests).toBe(1);
		await expect(button).toBeDisabled();
		await library.getByRole('button', { name: 'بستن' }).first().click();
		release!();
		await page.waitForTimeout(400);
		expect(await rootIds(page)).toEqual(original.nodes.map((node: { id: string }) => node.id));
		expect(await savedDraft(page, slug)).toEqual(original);
	} finally { release?.(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('surfaces request and stale-gap errors inside the library without inserting elsewhere', async ({ page }) => {
	const slug = slugFor('section-errors');
	await signIn(page);
	await createDraft(page, slug);
	await page.goto(`/cms/builder/${slug}`);
	await page.getByTestId('add-component-text').click();
	const [id] = await rootIds(page);
	await page.getByTestId(`canvas-insert-after-${id}`).click();
	let library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	await page.route('**/cms/api/builder/templates/section-clinic-faq', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'خطای آزمایشی کتابخانه' }) }));
	await library.getByTestId('template-card-section-clinic-faq').getByRole('button', { name: 'افزودن بخش' }).click();
	await expect(library.getByRole('alert')).toContainText('خطای آزمایشی کتابخانه');
	expect(await rootIds(page)).toEqual([id]);
	await page.unrouteAll({ behavior: 'wait' });
	await page.keyboard.press('Control+z');
	expect(await rootIds(page)).toEqual([]);
	await library.getByTestId('template-card-section-clinic-faq').getByRole('button', { name: 'افزودن بخش' }).click();
	await expect(library.getByRole('alert')).toContainText('جای درج تغییر کرده است');
	expect(await rootIds(page)).toEqual([]);
	await library.getByRole('button', { name: 'بستن' }).first().click();
});

test('inserts a product section bound to active real commerce data and publishes it', async ({ page }) => {
	const slug = slugFor('section-products');
	await signIn(page);
	await createDraft(page, slug);
	await page.goto(`/cms/builder/${slug}`);
	await page.getByTestId('start-with-template').click();
	const library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	await library.getByTestId('template-card-section-shop-products').getByRole('button', { name: 'افزودن بخش' }).click();
	await expect(page.getByTestId('builder-canvas')).toContainText('محصول آزمایشی');
	await expect(page.getByTestId('builder-canvas')).not.toContainText('پیش‌نویس آزمایشی');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('.nvx-page__content')).toContainText('محصول آزمایشی');
	await expect(page.locator('.nvx-page__content')).not.toContainText('پیش‌نویس آزمایشی');
});

test('does not replace a changed page when an asynchronously loaded full-page template returns', async ({ page }) => {
	const slug = slugFor('template-race');
	await signIn(page);
	await createDraft(page, slug);
	await page.goto(`/cms/builder/${slug}`);
	await page.getByTestId('add-component-text').click();
	await page.getByTestId('open-template-library').click();
	const library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	let requests = 0;
	await page.route('**/cms/api/builder/templates/education-landing', async (route) => {
		requests++;
		await gate;
		await route.continue().catch(() => undefined);
	});
	try {
		let confirmations = 0;
		page.on('dialog', (dialog) => { confirmations++; void dialog.accept(); });
		await library.getByTestId('template-card-education-landing').getByRole('button', { name: 'استفاده', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
		await expect.poll(() => requests).toBe(1);
		expect(confirmations).toBe(1);
		await page.keyboard.press('Control+z');
		expect(await rootIds(page)).toEqual([]);
		release!();
		await expect(library.getByRole('alert')).toContainText('صفحه هنگام بارگیری تغییر کرد');
		expect(await rootIds(page)).toEqual([]);
	} finally { release?.(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('creates a separate new draft from a public section without touching existing pages', async ({ page }) => {
	const slug = slugFor('section-new');
	await signIn(page);
	await page.goto('/marketplace/section-education-faq/preview');
	await page.getByRole('link', { name: 'انتخاب صفحه برای این بخش' }).click();
	await page.getByRole('link', { name: 'ساخت صفحهٔ تازه با این بخش' }).click();
	await expect(page.locator('.new-page-selection')).toContainText('پرسش‌های آموزش');
	await page.getByLabel('عنوان صفحه').fill('صفحهٔ تازه با بخش');
	await page.getByLabel('نامک لاتین').fill(slug);
	await page.getByRole('button', { name: 'ساخت و ویرایش' }).click();
	await page.waitForURL((url) => url.pathname === `/cms/builder/${slug}`);
	await expect(page.getByTestId('builder-canvas')).toContainText('این آموزش برای چه کسانی است؟');
	const saved = await savedDraft(page, slug);
	expect(saved.nodes).toHaveLength(1);
	expect(saved.title).toBe('صفحهٔ تازه با بخش');
});
