import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import type { Order } from '../../src/lib/commerce/types.ts';

async function signIn(page: Page) {
	await page.goto('/cms/login');
	await page.getByLabel('نام کاربری').fill('novex-e2e-admin');
	await page.locator('#cms-password').fill('novex-e2e-password-only-for-local-tests');
	await page.getByRole('button', { name: 'ورود به پنل' }).click();
	await page.waitForURL((url) => url.pathname === '/cms');
}

test.beforeEach(async ({ page }) => { await signIn(page); });

test('lays out the real dashboard, management grids and editor controls in RTL', async ({ page }) => {
	await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	await expect(page.locator('.metric-strip__item')).toHaveCount(4);
	await expect(page.getByText('در ۱۴ روز گذشته درآمدی ثبت نشده است')).toBeVisible();
	const columns = page.locator('.split > *');
	const first = await columns.nth(0).boundingBox();
	const second = await columns.nth(1).boundingBox();
	expect(first && second && first.x > second.x).toBeTruthy();
	await expect(page.locator('.sidebar-toggle')).toBeHidden();

	await page.goto('/cms/orders');
	await expect(page.locator('.grid--stats .kpi')).toHaveCount(4);
	const kpiDisplay = await page.locator('.grid--stats').evaluate((element) => getComputedStyle(element).display);
	expect(kpiDisplay).toBe('grid');
	const screenReaderLabel = page.locator('.sr-only').first();
	const labelBox = await screenReaderLabel.boundingBox();
	expect(labelBox && labelBox.width <= 1 && labelBox.height <= 1).toBeTruthy();

	await page.goto('/cms/media');
	await expect(page.locator('.media-tile__thumb').first()).toBeVisible();
	const image = await page.locator('.media-tile__thumb').first().boundingBox();
	expect(image && image.width > 100 && image.height > 75).toBeTruthy();

	await page.goto('/cms/posts/new');
	await expect(page.locator('.editor')).toHaveCSS('display', 'grid');
	const body = page.locator('[data-body]');
	await body.fill('یک متن');
	await body.press('Control+k');
	await expect(body).toHaveValue(/\[.*\]\(https:\/\/\)/);
	await expect(body).toBeFocused();
	await page.getByRole('tab', { name: 'پیش‌نمایش' }).click();
	await expect(page.locator('.md-preview[data-preview]')).toContainText('یک متن');
});

test('mobile navigation opens, closes and restores focus without clipping content', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/cms');
	const sidebar = page.locator('#cms-sidebar');
	const toggle = page.locator('[data-sidebar-toggle]');
	await expect(sidebar).toBeHidden();
	await expect(toggle).toBeVisible();
	await toggle.click();
	await expect(sidebar).toBeVisible();
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await sidebar.getByRole('link', { name: 'نوشته‌ها' }).focus();
	await page.keyboard.press('Escape');
	await expect(sidebar).toBeHidden();
	await expect(toggle).toBeFocused();
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await toggle.click();
	await page.locator('.sidebar-scrim').click({ position: { x: 5, y: 5 } });
	await expect(sidebar).toBeHidden();
	for (const width of [390, 320]) {
		await page.setViewportSize({ width, height: 844 });
		for (const route of ['/cms', '/cms/posts', '/cms/posts/new', '/cms/orders', '/cms/media', '/cms/products', '/cms/products/new', '/cms/reports/revenue', '/cms/pages', '/cms/settings', '/cms/users', '/cms/language', '/cms/search?q=test']) {
			const response = await page.goto(route);
			expect(response?.status(), route).toBe(200);
			const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
			expect(widths.document, `${route} at ${width}px`).toBeLessThanOrEqual(widths.viewport);
		}
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/cms/posts');
	const tableScroll = page.locator('.posts-table').locator('..');
	const tableWidths = await tableScroll.evaluate((element) => ({ viewport: element.clientWidth, content: element.scrollWidth }));
	expect(tableWidths.content).toBeGreaterThan(tableWidths.viewport);
	await tableScroll.evaluate((element) => { element.scrollLeft = -200; });
	expect(await tableScroll.evaluate((element) => element.scrollLeft)).toBeLessThan(0);
});

test('filters and paginates the full post collection, retaining the search and status', async ({ page }) => {
	const token = `ui-${Date.now().toString(36)}`;
	const ids: string[] = [];
	try {
		for (let index = 0; index < 24; index++) {
			const slug = `${token}-${index}`;
			const response = await page.request.post('/cms/api/posts', {
				headers: { accept: 'application/json' },
				data: { title: `آزمون ${token} ${index}`, description: 'نوشتهٔ موقت آزمون', slug, pubDate: '2026-10-01', tags: 'آزمون', draft: index !== 23, body: 'متن آزمون' },
			});
			expect(response.ok(), await response.text()).toBeTruthy();
			ids.push((await response.json() as { id: string }).id);
		}
		await page.goto(`/cms/posts?${new URLSearchParams({ q: token, status: 'draft' })}`);
		await expect(page.locator('[data-post-row]')).toHaveCount(20);
		await expect(page.getByRole('link', { name: /پیش‌نویس/ }).first()).toHaveAttribute('aria-current', 'page');
		await page.getByRole('link', { name: 'صفحهٔ بعد' }).click();
		await expect(page.locator('[data-post-row]')).toHaveCount(3);
		expect(new URL(page.url()).searchParams.get('q')).toBe(token);
		expect(new URL(page.url()).searchParams.get('status')).toBe('draft');
		await page.getByRole('link', { name: /منتشرشده/ }).first().click();
		await expect(page.locator('[data-post-row]')).toHaveCount(1);
		await expect(page.locator('[data-post-row]').first()).toContainText(`${token} 23`);
	} finally {
		for (const id of ids) await page.request.delete(`/cms/api/posts/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
	}
});

test('search does not count hidden commerce when the store is disabled', async ({ page }) => {
	try {
		const disabled = await page.request.post('/cms/api/settings', { headers: { accept: 'application/json' }, data: { commerceEnabled: false } });
		expect(disabled.ok()).toBeTruthy();
		await page.goto('/cms/search?q=E2E-TEST-ONLY');
		await expect(page.getByText('نتیجه‌ای پیدا نشد')).toBeVisible();
		await expect(page.locator('.topbar__subtitle')).toContainText('۰ نتیجه');
		await expect(page.getByRole('heading', { name: 'محصولات' })).toHaveCount(0);
	} finally {
		await page.request.post('/cms/api/settings', { headers: { accept: 'application/json' }, data: { commerceEnabled: true } });
	}
});

test('loads migration code only when an import is requested', async ({ page }) => {
	const requests: string[] = [];
	page.on('request', (request) => requests.push(new URL(request.url()).pathname));
	const slug = `ui-lazy-${Date.now().toString(36)}`;
	await page.goto('/cms/pages/new');
	await page.getByLabel('عنوان صفحه').fill('صفحهٔ آزمون بارگیری');
	await page.getByLabel('نامک لاتین').fill(slug);
	await page.getByRole('button', { name: 'ساخت و ویرایش' }).click();
	await page.waitForURL((url) => url.pathname === `/cms/builder/${slug}`);
	await expect(page.getByTestId('builder-canvas')).toBeVisible();
	expect(requests.some((path) => path.includes('browser-tools.'))).toBeFalsy();
	await page.getByTestId('elementor-import-file').setInputFiles('tests/fixtures/elementor-basic.json');
	await expect(page.getByRole('dialog', { name: 'بررسی ورود Elementor' })).toBeVisible();
	expect(requests.some((path) => path.includes('browser-tools.'))).toBeTruthy();
});

test('renders persisted paid and pending order data without counting pending orders as revenue', async ({ page }) => {
	const dataDir = process.env.NOVEX_E2E_DATA_DIR;
	test.skip(!dataDir, 'A private test store is required.');
	if (!dataDir) return;
	const previousDatabase = process.env.COMMERCE_DB_FILE;
	const previousBuilder = process.env.BUILDER_DATA_FILE;
	process.env.COMMERCE_DB_FILE = join(dataDir, 'commerce.json');
	process.env.BUILDER_DATA_FILE = join(dataDir, 'builder-pages.json');
	const { updateDatabase } = await import('../../src/lib/commerce/db.ts');
	const stamp = new Date().toISOString();
	const id = `e2e-revenue-${Date.now().toString(36)}`;
	const paid: Order = {
		id, number: 'NVX-TEST-PAID', customerId: 'e2e-customer', customerName: 'مشتری آزمون',
		email: '', phone: '', city: '', address: '',
		items: [{ productId: 'e2e_product_internal_id', name: 'محصول آزمایشی', sku: 'E2E-TEST-ONLY', price: 200000, quantity: 1 }],
		subtotal: 200000, shipping: 0, discount: 0, total: 200000,
		status: 'paid', createdAt: stamp, updatedAt: stamp,
	};
	const pending: Order = { ...paid, id: `${id}-pending`, number: 'NVX-TEST-PENDING', total: 500000, status: 'pending' };
	await updateDatabase((db) => { db.orders.push(paid, pending); });
	try {
		await page.goto('/cms');
		await expect(page.locator('.metric-strip__item').first()).toContainText('۲۰۰');
		await expect(page.locator('.metric-strip__item').nth(1)).toContainText('۱ در انتظار');
		await expect(page.getByRole('link', { name: /سفارش‌ها/ }).first()).toContainText('۱');
		await expect(page.getByText('NVX-TEST-PAID')).toBeVisible();
		const dashboardBar = page.locator('.chart__bar:not(.chart__bar--muted)');
		await expect(dashboardBar).toHaveCount(1);
		expect((await dashboardBar.boundingBox())?.height).toBeGreaterThan(0);

		await page.goto('/cms/reports/revenue');
		const reportBar = page.locator('.revenue-chart__bar:not(.revenue-chart__bar--zero)');
		await expect(reportBar).toHaveCount(1);
		expect((await reportBar.boundingBox())?.height).toBeGreaterThan(0);
		expect(await reportBar.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
		await page.getByText('نمایش درآمد هر روز').click();
		await expect(page.locator('.chart-data table')).toBeVisible();
		await expect(page.locator('.chart-data table')).toContainText('۲۰۰٬۰۰۰');
	} finally {
		await updateDatabase((db) => { db.orders = db.orders.filter((order) => order.id !== id && order.id !== `${id}-pending`); });
		if (previousDatabase === undefined) delete process.env.COMMERCE_DB_FILE; else process.env.COMMERCE_DB_FILE = previousDatabase;
		if (previousBuilder === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = previousBuilder;
	}
});

test('keeps navigation, product visibility, and protected pages aligned with subscriber permissions', async ({ page, browser }) => {
	const username = `e2e-reader-${Date.now().toString(36)}`;
	const created = await page.request.post('/cms/api/users', {
		headers: { accept: 'application/json' },
		data: { username, password: 'temporary-e2e-password', role: 'subscriber' },
	});
	expect(created.status()).toBe(201);
	const user = (await created.json()).user as { id: string };
	const context = await browser.newContext();
	try {
		const reader = await context.newPage();
		await reader.goto('/cms/login');
		await reader.getByLabel('نام کاربری').fill(username);
		await reader.locator('#cms-password').fill('temporary-e2e-password');
		await reader.getByRole('button', { name: 'ورود به پنل' }).click();
		await reader.waitForURL((url) => url.pathname === '/cms/posts');
		await expect(reader.locator('.user-card__role')).toHaveText('مشترک');
		await expect(reader.locator('.brand')).toHaveAttribute('href', '/cms/posts');
		await expect(reader.locator('.nav-link[href="/cms/posts"]')).toBeVisible();
		for (const href of ['/cms', '/cms/pages', '/cms/media', '/cms/orders', '/cms/settings']) {
			await expect(reader.locator(`.nav-link[href="${href}"]`)).toHaveCount(0);
		}
		await expect(reader.locator('.topbar-search')).toHaveCount(0);
		await expect(reader.getByRole('link', { name: 'نوشتهٔ تازه' })).toHaveCount(0);
		const forbidden = await reader.request.get('/cms/orders');
		expect(forbidden.status()).toBe(403);
		await reader.goto('/cms/products');
		await expect(reader.getByText('محصول آزمایشی', { exact: true })).toBeVisible();
		await expect(reader.getByText('پیش‌نویس آزمایشی', { exact: true })).toHaveCount(0);
		await expect(reader.getByRole('link', { name: 'محصول تازه' })).toHaveCount(0);
	} finally {
		await context.close();
		await page.request.delete(`/cms/api/users/${encodeURIComponent(user.id)}`, { headers: { accept: 'application/json' } });
	}
});

test('uploads media through the panel and searches across paginated uploads', async ({ page }) => {
	const token = `e2emedia-${Date.now().toString(36)}`;
	const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64');
	try {
		for (let index = 0; index < 24; index++) {
			const uploaded = await page.request.post('/cms/api/media/upload', {
				headers: { accept: 'application/json' },
				multipart: { file: { name: `${token}-${index}.png`, mimeType: 'image/png', buffer: bytes } },
			});
			expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
		}
		await page.goto(`/cms/media?q=${token}`);
		await expect(page.locator('[data-media-item]')).toHaveCount(24);
		await page.locator('[data-file-input]').setInputFiles(Array.from({ length: 6 }, (_, index) => ({ name: `${token}-too-many-${index}.png`, mimeType: 'image/png', buffer: bytes })));
		await page.getByRole('button', { name: 'شروع بارگذاری' }).click();
		await expect(page.locator('[data-dropzone-label]')).toContainText('حداکثر 5 تصویر');
		await page.locator('[data-file-input]').setInputFiles({ name: `${token}-ui.png`, mimeType: 'image/png', buffer: bytes });
		await expect(page.locator('[data-dropzone-label]')).toContainText('۱ فایل انتخاب شد');
		await page.getByRole('button', { name: 'شروع بارگذاری' }).click();
		await page.waitForURL((url) => url.pathname === '/cms/media' && url.searchParams.get('flash') === 'uploaded');
		await page.goto(`/cms/media?q=${token}`);
		await expect(page.locator('[data-media-item]')).toHaveCount(24);
		const uploadPagination = page.getByRole('navigation', { name: 'صفحه‌بندی بارگذاری‌ها' });
		const next = uploadPagination.getByRole('link', { name: 'صفحهٔ بعد' });
		await expect(next).toBeVisible();
		await next.click();
		await expect(page.locator('[data-media-item]')).toHaveCount(1);
		expect(new URL(page.url()).searchParams.get('q')).toBe(token);
		await expect(uploadPagination.locator('.pagination__page[aria-label="صفحهٔ بعد"]')).toHaveAttribute('aria-disabled', 'true');
		await expect(uploadPagination.locator('.pagination__page[aria-label="صفحهٔ بعد"]')).not.toHaveAttribute('href');
		await page.getByRole('searchbox', { name: 'جست‌وجوی نام فایل' }).fill(`${token}-ui`);
		await page.locator('form[action="/cms/media"]').getByRole('button', { name: 'جست‌وجو' }).click();
		await expect(page.locator('[data-media-item]')).toHaveCount(1);
		await expect(page.locator('[data-media-item]').first()).toContainText(`${token}-ui`);
	} finally {
		const listed = await page.request.get('/cms/api/media');
		if (listed.ok()) {
			const { media } = await listed.json() as { media: Array<{ name: string; builtin: boolean }> };
			for (const item of media.filter((entry) => !entry.builtin && entry.name.startsWith(token))) {
				const removed = await page.request.delete(`/cms/api/media/${encodeURIComponent(item.name)}`, { headers: { accept: 'application/json' } });
				expect(removed.ok(), `remove temporary ${item.name}`).toBeTruthy();
			}
		}
	}
});
