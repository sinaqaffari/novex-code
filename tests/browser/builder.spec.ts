import { expect, request as playwrightRequest, test, type Locator, type Page, type Response } from '@playwright/test';
import { appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { ZipFile } from 'yazl';

interface BrowserIssues {
	consoleErrors: string[];
	runtimeErrors: string[];
	failedRequests: string[];
	serverErrors: string[];
}

const issuesByPage = new WeakMap<Page, BrowserIssues>();
const uploadedNamesByPage = new WeakMap<Page, Set<string>>();

function monitorBrowser(page: Page): BrowserIssues {
	const issues: BrowserIssues = { consoleErrors: [], runtimeErrors: [], failedRequests: [], serverErrors: [] };
	issuesByPage.set(page, issues);
	page.on('console', (message) => {
		if (message.type() === 'error') issues.consoleErrors.push(message.text());
	});
	page.on('pageerror', (error) => issues.runtimeErrors.push(error.message));
	page.on('requestfailed', (request) => {
		const failure = request.failure()?.errorText ?? 'unknown';
		if (failure !== 'net::ERR_ABORTED') issues.failedRequests.push(`${request.method()} ${request.url()} — ${failure}`);
	});
	page.on('response', (response) => {
		if (response.status() >= 500) issues.serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
	});
	return issues;
}

function assertNoBrowserIssues(issues: BrowserIssues): void {
	expect(issues.consoleErrors, 'browser console errors').toEqual([]);
	expect(issues.runtimeErrors, 'uncaught page errors').toEqual([]);
	expect(issues.failedRequests, 'failed browser requests').toEqual([]);
	expect(issues.serverErrors, 'HTTP 5xx responses').toEqual([]);
}

async function assertSandboxUnavailable(response: Response, dialog: Locator, canvas: Locator, expectedText: string, issues: BrowserIssues): Promise<void> {
	expect(response.status()).toBe(503);
	const body = await response.json() as { ok?: boolean; code?: string; message?: string };
	expect(body).toMatchObject({ ok: false, code: 'sandbox_unavailable' });
	expect(typeof body.message).toBe('string');
	await expect(dialog.getByRole('alert')).toHaveText(body.message!);
	await expect(canvas).not.toContainText(expectedText);
	// This specific 503 is expected when the required OS sandbox cannot start.
	issues.consoleErrors = issues.consoleErrors.filter((message) => !message.includes('status of 503'));
	issues.serverErrors = issues.serverErrors.filter((message) => !message.includes('503 POST') || !message.includes('/cms/api/builder/plugin-processors'));
}

function slugFor(testName: string): string {
	return `e2e-${testName}-${Date.now().toString(36)}`;
}

async function signIn(page: Page): Promise<void> {
	await page.goto('/cms/login');
	await page.getByLabel('نام کاربری').fill('novex-e2e-admin');
	await page.locator('#cms-password').fill('novex-e2e-password-only-for-local-tests');
	await page.getByRole('button', { name: 'ورود به پنل' }).click();
	await page.waitForURL((url) => url.pathname === '/cms');
}

async function createPage(page: Page, slug: string): Promise<void> {
	await page.goto('/cms/pages/new');
	await page.getByLabel('عنوان صفحه').fill(`صفحهٔ آزمون ${slug}`);
	await page.getByLabel('نامک لاتین').fill(slug);
	await page.getByRole('button', { name: 'ساخت و ویرایش' }).click();
	await page.waitForURL((url) => url.pathname === `/cms/builder/${slug}`);
	await expect(page.getByTestId('builder-canvas')).toBeVisible();
}

async function trackUploaded(page: Page, name: string): Promise<void> {
	let uploaded = uploadedNamesByPage.get(page);
	if (!uploaded) {
		uploaded = new Set<string>();
		uploadedNamesByPage.set(page, uploaded);
	}
	uploaded.add(name);
	// The isolated runner removes its own fixtures after its temporary page store is gone.
	if (process.env.NOVEX_E2E_UPLOAD_LOG) await appendFile(process.env.NOVEX_E2E_UPLOAD_LOG, `${name}\n`);
}

test.beforeEach(async ({ page }) => {
	monitorBrowser(page);
	await signIn(page);
});

test.afterEach(async ({ page }) => {
	const names = uploadedNamesByPage.get(page);
	if (!names?.size) return;
	for (const name of names) {
		await page.request.delete(`/cms/api/media/${encodeURIComponent(name)}`, {
			headers: { accept: 'application/json' },
		}).catch(() => undefined);
	}
});

test('creates pages and edits, selects, reorders, duplicates, deletes, and styles components', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('layers');
	await createPage(page, slug);

	await page.getByTestId('add-component-heading').click();
	const canvas = page.getByTestId('builder-canvas');
	const headingId = await page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node').first().getAttribute('data-node-id');
	const heading = canvas.locator(`[data-builder-id="${headingId}"] h2`);
	await expect(heading).toHaveText('تیتر تازه');
	await heading.dblclick();
	await heading.fill('ویرایش مستقیم در صفحه');
	await heading.press('Enter');
	await expect(heading).toHaveText('ویرایش مستقیم در صفحه');

	await page.getByTestId('add-component-text').click();
	const treeNodes = page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node');
	await expect(treeNodes).toHaveCount(2);
	await treeNodes.nth(1).click();
	await expect(page.getByRole('heading', { name: 'متن', exact: true })).toBeVisible();
	await page.locator('#builder-field-text').fill('محتوای قابل ویرایش از بازرس');
	await expect(canvas).toContainText('محتوای قابل ویرایش از بازرس');

	await page.getByRole('button', { name: 'انتقال به بالا' }).click();
	await expect(treeNodes.nth(0).locator('.builder-tree-node__label strong')).toHaveText('متن');
	await page.getByRole('button', { name: 'رونوشت', exact: true }).click();
	await expect(treeNodes).toHaveCount(3);
	await page.getByTestId('undo').click();
	await expect(treeNodes).toHaveCount(2);
	await page.getByTestId('redo').click();
	await expect(treeNodes).toHaveCount(3);
	await treeNodes.nth(2).click();

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'حذف', exact: true }).click();
	await expect(treeNodes).toHaveCount(2);

	await treeNodes.first().click();
	await page.getByRole('button', { name: 'موبایل' }).click();
	await page.locator('#builder-field-styles-width').selectOption('full');
	await page.locator('.builder-toggle-row input[type="checkbox"]').check();
	await expect(canvas.locator('.builder-preview-node--hidden-placeholder')).toHaveCount(1);
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();

	const saved = await page.request.get(`/cms/api/builder/pages/${slug}`);
	expect(saved.ok()).toBeTruthy();
	const savedBody = await saved.json();
	const responsiveNodeId = await treeNodes.first().getAttribute('data-node-id');
	const responsiveNode = savedBody.document.nodes.find((node: { id: string }) => node.id === responsiveNodeId);
	expect(responsiveNode.responsiveStyles.mobile).toMatchObject({ width: 'full', hidden: true });
	assertNoBrowserIssues(issues);
});

test('previews real product data and media, saves and reloads the canonical document, and publishes it', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('publish');
	await createPage(page, slug);
	const unpublished = await page.request.get(`/pages/${slug}`);
	expect(unpublished.status()).toBe(404);

	await page.getByTestId('add-component-productgrid').click();
	const grid = page.getByTestId('product-grid-preview');
	await expect(grid).toContainText('محصول آزمایشی');
	await expect(grid.locator('[data-product-slug="e2e-test-product"]')).toBeVisible();
	await page.locator('#builder-field-binding-selection').selectOption('latest');
	await expect(grid).toHaveAttribute('data-selection', 'latest');
	await page.locator('#builder-field-binding-selection').selectOption('category');
	await page.locator('#builder-field-binding-category').fill('دستهٔ خالی');
	await expect(grid).toContainText('هنوز محصول فعالی در این بخش ثبت نشده است.');
	await page.locator('#builder-field-binding-category').fill('دستهٔ آزمایشی');
	await expect(grid).toContainText('محصول آزمایشی');
	await page.locator('#builder-field-binding-selection').selectOption('featured');
	await expect(grid).toContainText('محصول آزمایشی');

	await page.getByTestId('add-component-image').click();
	await page.getByTestId('open-media-picker').click();
	const picker = page.getByTestId('media-picker');
	await expect(picker).toBeVisible();
	const mediaAsset = picker.locator('[data-testid="media-asset"][data-asset-ref^="media://assets/"]').first();
	await expect(mediaAsset).toBeVisible();
	await mediaAsset.click();
	await expect(picker).toBeHidden();
	await expect(page.locator('#builder-field-src')).toHaveValue(/^media:\/\/assets\//);

	const rejectedUpload = await page.request.post('/cms/api/media/upload', {
		headers: { accept: 'application/json' },
		multipart: { files: { name: 'spoofed.png', mimeType: 'image/png', buffer: Buffer.from('not actually a PNG') } },
	});
	expect(rejectedUpload.status()).toBe(400);
	await expect(rejectedUpload.json()).resolves.toMatchObject({ ok: false, field: 'file' });

	await page.getByTestId('open-media-picker').click();
	const uploadResponsePromise = page.waitForResponse((response) =>
		response.url().includes('/cms/api/media/upload') && response.request().method() === 'POST',
	);
	await picker.locator('input[type="file"]').setInputFiles({
		name: 'e2e-pixel.png',
		mimeType: 'image/png',
		buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64'),
	});
	const uploadResponse = await uploadResponsePromise;
	expect(uploadResponse.ok()).toBeTruthy();
	const uploadBody = await uploadResponse.json();
	const uploaded = uploadBody.files[0] as { name: string; assetRef: string };
	await trackUploaded(page, uploaded.name);
	expect(uploaded.assetRef).toMatch(/^media:\/\/uploads\//);
	await expect(picker).toBeHidden();
	await expect(page.locator('#builder-field-src')).toHaveValue(uploaded.assetRef);

	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('product-grid-preview')).toContainText('محصول آزمایشی');
	await expect(page.locator('#builder-field-src')).toHaveCount(0);
	const treeNodes = page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node');
	await treeNodes.filter({ hasText: 'تصویر' }).click();
	await expect(page.locator('#builder-field-src')).toHaveValue(uploaded.assetRef);

	const publicCards = await page.request.get('/api/products?selection=featured&limit=4');
	expect(publicCards.ok()).toBeTruthy();
	const publicPayload = await publicCards.json();
	expect(publicPayload.products[0]).not.toHaveProperty('id');
	expect(publicPayload.products[0]).not.toHaveProperty('sku');
	expect(publicPayload.products[0]).not.toHaveProperty('stock');

	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	const published = await page.request.get(`/pages/${slug}`);
	expect(published.status()).toBe(200);
	expect(published.headers()['content-type']).toContain('text/html');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('[data-page-slug]')).toBeVisible();
	await expect(page.locator('[data-product-slug="e2e-test-product"]')).toBeVisible();
	await expect(page.locator('.nvx-builder-product-card__image img')).toBeVisible();
	assertNoBrowserIssues(issues);
});

test('shows an optimistic concurrency conflict and lets the editor reload the latest server draft', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('conflict');
	await createPage(page, slug);

	const currentResponse = await page.request.get(`/cms/api/builder/pages/${slug}`);
	expect(currentResponse.ok()).toBeTruthy();
	const current = await currentResponse.json();
	const externalDocument = { ...current.document, description: 'ویرایش ذخیره‌شده از نشست دیگر' };
	const externalSave = await page.request.put(`/cms/api/builder/pages/${slug}`, {
		headers: { 'content-type': 'application/json' },
		data: { expectedRevision: current.revision, document: externalDocument },
	});
	expect(externalSave.status()).toBe(200);

	await page.getByTestId('add-component-heading').click();
	await expect(page.locator('.builder-save-state--conflict')).toBeVisible();
	await expect(page.getByRole('alert')).toContainText('نسخه');
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'بارگیری نسخهٔ تازه' }).last().click();
	await expect(page.getByLabel('توضیحات')).toHaveValue('ویرایش ذخیره‌شده از نشست دیگر');
	expect(issues.consoleErrors.filter((message) => !message.includes('status of 409 (Conflict)'))).toEqual([]);
	expect(issues.runtimeErrors).toEqual([]);
	expect(issues.failedRequests).toEqual([]);
	expect(issues.serverErrors).toEqual([]);
});

test('rejects invalid documents, surfaces failed saves, and protects media APIs by role', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('validation');
	await createPage(page, slug);

	const initialResponse = await page.request.get(`/cms/api/builder/pages/${slug}`);
	const initial = await initialResponse.json();
	const unsafeDocument = {
		...initial.document,
		nodes: [{
			id: 'unsafe-image',
			type: 'Image',
			componentVersion: 1,
			props: { src: 'javascript:alert(1)', alt: '', caption: '', aspectRatio: 'auto', fit: 'cover' },
		}],
	};
	const invalidSave = await page.request.put(`/cms/api/builder/pages/${slug}`, {
		headers: { 'content-type': 'application/json' },
		data: { expectedRevision: initial.revision, document: unsafeDocument },
	});
	expect(invalidSave.status()).toBe(422);
	const afterInvalid = await page.request.get(`/cms/api/builder/pages/${slug}`);
	expect((await afterInvalid.json()).document.nodes).toEqual([]);

	const putPattern = `**/cms/api/builder/pages/${slug}`;
	await page.route(putPattern, async (route) => {
		if (route.request().method() === 'PUT') {
			await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'خطای آزمایشی ذخیره' }) });
			return;
		}
		await route.continue();
	});
	await page.getByTestId('add-component-heading').click();
	await expect(page.getByRole('alert')).toContainText('خطای آزمایشی ذخیره');
	await page.unroute(putPattern);
	await page.locator('.builder-alert__actions').getByRole('button', { name: 'تلاش دوباره' }).click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();

	const unauthenticated = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:4321' });
	const anonymousMedia = await unauthenticated.get('/cms/api/media');
	const anonymousPreview = await unauthenticated.get('/cms/media/file/blog-placeholder-1.jpg');
	expect(anonymousMedia.status()).toBe(401);
	expect(anonymousPreview.status()).toBe(401);
	await unauthenticated.dispose();

	const username = `e2e-contributor-${Date.now().toString(36)}`;
	const createdUser = await page.request.post('/cms/api/users', {
		headers: { accept: 'application/json', 'content-type': 'application/json' },
		data: { username, password: 'temporary-e2e-password', role: 'contributor' },
	});
	expect(createdUser.status()).toBe(201);
	const { user } = await createdUser.json();
	const contributor = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:4321' });
	try {
		const login = await contributor.post('/cms/api/login', {
			headers: { accept: 'application/json', 'content-type': 'application/json' },
			data: { username, password: 'temporary-e2e-password' },
		});
		expect(login.status()).toBe(200);
		const mediaList = await contributor.get('/cms/api/media');
		const mediaPreview = await contributor.get('/cms/media/file/blog-placeholder-1.jpg');
		const upload = await contributor.post('/cms/api/media/upload', { headers: { accept: 'application/json' } });
		const deletion = await contributor.delete('/cms/api/media/not-a-real-image.jpg', { headers: { accept: 'application/json' } });
		expect(mediaList.status()).toBe(200);
		expect(mediaPreview.status()).toBe(200);
		expect(upload.status()).toBe(403);
		expect(deletion.status()).toBe(403);
	} finally {
		await contributor.dispose();
		await page.request.delete(`/cms/api/users/${encodeURIComponent(user.id)}`, { headers: { accept: 'application/json' } }).catch(() => undefined);
	}

	expect(issues.runtimeErrors).toEqual([]);
});

test('refreshes revision history, restores an earlier snapshot, and saves the restoration as a new revision', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('history');
	const initialTitle = `صفحهٔ آزمون ${slug}`;
	const apiPath = `/cms/api/builder/pages/${slug}`;
	await createPage(page, slug);
	await page.getByTestId('add-component-heading').click();
	await page.getByTestId('save-page').click();
	await expect.poll(async () => (await (await page.request.get(apiPath)).json()).document.nodes.length).toBe(1);

	const titleInput = page.locator('.builder-title-input input');
	await titleInput.fill('عنوان نسخهٔ دوم');
	await page.getByTestId('save-page').click();
	await expect.poll(async () => (await (await page.request.get(apiPath)).json()).document.title).toBe('عنوان نسخهٔ دوم');

	await page.getByRole('button', { name: 'تاریخچهٔ نسخه‌ها' }).click();
	const historyPanel = page.getByLabel('تاریخچهٔ نسخه‌ها');
	const revisionsResponse = await page.request.get(`${apiPath}/history`);
	const revisions = (await revisionsResponse.json()).revisions as Array<{ revision: number; title: string }>;
	const currentRevision = revisions[0]!;
	await expect(historyPanel).toContainText(`نسخهٔ ${currentRevision.revision.toLocaleString('fa-IR')}`);

	await titleInput.fill('عنوان نسخهٔ سوم');
	await expect.poll(async () => (await (await page.request.get(apiPath)).json()).document.title).toBe('عنوان نسخهٔ سوم');
	const refreshedResponse = await page.request.get(`${apiPath}/history`);
	const refreshed = (await refreshedResponse.json()).revisions as Array<{ revision: number; title: string }>;
	const refreshedLatest = refreshed[0]!;
	await expect(historyPanel).toContainText(`نسخهٔ ${refreshedLatest.revision.toLocaleString('fa-IR')}`);

	await page.getByRole('button', { name: 'بستن تاریخچه' }).click();
	await page.getByRole('button', { name: 'تاریخچهٔ نسخه‌ها' }).click();
	const oldest = refreshed.at(-1)!;
	await expect(historyPanel).toContainText(`نسخهٔ ${oldest.revision.toLocaleString('fa-IR')}`);
	await historyPanel.locator('button').filter({ hasText: `نسخهٔ ${oldest.revision.toLocaleString('fa-IR')}` }).click();
	await expect(titleInput).toHaveValue(initialTitle);
	await expect(page.getByTestId('builder-canvas')).toContainText('صفحهٔ خود را بسازید');

	await page.getByTestId('save-page').click();
	await expect.poll(async () => (await (await page.request.get(apiPath)).json()).document.title).toBe(initialTitle);
	const restoredResponse = await page.request.get(`${apiPath}/history`);
	const restoredRevisions = (await restoredResponse.json()).revisions as Array<{ revision: number; title: string }>;
	expect(restoredRevisions[0]!.revision).toBeGreaterThan(refreshedLatest.revision);
	assertNoBrowserIssues(issues);
});

test('shows a product-grid error state for a failed data request and recovers on a new binding', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('grid-error');
	await createPage(page, slug);
	await page.route('**/api/products*', async (route) => {
		const url = new URL(route.request().url());
		if (url.searchParams.get('selection') === 'featured') {
			await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, status: 'error' }) });
			return;
		}
		await route.continue();
	});
	await page.getByTestId('add-component-productgrid').click();
	const grid = page.getByTestId('product-grid-preview');
	await expect(grid.getByRole('alert')).toContainText('بارگیری پیش‌نمایش محصولات ممکن نیست');
	await page.unroute('**/api/products*');
	await page.locator('#builder-field-binding-selection').selectOption('latest');
	await expect(grid).toContainText('محصول آزمایشی');
	expect(issues.consoleErrors.filter((message) => !message.includes('status of 503'))).toEqual([]);
	expect(issues.runtimeErrors).toEqual([]);
	expect(issues.failedRequests).toEqual([]);
	expect(issues.serverErrors.filter((message) => !message.includes('/api/products?selection=featured'))).toEqual([]);
});

test('inspects an Elementor export before replacing the draft without publishing', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('elementor');
	await createPage(page, slug);
	let publishRequests = 0;
	page.on('request', (req) => {
		if (req.method() === 'POST' && new URL(req.url()).pathname === `/cms/api/builder/pages/${slug}`) publishRequests++;
	});
	await page.getByTestId('elementor-import-file').setInputFiles('tests/fixtures/elementor-basic.json');
	const dialog = page.getByRole('dialog', { name: 'بررسی ورود Elementor' });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText('form');
	await expect(dialog).toContainText('تصویر منتقل نشد');
	await expect(page.getByTestId('builder-canvas')).not.toContainText('سلام Novex');
	page.once('dialog', (confirmation) => confirmation.accept());
	await dialog.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	await expect(page.getByTestId('builder-canvas')).toContainText('سلام Novex');
	await page.getByTestId('save-page').click();
	await expect.poll(async () => (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document.nodes.length).toBeGreaterThan(0);
	expect(publishRequests).toBe(0);
	assertNoBrowserIssues(issues);
});

test('imports and publishes long Elementor text without discarding its tail', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('elementor-long');
	const content = `${'الف'.repeat(4999)}😀${'ب'.repeat(1200)} پایان متن`;
	await createPage(page, slug);
	const source = { version: '0.4', content: [{ id: 'long-text', elType: 'widget', widgetType: 'text-editor', settings: { editor: content }, elements: [] }] };
	await page.getByTestId('elementor-import-file').setInputFiles({ name: 'long.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
	const dialog = page.getByRole('dialog', { name: 'بررسی ورود Elementor' });
	await expect(dialog).toContainText('محتوای چندبخشی یا بلند');
	page.once('dialog', (confirmation) => confirmation.accept());
	await dialog.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	await page.getByTestId('save-page').click();
	await expect.poll(async () => (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document.nodes.length).toBeGreaterThan(0);
	const saved = (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document;
	expect(saved.nodes[0].children.map((node: { props: { text: string } }) => node.props.text).join('')).toBe(content);
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	const texts = await page.locator('.nvx-page__content .nvx-builder-text').allTextContents();
	expect(texts.join('')).toBe(content);
	assertNoBrowserIssues(issues);
});

test('searches and inserts a copied section without replacing the existing page', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('section');
	await createPage(page, slug);
	await page.getByTestId('add-component-text').click();
	await page.getByRole('button', { name: 'قالب‌ها', exact: true }).click();
	const library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	await library.getByLabel('جست‌وجوی قالب و بخش').fill('معرفی ساده');
	const card = library.locator('article').filter({ hasText: 'معرفی ساده' });
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: 'پیش‌نمایش' }).click();
	await expect(page.getByRole('dialog', { name: 'پیش‌نمایش معرفی ساده' })).toBeVisible();
	await page.getByRole('dialog', { name: 'پیش‌نمایش معرفی ساده' }).getByRole('button', { name: 'بستن' }).first().click();
	await card.getByRole('button', { name: 'افزودن رونوشت' }).click();
	await expect(page.getByTestId('builder-canvas')).toContainText('راهکار ساده برای شروع بزرگ');
	await expect(page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node')).not.toHaveCount(1);
	assertNoBrowserIssues(issues);
});

test('inspects a local WXR export before replacing draft content', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('wxr');
	await createPage(page, slug);
	await page.getByTestId('wxr-import-file').setInputFiles('tests/fixtures/wordpress-sample.xml');
	const dialog = page.getByRole('dialog', { name: 'بررسی خروجی WordPress WXR' });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText('رسانه بدون نگاشت محلی منتقل نمی‌شود');
	await expect(page.getByTestId('builder-canvas')).not.toContainText('سلام Novex');
	page.once('dialog', (confirmation) => confirmation.accept());
	await dialog.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	await expect(page.getByTestId('builder-canvas')).toContainText('سلام Novex');
	assertNoBrowserIssues(issues);
});

test('keeps mobile responsive values independent and can restore inheritance', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('responsive-inherit');
	await createPage(page, slug);
	await page.getByTestId('add-component-heading').click();
	const width = page.locator('#builder-field-styles-width');
	await width.selectOption('wide');
	await page.getByRole('button', { name: 'موبایل' }).click();
	await expect(width).toHaveValue('');
	await width.selectOption('narrow');
	await width.selectOption('');
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	const response = await page.request.get(`/cms/api/builder/pages/${slug}`);
	const { document } = await response.json();
	expect(document.nodes[0].styles.width).toBe('wide');
	expect(document.nodes[0].responsiveStyles?.mobile?.width).toBeUndefined();
	assertNoBrowserIssues(issues);
});

test('inserts a parameterized bundled plugin composition and retains it after deactivation', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const changePlugin = (action: string) => page.request.post('/cms/api/plugins', {
		headers: { accept: 'application/json' },
		data: { pluginId: 'announcement-preset', action },
	});
	const activated = await changePlugin('activate');
	expect(activated.ok()).toBeTruthy();
	try {
		const slug = slugFor('plugin-component');
		await createPage(page, slug);
		await page.getByRole('button', { name: /نوار اطلاع‌رسانی/ }).click();
		const dialog = page.getByRole('dialog', { name: 'نوار اطلاع‌رسانی' });
		await dialog.getByLabel('متن اطلاع‌رسانی').fill('پیام سفارشی آزمایشی');
		await dialog.getByRole('button', { name: 'افزودن به صفحه' }).click();
		await expect(page.getByTestId('builder-canvas')).toContainText('پیام سفارشی آزمایشی');
		await page.getByTestId('save-page').click();
		await expect(page.locator('.builder-save-state--saved')).toBeVisible();
		const disabled = await changePlugin('deactivate');
		expect(disabled.ok()).toBeTruthy();
		await page.reload();
		await expect(page.getByTestId('builder-canvas')).toContainText('پیام سفارشی آزمایشی');
		await expect(page.getByRole('button', { name: /نوار اطلاع‌رسانی/ })).toHaveCount(0);
		assertNoBrowserIssues(issues);
	} finally {
		await changePlugin('deactivate').catch(() => undefined);
	}
});

test('reviews actionable diagnostics without publishing the current draft', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('diagnostics');
	await createPage(page, slug);
	await page.getByTestId('add-component-image').click();
	await page.getByTestId('diagnose-page').click();
	const report = page.getByRole('dialog', { name: 'بررسی پیش از انتشار' });
	await expect(report).toContainText('برای این تصویر فایلی انتخاب نشده است.');
	await report.getByRole('button', { name: 'انتخاب مؤلفه' }).click();
	await expect(report).toBeHidden();
	await expect(page.locator('#builder-field-alt')).toBeVisible();
	const published = await page.request.get(`/pages/${slug}`);
	expect(published.status()).toBe(404);
	assertNoBrowserIssues(issues);
});

test('installs a linked site kit with a bundled asset as drafts', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('kit-editor');
	const prefix = slugFor('kit');
	await createPage(page, slug);
	await page.getByRole('button', { name: 'قالب‌ها', exact: true }).click();
	const library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	await library.getByText('بستهٔ چندصفحه‌ای کسب‌وکار').click();
	await library.getByLabel('پیشوند نامک لاتین برای صفحه‌های تازه').fill(prefix);
	page.once('dialog', (dialog) => dialog.accept());
	await library.getByRole('button', { name: 'ساخت پیش‌نویس‌های بسته' }).click();
	await expect(library.getByRole('status')).toContainText(`${prefix}-contact`);
	const response = await page.request.get(`/cms/api/builder/pages/${prefix}-contact`);
	expect(response.ok()).toBeTruthy();
	const result = await response.json();
	expect(JSON.stringify(result.document.nodes)).toContain(`/pages/${prefix}-home`);
	expect(JSON.stringify(result.document.nodes)).toContain('media://assets/blog-placeholder-about.jpg');
	expect((await page.request.get(`/pages/${prefix}-home`)).status()).toBe(404);
	assertNoBrowserIssues(issues);
});

test('creates multiple WXR drafts only after confirmation and does not publish them', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('wxr-bulk-editor');
	const prefix = slugFor('wxr-bulk');
	await createPage(page, slug);
	await page.getByTestId('wxr-import-file').setInputFiles('tests/fixtures/wordpress-sample.xml');
	const dialog = page.getByRole('dialog', { name: 'بررسی خروجی WordPress WXR' });
	await dialog.getByLabel('پیشوند نامک برای ورود گروهی').fill(prefix);
	await dialog.getByText('هشدارهای تمام موارد برای ورود گروهی').click();
	await expect(dialog).toContainText('نوشته');
	page.once('dialog', (confirmation) => confirmation.accept());
	await dialog.getByRole('button', { name: 'ساخت صفحه‌های پیش‌نویس' }).click();
	await expect(dialog.getByRole('status')).toContainText(`${prefix}-2`);
	const item = await page.request.get(`/cms/api/builder/pages/${prefix}-1`);
	expect((await item.json()).document.title).toBe('درباره ما');
	expect((await page.request.get(`/pages/${prefix}-1`)).status()).toBe(404);
	assertNoBrowserIssues(issues);
});

test('converts WXR headings, quotes and standalone links into editable native components', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('wxr-structure');
	await createPage(page, slug);
	const xml = '<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>نمونه</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[<h2>عنوان واردشده</h2><p><a href="/contact">تماس</a></p><blockquote><p>نقل‌قول وردپرس</p></blockquote>]]></content:encoded></item></channel></rss>';
	await page.getByTestId('wxr-import-file').setInputFiles({ name: 'sample.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	const dialog = page.getByRole('dialog', { name: 'بررسی خروجی WordPress WXR' });
	await expect(dialog).toContainText('عنوان واردشده');
	page.once('dialog', (confirmation) => confirmation.accept());
	await dialog.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	await expect(page.getByTestId('builder-canvas')).toContainText('عنوان واردشده');
	await expect(page.getByTestId('builder-canvas')).toContainText('تماس');
	await page.getByTestId('save-page').click();
	await expect.poll(async () => (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document.nodes.length).toBe(3);
	const saved = (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document.nodes;
	expect(saved[0].type).toBe('Heading');
	expect(saved[1]).toMatchObject({ type: 'Button', props: { href: '/contact' } });
	expect(saved[2]).toMatchObject({ type: 'Blockquote', props: { text: 'نقل‌قول وردپرس' } });
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('blockquote')).toContainText('نقل‌قول وردپرس');
	assertNoBrowserIssues(issues);
});

test('edits and publishes a declarative plugin block that survives plugin deactivation', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const plugin = (action: string) => page.request.post('/cms/api/plugins', { headers: { accept: 'application/json' }, data: { pluginId: 'notice-component', action } });
	expect((await plugin('activate')).ok()).toBeTruthy();
	try {
		const slug = slugFor('plugin-block');
		await createPage(page, slug);
		await page.getByTestId('plugin-component-notice-card').click();
		await page.getByLabel('متن اعلان').fill('اعلان سفارشی و پایدار');
		await expect(page.getByTestId('builder-canvas')).toContainText('اعلان سفارشی و پایدار');
		await page.getByTestId('save-page').click();
		await expect(page.locator('.builder-save-state--saved')).toBeVisible();
		await page.getByTestId('publish-page').click();
		await expect.poll(async () => (await page.request.get(`/pages/${slug}`)).status()).toBe(200);
		expect((await plugin('deactivate')).ok()).toBeTruthy();
		await page.reload();
		await expect(page.getByTestId('builder-canvas')).toContainText('اعلان سفارشی و پایدار');
		await expect(page.getByTestId('plugin-component-notice-card')).toHaveCount(0);
		const publicPage = await page.request.get(`/pages/${slug}`);
		expect(await publicPage.text()).toContain('اعلان سفارشی و پایدار');
		assertNoBrowserIssues(issues);
	} finally { await plugin('deactivate').catch(() => undefined); }
});

test('renders responsive layout primitives consistently and restores selection after undo', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('engine-layout');
	await createPage(page, slug);
	await page.getByTestId('add-component-container').click();
	const tree = page.getByRole('list', { name: 'ساختار صفحه' });
	const containerId = await tree.getByTestId('tree-node').first().getAttribute('data-node-id');
	if (!containerId) throw new Error('Container not found');
	await page.locator('#builder-field-styles-layout').selectOption('flex');
	await page.getByTestId('add-component-divider').click();
	await tree.locator(`[data-node-id="${containerId}"]`).click();
	await page.getByTestId('add-component-spacer').click();
	const spacerId = await tree.getByTestId('tree-node').last().getAttribute('data-node-id');
	if (!spacerId) throw new Error('Spacer not found');
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'حذف', exact: true }).click();
	await page.getByTestId('undo').click();
	await expect(page.getByRole('heading', { name: 'فاصله', exact: true })).toBeVisible();
	await expect(tree.locator(`[data-node-id="${spacerId}"]`)).toHaveAttribute('aria-pressed', 'true');
	await tree.locator(`[data-node-id="${containerId}"]`).click();
	await page.getByRole('button', { name: 'موبایل' }).click();
	await page.locator('#builder-field-styles-layout').selectOption('grid');
	await page.locator('#builder-field-styles-columns').selectOption('1');
	await page.locator('#builder-field-styles-gap').selectOption('8');
	await page.locator('#builder-field-styles-width-length').fill('75%');
	await page.locator('#builder-field-styles-width-length').blur();
	const canvasContainer = page.getByTestId('builder-canvas').locator(`[data-builder-id="${containerId}"]`);
	await expect(canvasContainer).toHaveCSS('display', 'grid');
	await expect(canvasContainer).toHaveCSS('gap', '8px');
	await expect(canvasContainer).toHaveAttribute('style', /width: 75%/);
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.setViewportSize({ width: 390, height: 900 });
	await page.goto(`/pages/${slug}`);
	const publicContainer = page.locator(`[data-builder-id="${containerId}"]`);
	await expect(publicContainer).toHaveCSS('display', 'grid');
	await expect(publicContainer).toHaveCSS('gap', '8px');
	await expect(publicContainer.locator('hr')).toHaveCount(1);
	await expect(publicContainer.locator(`[data-builder-id="${spacerId}"]`)).toHaveAttribute('aria-hidden', 'true');
	await expect(page.locator('.builder-preview-node, .builder-responsive-badge')).toHaveCount(0);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await expect(publicContainer).toHaveCSS('display', 'flex');
	assertNoBrowserIssues(issues);
});

test('preserves, edits and publishes legacy desktop responsive styles', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('legacy-responsive');
	await createPage(page, slug);
	const loaded = await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json();
	const document = { ...loaded.document, schemaVersion: 1, nodes: [{
		id: 'node_legacyheading', type: 'Heading', componentVersion: 1,
		props: { text: 'تیتر قدیمی', level: 2, align: 'start', color: 'ink', size: 'lg' },
		styles: { width: 'full' }, responsiveStyles: { desktop: { width: '40%', height: '20px' }, mobile: { width: '70%' } },
	}] };
	const saved = await page.request.put(`/cms/api/builder/pages/${slug}`, { headers: { accept: 'application/json' }, data: { expectedRevision: loaded.revision, document } });
	expect(saved.status()).toBe(200);
	await page.reload();
	await page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node').first().click();
	await expect(page.locator('#builder-field-styles-width-length')).toHaveValue('40%');
	await expect(page.getByTestId('builder-canvas').locator('h2')).toHaveAttribute('style', /width:\s*40%/);
	await page.locator('#builder-field-styles-width-length').fill('50%');
	await page.locator('#builder-field-styles-width-length').blur();
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	const stored = (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document.nodes[0];
	expect(stored.styles.width).toBe('50%');
	expect(stored.responsiveStyles.desktop.height).toBe('20px');
	expect(stored.responsiveStyles.desktop.width).toBeUndefined();
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('[data-builder-id="node_legacyheading"]')).toHaveAttribute('style', /width:50%/);
	await page.setViewportSize({ width: 390, height: 900 });
	const width = await page.locator('[data-builder-id="node_legacyheading"]').evaluate((node) => getComputedStyle(node).width);
	const parentWidth = await page.locator('[data-builder-id="node_legacyheading"]').evaluate((node) => getComputedStyle(node.parentElement!).width);
	expect(parseFloat(width) / parseFloat(parentWidth)).toBeCloseTo(0.7, 1);
	assertNoBrowserIssues(issues);
});

test('edits semantic quotes and accordion collections with undo, preview and published interaction', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('extended-text');
	await createPage(page, slug);
	await page.getByTestId('add-component-blockquote').click();
	await page.locator('#builder-field-text').fill('تجربهٔ خوب <script>alert(1)</script>');
	await page.locator('#builder-field-author').fill('مشتری');
	await page.locator('#builder-field-role').fill('مدیر');
	await page.getByTestId('add-component-accordion').click();
	const items = page.getByTestId('accordion-item');
	await expect(items).toHaveCount(1);
	await items.first().getByLabel('عنوان پرسش').fill('پرسش یک');
	await items.first().getByLabel('پاسخ').fill('پاسخ یک');
	await page.getByRole('button', { name: 'افزودن پرسش' }).click();
	await expect(items).toHaveCount(2);
	await items.nth(1).getByLabel('عنوان پرسش').fill('پرسش دو');
	await items.nth(1).getByLabel('پاسخ').fill('پاسخ دو');
	await items.nth(1).getByRole('button', { name: 'انتقال پرسش 2 به بالا' }).click();
	await expect(items.first().getByLabel('عنوان پرسش')).toHaveValue('پرسش دو');
	await page.getByTestId('undo').click();
	await expect(items.first().getByLabel('عنوان پرسش')).toHaveValue('پرسش یک');
	await page.getByTestId('redo').click();
	await expect(items.first().getByLabel('عنوان پرسش')).toHaveValue('پرسش دو');
	await items.first().getByRole('button', { name: 'حذف پرسش' }).click();
	await expect(items).toHaveCount(1);
	await page.getByTestId('undo').click();
	await expect(items).toHaveCount(2);

	await page.getByRole('button', { name: 'پیش‌نمایش صفحه' }).click();
	const preview = page.getByRole('dialog', { name: 'پیش‌نمایش تغییرات فعلی' });
	await expect(preview.locator('blockquote p')).toHaveText('تجربهٔ خوب <script>alert(1)</script>');
	await expect(preview.locator('blockquote script')).toHaveCount(0);
	await preview.locator('summary').first().click();
	await expect(preview.locator('details').first()).toHaveAttribute('open', '');
	await expect(preview.locator('details').first()).toContainText('پاسخ دو');
	await preview.getByRole('button', { name: 'بستن پیش‌نمایش' }).click();

	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('builder-canvas').locator('blockquote cite')).toHaveText('مشتری');
	await expect(page.getByTestId('builder-canvas').locator('summary').first()).toHaveText('پرسش دو');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('blockquote p')).toHaveText('تجربهٔ خوب <script>alert(1)</script>');
	await expect(page.locator('blockquote script')).toHaveCount(0);
	await page.locator('summary').first().click();
	await expect(page.locator('details').first()).toHaveAttribute('open', '');
	await expect(page.locator('details').first()).toContainText('پاسخ دو');
	assertNoBrowserIssues(issues);
});

test('edits gallery items, attaches managed media, protects uploads and publishes responsive images', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('gallery');
	await createPage(page, slug);
	await page.getByTestId('add-component-imagegallery').click();
	const items = page.getByTestId('gallery-item');
	await expect(items).toHaveCount(1);
	await items.first().getByRole('button', { name: 'انتخاب تصویر از رسانه' }).click();
	const picker = page.getByTestId('media-picker');
	await expect(picker).toBeVisible();
	const builtin = picker.locator('[data-testid="media-asset"][data-asset-ref^="media://assets/"]').first();
	const builtinRef = await builtin.getAttribute('data-asset-ref');
	await builtin.click();
	await expect(picker).toBeHidden();
	await items.first().getByLabel('متن جایگزین').fill('تصویر نخست');
	await items.first().getByLabel('زیرنویس').fill('زیرنویس نخست');
	await page.getByRole('button', { name: 'افزودن تصویر' }).click();
	await expect(items).toHaveCount(2);
	await items.nth(1).getByRole('button', { name: 'انتخاب تصویر از رسانه' }).click();
	const uploadPromise = page.waitForResponse((response) => response.url().includes('/cms/api/media/upload') && response.request().method() === 'POST');
	await picker.locator('input[type="file"]').setInputFiles({ name: 'e2e-pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64') });
	const uploadResponse = await uploadPromise;
	expect(uploadResponse.ok()).toBeTruthy();
	const uploaded = (await uploadResponse.json()).files[0] as { name: string; assetRef: string };
	await trackUploaded(page, uploaded.name);
	await expect(picker).toBeHidden();
	await items.nth(1).getByLabel('متن جایگزین').fill('تصویر دوم');
	await items.nth(1).getByLabel('زیرنویس').fill('زیرنویس دوم');
	await page.locator('#builder-field-columns').selectOption('4');
	await items.nth(1).getByRole('button', { name: 'انتقال تصویر 2 به بالا' }).click();
	await expect(items.first().getByLabel('متن جایگزین')).toHaveValue('تصویر دوم');
	await page.getByTestId('undo').click();
	await expect(items.first().getByLabel('متن جایگزین')).toHaveValue('تصویر نخست');
	await page.getByTestId('redo').click();
	await expect(items.first().getByLabel('متن جایگزین')).toHaveValue('تصویر دوم');
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	const saved = await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json();
	expect(saved.document.nodes[0].props.items.map((item: { src: string }) => item.src)).toEqual([uploaded.assetRef, builtinRef]);
	const deletion = await page.request.delete(`/cms/api/media/${encodeURIComponent(uploaded.name)}`, { headers: { accept: 'application/json' } });
	expect(deletion.status()).toBe(409);
	await page.reload();
	await page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node').first().click();
	await expect(items.first().getByLabel('متن جایگزین')).toHaveValue('تصویر دوم');
	await expect(items.nth(1).getByLabel('نشانی تصویر')).toHaveValue(builtinRef!);
	await page.getByRole('button', { name: 'موبایل' }).click();
	const columns = (selector: string) => page.locator(selector).evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(/\s+/).length);
	const previewGallery = page.locator('[data-testid="builder-canvas"] .nvx-builder-gallery');
	// Wait for the simulated mobile width to settle before checking container queries.
	await expect.poll(() => previewGallery.evaluate((node) => node.getBoundingClientRect().width)).toBeLessThan(330);
	await expect.poll(() => previewGallery.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(320);
	const previewWidth = await previewGallery.evaluate((node) => node.getBoundingClientRect().width);
	await expect.poll(() => columns('[data-testid="builder-canvas"] .nvx-builder-gallery')).toBe(2);
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	const gallery = page.locator('.nvx-builder-gallery');
	await expect(gallery).toHaveAttribute('data-columns', '4');
	await expect(gallery.locator('img')).toHaveCount(2);
	await expect(gallery.locator('img').first()).toHaveAttribute('alt', 'تصویر دوم');
	await expect(gallery.locator('figcaption').first()).toHaveText('زیرنویس دوم');
	await expect(gallery.locator('img').first()).toHaveAttribute('src', `/media/uploads/${uploaded.name}`);
	await expect.poll(() => columns('.nvx-builder-gallery')).toBe(4);
	await page.setViewportSize({ width: 390, height: 900 });
	await expect.poll(() => columns('.nvx-builder-gallery')).toBe(2);
	const publishedWidth = await gallery.evaluate((node) => node.getBoundingClientRect().width);
	expect(Math.abs(publishedWidth - previewWidth)).toBeLessThanOrEqual(3);
	await page.setViewportSize({ width: 260, height: 900 });
	await expect.poll(() => columns('.nvx-builder-gallery')).toBe(1);
	assertNoBrowserIssues(issues);
});

test('keeps provider video IDs separate, rejects invalid IDs and emits only fixed-host embeds', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('video');
	let videoRequests = 0;
	page.on('request', (req) => { if (/youtube-nocookie\.com|player\.vimeo\.com/.test(req.url())) videoRequests++; });
	await page.route('https://player.vimeo.com/video/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Test player</title>' }));
	await page.route('https://www.youtube-nocookie.com/embed/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Test player</title>' }));
	await createPage(page, slug);
	await page.getByTestId('add-component-videoembed').click();
	await page.locator('#builder-field-youtubeId').fill('dQw4w9WgXcQ');
	await page.locator('#builder-field-youtubeId').press('Enter');
	await expect(page.getByTestId('builder-canvas')).toContainText('پیش‌نمایش YouTube');
	await expect(page.getByTestId('builder-canvas').locator('iframe')).toHaveCount(0);
	expect(videoRequests).toBe(0);
	await page.locator('#builder-field-youtubeId').fill('invalid');
	await page.locator('#builder-field-youtubeId').press('Enter');
	await expect(page.locator('.builder-message')).toContainText('YouTube video ID is invalid');
	await page.locator('#builder-field-provider').selectOption('vimeo');
	await page.locator('#builder-field-vimeoId').fill('123456789');
	await page.locator('#builder-field-vimeoId').press('Enter');
	await page.locator('#builder-field-title').fill('ویدئوی معرفی');
	await page.locator('#builder-field-provider').selectOption('youtube');
	await expect(page.locator('#builder-field-youtubeId')).toHaveValue('dQw4w9WgXcQ');
	await page.locator('#builder-field-provider').selectOption('vimeo');
	await expect(page.locator('#builder-field-vimeoId')).toHaveValue('123456789');
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	const saved = await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json();
	expect(saved.document.nodes[0].props).toMatchObject({ provider: 'vimeo', youtubeId: 'dQw4w9WgXcQ', vimeoId: '123456789', title: 'ویدئوی معرفی' });
	expect(videoRequests).toBe(0);
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	const iframe = page.locator('.nvx-builder-video iframe');
	await expect(iframe).toHaveAttribute('src', 'https://player.vimeo.com/video/123456789');
	await expect(iframe).toHaveAttribute('title', 'ویدئوی معرفی');
	await expect(iframe).toHaveAttribute('loading', 'lazy');
	await expect(iframe).toHaveAttribute('sandbox', /allow-scripts/);
	await page.goto(`/cms/builder/${slug}`);
	await page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node').first().click();
	await page.locator('#builder-field-provider').selectOption('youtube');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('.nvx-builder-video iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
	assertNoBrowserIssues(issues);
});


test('respects contributor permissions in the gallery media picker', async ({ page, browser }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('gallery-role');
	await createPage(page, slug);
	await page.getByTestId('add-component-imagegallery').click();
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	const username = `e2e-gallery-contributor-${Date.now().toString(36)}`;
	const created = await page.request.post('/cms/api/users', { headers: { accept: 'application/json' }, data: { username, password: 'temporary-e2e-password', role: 'contributor' } });
	expect(created.status()).toBe(201);
	const user = (await created.json()).user as { id: string };
	const context = await browser.newContext();
	try {
		const editor = await context.newPage();
		const contributorIssues = monitorBrowser(editor);
		await editor.goto('/cms/login');
		await editor.getByLabel('نام کاربری').fill(username);
		await editor.locator('#cms-password').fill('temporary-e2e-password');
		await editor.getByRole('button', { name: 'ورود به پنل' }).click();
		await editor.waitForURL((url) => url.pathname === '/cms/posts');
		const deepLogin = await context.request.post('/cms/api/login', { headers: { accept: 'application/json' }, data: { username, password: 'temporary-e2e-password', next: `/cms/builder/${slug}` } });
		expect((await deepLogin.json()).redirect).toBe(`/cms/builder/${slug}`);
		const unsafeLogin = await context.request.post('/cms/api/login', { headers: { accept: 'application/json' }, data: { username, password: 'temporary-e2e-password', next: 'https://example.com/' } });
		expect((await unsafeLogin.json()).redirect).toBe('/cms/posts');
		await editor.goto(`/cms/builder/${slug}`);
		await editor.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node').first().click();
		await editor.getByTestId('gallery-item').first().getByRole('button', { name: 'انتخاب تصویر از رسانه' }).click();
		const picker = editor.getByTestId('media-picker');
		await expect(picker).toBeVisible();
		await expect(picker.locator('input[type="file"]')).toHaveCount(0);
		await expect(picker).toContainText('بارگذاری برای نقش شما مجاز نیست');
		await picker.getByTestId('media-asset').first().click();
		await expect(picker).toBeHidden();
		await expect(editor.getByTestId('publish-page')).toHaveCount(0);
		await editor.getByTestId('save-page').click();
		await expect(editor.locator('.builder-save-state--saved')).toBeVisible();
		const forbidden = await editor.request.post('/cms/api/media/upload', { headers: { accept: 'application/json' } });
		expect(forbidden.status()).toBe(403);
		assertNoBrowserIssues(contributorIssues);
	} finally {
		await context.close();
		await page.request.delete(`/cms/api/users/${encodeURIComponent(user.id)}`, { headers: { accept: 'application/json' } });
	}
	assertNoBrowserIssues(issues);
});

test('imports native Elementor content with review, media replacement and publication', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('elementor-extended');
	let providerRequests = 0;
	page.on('request', (req) => { if (/youtube-nocookie\.com|player\.vimeo\.com/.test(req.url())) providerRequests++; });
	await page.route('https://www.youtube-nocookie.com/embed/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Test player</title>' }));
	await createPage(page, slug);
	const widget = (id: string, widgetType: string, settings: Record<string, unknown>) => ({ id, widgetType, elType: 'widget', settings, elements: [] });
	const source = { version: '0.4', content: [
		widget('questions', 'accordion', { tabs: [{ tab_title: 'پرسش <strong>واردشده</strong>', tab_content: '<p>پاسخ <a href="/answers"><em>واردشده</em></a></p>' }] }),
		widget('gallery', 'basic-gallery', { wp_gallery: [{ url: 'http://127.0.0.1/private.png', alt: 'شرح تصویر' }] }),
		widget('quote', 'testimonial', { testimonial_content: 'نظر مشتری', testimonial_name: 'نام مشتری' }),
		widget('video', 'video', { youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
	] };
	await page.getByTestId('elementor-import-file').setInputFiles({ name: 'extended-elementor.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
	const dialog = page.getByRole('dialog', { name: 'بررسی ورود Elementor' });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText('تصاویر گالری بارگیری نشدند');
	await expect(dialog).toContainText('تنها شناسهٔ ویدئو منتقل شد');
	await expect(dialog.locator('summary')).toHaveText('پرسش واردشده');
	await expect(dialog.locator('summary strong')).toHaveText('واردشده');
	await expect(dialog.locator('.nvx-builder-accordion p a em')).toHaveText('واردشده');
	await expect(dialog.locator('blockquote')).toContainText('نظر مشتری');
	expect(providerRequests).toBe(0);
	page.once('dialog', (confirmation) => confirmation.accept());
	await dialog.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	await expect(page.getByTestId('builder-canvas').locator('summary')).toHaveText('پرسش واردشده');
	const tree = page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node');
	await tree.filter({ hasText: 'پرسش‌های بازشونده' }).click();
	await page.getByTestId('accordion-item').first().getByLabel('پاسخ').fill('پاسخ جدید واردشده');
	await expect(page.getByTestId('builder-canvas').locator('.nvx-builder-accordion p a em')).toHaveText('واردشده');
	await tree.filter({ hasText: 'گالری تصویر' }).click();
	await expect(page.getByTestId('gallery-item').first().getByLabel('متن جایگزین')).toHaveValue('شرح تصویر');
	await page.getByTestId('gallery-item').first().getByRole('button', { name: 'انتخاب تصویر از رسانه' }).click();
	await page.getByTestId('media-picker').getByTestId('media-asset').first().click();
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	const saved = await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json();
	expect(saved.document.nodes.map((node: { type: string }) => node.type)).toEqual(['Accordion', 'ImageGallery', 'Blockquote', 'VideoEmbed']);
	expect(JSON.stringify(saved.document)).not.toContain('127.0.0.1');
	expect(providerRequests).toBe(0);
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('summary')).toHaveText('پرسش واردشده');
	await expect(page.locator('summary strong')).toHaveText('واردشده');
	await expect(page.locator('.nvx-builder-accordion p a')).toHaveAttribute('href', '/answers');
	await expect(page.locator('.nvx-builder-accordion p a em')).toHaveText('واردشده');
	await expect(page.locator('.nvx-builder-gallery img')).toHaveAttribute('alt', 'شرح تصویر');
	await expect(page.locator('blockquote')).toContainText('نظر مشتری');
	await expect(page.locator('.nvx-builder-video iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
	assertNoBrowserIssues(issues);
});

test('imports editable WordPress ordered lists and publishes semantic links', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('wxr-list');
	await createPage(page, slug);
	const html = '<ol><li><a href="/about">مرحلهٔ نخست</a></li><li>مرحلهٔ دوم</li></ol>';
	const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>فهرست وردپرس</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[${html}]]></content:encoded></item></channel></rss>`;
	await page.getByTestId('wxr-import-file').setInputFiles({ name: 'list.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	const review = page.getByRole('dialog', { name: 'بررسی خروجی WordPress WXR' });
	await expect(review).toContainText('فهرست‌های ساده');
	page.once('dialog', (confirmation) => confirmation.accept());
	await review.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	const canvas = page.getByTestId('builder-canvas');
	await expect(canvas.locator('ol li')).toHaveCount(2);
	await page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node').filter({ hasText: 'فهرست' }).click();
	await expect(page.getByTestId('list-item')).toHaveCount(2);
	await page.getByTestId('list-item').nth(1).getByLabel('متن مورد').fill('مرحلهٔ ویرایش‌شده');
	await expect(canvas.locator('ol li').nth(1)).toHaveText('مرحلهٔ ویرایش‌شده');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('.nvx-page__content ol li')).toHaveCount(2);
	await expect(page.locator('.nvx-page__content ol li').first().locator('a')).toHaveAttribute('href', '/about');
	await expect(page.locator('.nvx-page__content ol li').nth(1)).toHaveText('مرحلهٔ ویرایش‌شده');
	assertNoBrowserIssues(issues);
});

test('imports editable Elementor tabs with keyboard interaction and a no-script fallback', async ({ page, browser }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('elementor-tabs');
	await createPage(page, slug);
	const source = { version: '0.4', content: [{ id: 'tabs-source', elType: 'widget', widgetType: 'tabs', settings: { tabs: [
		{ tab_title: '<strong>مشخصات</strong>', tab_content: '<p>متن <em>مشخصات</em></p>' }, { tab_title: 'ارسال', tab_content: '<p>متن <a href="/shipping">ارسال</a></p><script>window.tabInjection=true</script>' },
	] }, elements: [] }] };
	await page.getByTestId('elementor-import-file').setInputFiles({ name: 'tabs.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
	const review = page.getByRole('dialog', { name: 'بررسی ورود Elementor' });
	await expect(review).toContainText('زبانه‌ها تعاملی و قابل ویرایش هستند');
	page.once('dialog', (confirmation) => confirmation.accept());
	await review.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	const canvas = page.getByTestId('builder-canvas');
	await expect(canvas.getByRole('tab', { name: 'مشخصات' })).toHaveAttribute('aria-selected', 'true');
	await expect(canvas.getByRole('tab', { name: 'مشخصات' }).locator('strong')).toHaveText('مشخصات');
	await expect(canvas.getByRole('tabpanel').locator('em')).toHaveText('مشخصات');
	await canvas.getByRole('tab', { name: 'ارسال' }).click();
	await expect(canvas.getByRole('tabpanel')).toContainText('متن ارسال');
	await expect(canvas.getByRole('tabpanel').locator('a')).toHaveAttribute('href', '/shipping');
	await page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node').filter({ hasText: 'زبانه‌ها' }).click();
	await expect(page.getByTestId('tab-item')).toHaveCount(2);
	await page.getByTestId('tab-item').nth(1).getByLabel('عنوان زبانه').fill('نحوهٔ ارسال');
	await expect(canvas.getByRole('tab', { name: 'نحوهٔ ارسال' })).toBeVisible();
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	const first = page.getByRole('tab', { name: 'مشخصات' });
	const second = page.getByRole('tab', { name: 'نحوهٔ ارسال' });
	await expect(first).toHaveAttribute('aria-selected', 'true');
	await first.focus(); await first.press('End');
	await expect(second).toBeFocused(); await expect(second).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('tabpanel')).toContainText('متن ارسال');
	await expect(page.getByRole('tabpanel').locator('a')).toHaveAttribute('href', '/shipping');
	await expect(first.locator('strong')).toHaveText('مشخصات');
	await second.press('Home'); await expect(first).toBeFocused();
	expect(await page.evaluate(() => (window as unknown as { tabInjection?: boolean }).tabInjection)).toBeUndefined();
	const noScript = await browser.newContext({ javaScriptEnabled: false });
	try {
		const fallback = await noScript.newPage();
		await fallback.goto(new URL(`/pages/${slug}`, page.url()).href);
		await expect(fallback.locator('.nvx-builder-tabs__panel')).toHaveCount(2);
		await expect(fallback.getByText('متن مشخصات')).toBeVisible();
		await expect(fallback.getByText('متن ارسال')).toBeVisible();
		await expect(fallback.getByRole('tablist')).toHaveCount(0);
	} finally { await noScript.close(); }
	assertNoBrowserIssues(issues);
});

test('configures breakpoint thresholds with undo, reload and published boundary behavior', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('custom-breakpoints');
	await createPage(page, slug);
	const tablet = page.getByLabel('حداکثر عرض تبلت (px)');
	const mobile = page.getByLabel('حداکثر عرض موبایل (px)');
	await tablet.fill('900');
	await tablet.blur();
	await mobile.fill('500');
	await mobile.blur();
	await page.getByTestId('undo').click();
	await expect(mobile).toHaveValue('767');
	await page.getByTestId('redo').click();
	await expect(mobile).toHaveValue('500');
	await mobile.fill('1000');
	await mobile.blur();
	await expect(page.getByRole('alert')).toContainText('عرض‌ها باید عدد صحیح باشند');
	await expect(mobile).toHaveValue('500');
	await page.getByTestId('add-component-container').click();
	await page.locator('#builder-field-layout').selectOption('row');
	const containerId = await page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node').first().getAttribute('data-node-id');
	await page.getByRole('button', { name: 'تبلت' }).click();
	await page.locator('#builder-field-styles-width-length').fill('70%');
	await page.locator('#builder-field-styles-width-length').blur();
	await page.getByRole('button', { name: 'موبایل' }).click();
	await page.locator('#builder-field-styles-width-length').fill('40%');
	await page.locator('#builder-field-styles-width-length').blur();
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	await page.reload();
	const saved = (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document;
	expect(saved.schemaVersion).toBe(5);
	expect(saved.breakpoints).toEqual({ tablet: 900, mobile: 500 });
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	const container = page.locator(`[data-builder-id="${containerId}"]`);
	const ratio = () => container.evaluate((node) => node.getBoundingClientRect().width / node.parentElement!.getBoundingClientRect().width);
	await page.setViewportSize({ width: 950, height: 900 });
	await expect(container).toHaveCSS('flex-direction', 'row');
	expect(await ratio()).toBeCloseTo(1, 1);
	await page.setViewportSize({ width: 550, height: 900 });
	await expect(container).toHaveCSS('flex-direction', 'row');
	expect(await ratio()).toBeCloseTo(0.7, 1);
	await page.setViewportSize({ width: 500, height: 900 });
	await expect(container).toHaveCSS('flex-direction', 'column');
	expect(await ratio()).toBeCloseTo(0.4, 1);
	assertNoBrowserIssues(issues);
});


test('opt-in media reuse identifies the original and never silently creates or deletes it', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('media-dedup');
	await createPage(page, slug);
	await page.getByTestId('add-component-image').click();
	await page.getByTestId('open-media-picker').click();
	const picker = page.getByTestId('media-picker');
	const bytes = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64'), randomBytes(32)]);
	const firstResponse = page.waitForResponse((response) => response.url().includes('/cms/api/media/upload') && response.request().method() === 'POST');
	await picker.locator('input[type="file"]').setInputFiles({ name: 'e2e-pixel.png', mimeType: 'image/png', buffer: bytes });
	const first = (await (await firstResponse).json()).files[0] as { name: string; assetRef: string; reused: boolean };
	expect(first.reused).toBe(false);
	await trackUploaded(page, first.name);
	await expect(picker).toBeHidden();
	await page.getByTestId('open-media-picker').click();
	await picker.getByLabel('استفاده از فایل یکسان موجود', { exact: true }).check();
	const secondResponse = page.waitForResponse((response) => response.url().includes('/cms/api/media/upload') && response.request().method() === 'POST');
	await picker.locator('input[type="file"]').setInputFiles({ name: 'e2e-pixel.png', mimeType: 'image/png', buffer: bytes });
	const second = (await (await secondResponse).json()).files[0] as { name: string; assetRef: string; reused: boolean };
	expect(second).toMatchObject({ name: first.name, assetRef: first.assetRef, reused: true });
	await expect(picker).toBeHidden();
	await expect(page.locator('.builder-message')).toContainText('فایل یکسان موجود');
	await expect(page.locator('#builder-field-src')).toHaveValue(first.assetRef);
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	const deletion = await page.request.delete(`/cms/api/media/${encodeURIComponent(first.name)}`, { headers: { accept: 'application/json' } });
	expect(deletion.status()).toBe(409);
	assertNoBrowserIssues(issues);
});

test('shares section sources across drafts with explicit sync and immutable published snapshots', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const first = slugFor('shared-source');
	const second = slugFor('shared-target');
	await createPage(page, first);
	await page.getByTestId('add-component-container').click();
	await page.getByTestId('add-component-heading').click();
	await page.locator('#builder-field-text').fill('تیتر مشترک قدیمی');
	const tree = page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node');
	await tree.first().click();
	await page.getByRole('button', { name: 'ساخت بخش مشترک از انتخاب' }).click();
	const dialog = page.getByRole('dialog', { name: 'ساخت بخش مشترک' });
	await dialog.getByLabel('نام بخش مشترک').fill('سربرگ مشترک');
	await dialog.getByRole('button', { name: 'ساخت و پیوند بخش' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator('.builder-message')).toContainText('بخش مشترک ساخته');
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();

	await createPage(page, second);
	await page.getByRole('button', { name: 'قالب‌ها', exact: true }).click();
	const library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	await library.getByText('بخش‌های مشترک', { exact: true }).click();
	const shared = library.locator('li').filter({ hasText: 'سربرگ مشترک' });
	await expect(shared).toBeVisible();
	await shared.getByRole('button', { name: 'درج بخش مشترک' }).click();
	await expect(page.getByTestId('builder-canvas')).toContainText('تیتر مشترک قدیمی');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${second}`);
	await expect(page.locator('.nvx-page__content')).toContainText('تیتر مشترک قدیمی');

	await page.goto(`/cms/builder/${first}`);
	const sourceTree = page.getByRole('list', { name: 'ساختار صفحه' }).getByTestId('tree-node');
	await sourceTree.nth(1).click();
	await page.locator('#builder-field-text').fill('تیتر مشترک تازه');
	await sourceTree.first().click();
	page.once('dialog', (confirmation) => confirmation.accept());
	await page.getByRole('button', { name: 'به‌روزرسانی منبع مشترک' }).click();
	await expect(page.locator('.builder-message')).toContainText('منبع مشترک به‌روز شد');
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	page.once('dialog', (confirmation) => confirmation.accept());
	await page.getByRole('button', { name: 'همگام‌سازی بخش مشترک', exact: true }).click();
	await expect(page.locator('.builder-message')).toContainText('پیش‌نویس همگام شد');
	await page.goto(`/pages/${second}`);
	await expect(page.locator('.nvx-page__content')).toContainText('تیتر مشترک قدیمی');
	await page.goto(`/cms/builder/${second}`);
	await expect(page.getByTestId('builder-canvas')).toContainText('تیتر مشترک تازه');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${second}`);
	await expect(page.locator('.nvx-page__content')).toContainText('تیتر مشترک تازه');
	assertNoBrowserIssues(issues);
});

test('reviews and installs a data-only JSON kit, then resolves a conflicting update', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const editor = slugFor('kit-package-editor');
	const prefix = slugFor('package');
	await createPage(page, editor);
	await page.getByRole('button', { name: 'قالب‌ها', exact: true }).click();
	const library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	await library.getByText('بستهٔ سایت JSON', { exact: true }).click();
	const makeKit = (version: string, text: string) => ({
		schemaVersion: 1, id: 'browser-package', version, name: 'بستهٔ مرورگر', description: '', category: 'business', language: 'fa', direction: 'rtl', minBuilderSchema: 3, license: 'MIT', author: 'Test', requiredComponents: ['Heading'], assets: [],
		pages: [{ suffix: 'home', title: 'خانه', document: { schemaVersion: 3, id: 'page_kit-source', slug: 'kit-source', title: 'خانه', description: '', themeId: 'site', nodes: [{ id: 'node_browserkit01', type: 'Heading', componentVersion: 1, props: { text, level: 2, align: 'start', color: 'ink', size: 'lg' } }] } }],
	});
	const file = (version: string, text: string) => ({ name: 'package.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(makeKit(version, text))) });
	await library.getByTestId('site-kit-package').setInputFiles(file('1.0.0', 'تیتر نخست'));
	await expect(library).toContainText('بستهٔ مرورگر');
	await library.getByLabel('پیشوند بستهٔ JSON').fill(prefix);
	page.once('dialog', (confirmation) => confirmation.accept());
	await library.getByRole('button', { name: 'نصب بستهٔ JSON' }).click();
	await expect(library).toContainText(`${prefix}-home`);
	const slug = `${prefix}-home`;
	const initial = await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json();
	expect(initial.revision).toBe(1);
	expect((await page.request.get(`/pages/${slug}`)).status()).toBe(404);
	const local = await page.request.put(`/cms/api/builder/pages/${slug}`, { headers: { accept: 'application/json' }, data: { expectedRevision: 1, document: { ...initial.document, title: 'عنوان ویرایش‌شده', nodes: [{ ...initial.document.nodes[0], props: { ...initial.document.nodes[0].props, text: 'تیتر محلی' } }] } } });
	expect(local.status()).toBe(200);
	await library.getByTestId('site-kit-package').setInputFiles(file('1.1.0', 'تیتر تازه'));
	await expect(library).toContainText('نسخهٔ 1.1.0');
	await library.getByRole('button', { name: 'به‌روزرسانی بستهٔ JSON' }).click();
	const review = page.getByRole('dialog', { name: 'بررسی تعارض بسته' });
	await expect(review.getByTestId('kit-review-field')).toHaveCount(1);
	await expect(review).toContainText('تیتر نخست'); await expect(review).toContainText('تیتر محلی'); await expect(review).toContainText('تیتر تازه');
	const apply = review.getByRole('button', { name: 'تأیید و به‌روزرسانی پیش‌نویس‌ها' });
	await expect(apply).toBeDisabled();
	await review.getByLabel('استفاده از مقدار بسته').check();
	const beforeStale = await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json();
	const changedAfterReview = await page.request.put(`/cms/api/builder/pages/${slug}`, { headers: { accept: 'application/json' }, data: { expectedRevision: beforeStale.revision, document: { ...beforeStale.document, description: 'ویرایش پس از بررسی' } } });
	expect(changedAfterReview.status()).toBe(200);
	page.once('dialog', (confirmation) => confirmation.accept());
	await apply.click();
	await expect(review.getByRole('alert')).toContainText('پس از بررسی تغییر کرده');
	await expect.poll(() => issues.consoleErrors.filter((entry) => entry.includes('status of 409 (Conflict)')).length).toBe(1);
	issues.consoleErrors = issues.consoleErrors.filter((entry) => !entry.includes('status of 409 (Conflict)'));
	await review.getByRole('button', { name: 'بستن', exact: true }).click();
	await library.getByRole('button', { name: 'به‌روزرسانی بستهٔ JSON' }).click();
	await expect(review.getByTestId('kit-review-field')).toHaveCount(1);
	await review.getByLabel('استفاده از مقدار بسته').check();
	page.once('dialog', (confirmation) => confirmation.accept());
	await apply.click();
	await expect(review).toHaveCount(0);
	await expect(library).toContainText('انتشار تغییر نکرد');
	const updated = (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document;
	expect(updated.title).toBe('عنوان ویرایش‌شده');
	expect(updated.description).toBe('ویرایش پس از بررسی');
	expect(updated.nodes[0].props.text).toBe('تیتر تازه');
	await page.goto(`/cms/builder/${slug}`);
	await expect(page.getByTestId('builder-canvas')).toContainText('تیتر تازه');
	assertNoBrowserIssues(issues);
});

test('reviews a ZIP kit with local images, installs and merges it without republishing', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const editor = slugFor('zip-kit-editor');
	const prefix = slugFor('zip-kit');
	const pixels = await sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
	const makeArchive = async (version: string, alt: string) => {
		const kit = {
			schemaVersion: 1, id: 'browser-zip-package', version, name: 'بستهٔ تصویری', description: '', category: 'business', language: 'fa', direction: 'rtl', minBuilderSchema: 3, license: 'MIT', author: 'Test', requiredComponents: ['Image'], assets: ['media://uploads/hero.png'],
			pages: [{ suffix: 'home', title: 'خانهٔ تصویری', document: { schemaVersion: 3, id: 'page_zip-source', slug: 'zip-source', title: 'خانه', description: '', themeId: 'site', nodes: [{ id: 'node_browserzip1', type: 'Image', componentVersion: 1, props: { src: 'media://uploads/hero.png', alt, caption: '', aspectRatio: 'auto', fit: 'cover' } }] } }],
		};
		const zip = new ZipFile();
		const chunks: Buffer[] = [];
		const finished = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); });
		zip.addBuffer(Buffer.from(JSON.stringify(kit)), 'kit.json'); zip.addBuffer(pixels, 'assets/hero.png'); zip.end();
		return { name: 'kit.zip', mimeType: 'application/zip', buffer: await finished };
	};
	await createPage(page, editor);
	await page.getByRole('button', { name: 'قالب‌ها', exact: true }).click();
	const library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	await library.getByText('بستهٔ سایت ZIP', { exact: true }).click();
	await library.getByTestId('site-kit-archive').setInputFiles(await makeArchive('1.0.0', 'تصویر نخست'));
	await expect(library).toContainText('بستهٔ تصویری');
	await expect(library).toContainText('بسته بدون نوشتن فایل بررسی شد');
	await library.getByLabel('پیشوند بستهٔ ZIP').fill(prefix);
	page.once('dialog', (dialog) => dialog.accept());
	const installResponse = page.waitForResponse((response) => response.url().endsWith('/cms/api/builder/kits/archive') && response.request().method() === 'POST');
	await library.getByRole('button', { name: 'نصب بستهٔ ZIP' }).click();
	const installed = await (await installResponse).json();
	for (const name of installed.createdUploads as string[]) await trackUploaded(page, name);
	expect(installed.uploaded).toBe(1);
	await expect(library).toContainText(`${prefix}-home`);
	const slug = `${prefix}-home`;
	const initial = await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json();
	expect(initial.document.nodes[0].props.src).toMatch(/^media:\/\/uploads\/kit-[a-f0-9]{64}\.png$/);
	expect((await page.request.get(`/pages/${slug}`)).status()).toBe(404);
	const local = await page.request.put(`/cms/api/builder/pages/${slug}`, { headers: { accept: 'application/json' }, data: { expectedRevision: 1, document: { ...initial.document, title: 'عنوان محلی' } } });
	expect(local.status()).toBe(200);
	await library.getByTestId('site-kit-archive').setInputFiles(await makeArchive('1.1.0', 'تصویر تازه'));
	await expect(library).toContainText('نسخهٔ 1.1.0');
	await library.getByRole('button', { name: 'به‌روزرسانی بستهٔ ZIP' }).click();
	const review = page.getByRole('dialog', { name: 'بررسی تعارض بسته' });
	await expect(review).toContainText('تعارضی پیدا نشد');
	page.once('dialog', (dialog) => dialog.accept());
	const updateResponse = page.waitForResponse((response) => response.url().endsWith('/cms/api/builder/kits/archive') && response.request().method() === 'POST');
	await review.getByRole('button', { name: 'تأیید و به‌روزرسانی پیش‌نویس‌ها' }).click();
	const updated = await (await updateResponse).json();
	for (const name of updated.createdUploads as string[]) await trackUploaded(page, name);
	expect(updated.uploaded).toBe(0); expect(updated.reused).toBe(1);
	await expect(library).toContainText('انتشار تغییر نکرد');
	const draft = (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document;
	expect(draft.title).toBe('عنوان محلی'); expect(draft.nodes[0].props.alt).toBe('تصویر تازه');
	await page.goto(`/cms/builder/${slug}`);
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	const image = page.locator('.nvx-page__content img');
	await expect(image).toHaveAttribute('alt', 'تصویر تازه');
	expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(12);
	assertNoBrowserIssues(issues);
});

test('runs reviewed page-author code only inside an opaque sandboxed browser frame', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('isolated-code');
	let probeRequests = 0;
	await page.route('**/cms/api/probe-code-sandbox', (route) => { probeRequests++; return route.abort(); });
	await createPage(page, slug);
	await page.getByTestId('add-component-codewidget').click();
	await page.locator('#builder-field-title').fill('قاب آزمایش');
	await page.locator('#builder-field-html').fill('<p id="result">ابتدا</p></iframe><script>try { parent.document.body.dataset.widgetEscape = "bad"; } catch {}</script>');
	await page.locator('#builder-field-css').fill('#result { color: rgb(255, 0, 0); }');
	await page.locator('#builder-field-javascript').fill(`
		const result = document.getElementById('result');
		result.textContent = 'اجرای درون قاب';
		try { window.parent.document.body.dataset.widgetEscape = 'bad'; result.dataset.parent = 'accessible'; }
		catch { result.dataset.parent = 'blocked'; }
		result.dataset.referrer = document.referrer;
		const marker = '</script><script>window.parent.widgetEscape = true</script>';
		result.dataset.marker = marker.includes('widgetEscape') ? 'intact' : 'broken';
		fetch('/cms/api/probe-code-sandbox').then(() => result.dataset.connect = 'allowed').catch(() => result.dataset.connect = 'blocked');
	`);
	const canvas = page.getByTestId('builder-canvas');
	await expect(canvas.locator('iframe')).toHaveCount(0); // Editing never auto-runs scripts.
	await canvas.getByRole('button', { name: 'اجرای پیش‌نمایش مستقل' }).click();
	const previewFrame = canvas.locator('iframe[title="قاب آزمایش"]');
	await expect(previewFrame).toHaveAttribute('sandbox', 'allow-scripts');
	const result = canvas.frameLocator('iframe[title="قاب آزمایش"]').locator('#result');
	await expect(result).toHaveText('اجرای درون قاب');
	await expect(result).toHaveAttribute('data-parent', 'blocked');
	await expect(result).toHaveAttribute('data-referrer', '');
	await expect(result).toHaveAttribute('data-marker', 'intact');
	await expect(result).toHaveAttribute('data-connect', 'blocked');
	expect(probeRequests).toBe(0);
	await expect(result).toHaveCSS('color', 'rgb(255, 0, 0)');
	expect(await page.evaluate(() => document.body.dataset.widgetEscape)).toBeUndefined();
	await canvas.getByRole('button', { name: 'بستن پیش‌نمایش کد' }).click();
	page.once('dialog', (confirmation) => confirmation.dismiss());
	await page.getByTestId('publish-page').click();
	expect((await page.request.get(`/pages/${slug}`)).status()).toBe(404);
	page.once('dialog', (confirmation) => confirmation.accept());
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	const publishedFrame = page.locator('iframe[title="قاب آزمایش"]');
	await expect(publishedFrame).toHaveAttribute('sandbox', 'allow-scripts');
	await expect(publishedFrame).toHaveAttribute('referrerpolicy', 'no-referrer');
	const publishedResult = page.frameLocator('iframe[title="قاب آزمایش"]').locator('#result');
	await expect(publishedResult).toHaveText('اجرای درون قاب');
	await expect(publishedResult).toHaveAttribute('data-parent', 'blocked');
	await expect(publishedResult).toHaveCSS('color', 'rgb(255, 0, 0)');
	await expect(publishedResult).toHaveAttribute('data-connect', 'blocked');
	expect(probeRequests).toBe(0);
	expect(await page.evaluate(() => document.body.dataset.widgetEscape)).toBeUndefined();
	// CSP intentionally reports the blocked probe; any unrelated browser error remains a failure.
	expect(issues.consoleErrors.some((message) => message.includes('probe-code-sandbox'))).toBeTruthy();
	issues.consoleErrors = issues.consoleErrors.filter((message) => !message.includes('probe-code-sandbox'));
	issues.failedRequests = issues.failedRequests.filter((message) => !message.includes('probe-code-sandbox'));
	assertNoBrowserIssues(issues);
});

test('installs a declarative plugin package and keeps published component snapshots after removal', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const id = `data-browser-${Date.now().toString(36)}`;
	const content = { schemaVersion: 1, id, version: '1.0.0', name: 'بستهٔ دادهٔ مرورگر', description: 'بدون کد', components: [{ pluginId: id, pluginVersion: '1.0.0', componentId: 'browser-card', label: 'کارت مرورگر', fields: [{ key: 'message', label: 'متن بسته', kind: 'text', value: 'متن اولیه', maxLength: 240 }], parts: [{ type: 'text', textKey: 'message' }] }] };
	await page.goto('/cms/plugins');
	const panel = page.locator('#data-plugin-packages');
	await panel.locator('#data-plugin-file').setInputFiles({ name: 'plugin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(content)) });
	await expect(panel.locator('#data-plugin-summary')).toContainText('بستهٔ دادهٔ مرورگر');
	page.once('dialog', (confirmation) => confirmation.accept());
	await panel.getByRole('button', { name: 'نصب بستهٔ مؤلفه' }).click();
	const row = panel.locator(`[data-data-plugin-id="${id}"]`);
	await expect(row).toContainText('فعال');
	const slug = slugFor('data-plugin');
	await createPage(page, slug);
	await page.getByTestId('plugin-component-browser-card').click();
	await page.getByLabel('متن بسته').fill('محتوای پایدار صفحه');
	await expect(page.getByTestId('builder-canvas')).toContainText('محتوای پایدار صفحه');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto('/cms/plugins');
	await row.getByRole('button', { name: 'غیرفعال‌سازی' }).click();
	await expect(row).toContainText('غیرفعال');
	page.once('dialog', (confirmation) => confirmation.accept());
	await row.getByRole('button', { name: 'حذف بسته' }).click();
	await expect(row).toHaveCount(0);
	await page.goto(`/cms/builder/${slug}`);
	await expect(page.getByTestId('builder-canvas')).toContainText('محتوای پایدار صفحه');
	await expect(page.getByTestId('plugin-component-browser-card')).toHaveCount(0);
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('.nvx-builder-plugin')).toContainText('محتوای پایدار صفحه');
	assertNoBrowserIssues(issues);
});

test('reviews a declarative plugin ZIP and inserts its parameterized native preset', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const id = `data-browser-zip-${Date.now().toString(36)}`;
	const content = { schemaVersion: 2, id, version: '1.0.0', name: 'افزونهٔ بسته‌بندی‌شده', description: '', components: [], presets: [{
		id: `${id}-title`, label: 'عنوان افزونهٔ ZIP', description: 'الگوی بومی قابل ویرایش',
		document: { schemaVersion: 3, id: 'page_plugin-source', slug: 'plugin-source', title: 'پیش‌تنظیم', description: '', themeId: 'site', nodes: [{ id: 'node_presetheading1', type: 'Heading', componentVersion: 1, props: { text: 'پیش‌فرض', level: 2, align: 'start', color: 'ink', size: 'lg' } }] },
		parameters: [{ key: 'title', label: 'عنوان دلخواه', nodeId: 'node_presetheading1', property: 'text', defaultValue: 'پیش‌فرض', maxLength: 100 }],
	}] };
	const zip = new ZipFile(); const chunks: Buffer[] = [];
	const ready = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); });
	zip.addBuffer(Buffer.from(JSON.stringify(content)), 'plugin.json'); zip.addBuffer(Buffer.from('<script>window.zipReadmeExecuted = true</script>'), 'README.txt'); zip.end();
	await page.goto('/cms/plugins');
	const panel = page.locator('#data-plugin-packages');
	await panel.locator('#data-plugin-file').setInputFiles({ name: 'plugin.zip', mimeType: 'application/zip', buffer: await ready });
	await expect(panel.locator('#data-plugin-summary')).toContainText('افزونهٔ بسته‌بندی‌شده');
	await expect(panel.locator('#data-plugin-readme')).toContainText('<script>');
	expect(await page.evaluate(() => (window as unknown as { zipReadmeExecuted?: boolean }).zipReadmeExecuted)).toBeUndefined();
	page.once('dialog', (dialog) => dialog.accept());
	await panel.getByRole('button', { name: 'نصب بستهٔ مؤلفه' }).click();
	const row = panel.locator(`[data-data-plugin-id="${id}"]`);
	await expect(row).toContainText('فعال');
	const slug = slugFor('plugin-zip');
	await createPage(page, slug);
	await page.getByRole('button', { name: /عنوان افزونهٔ ZIP/ }).click();
	const dialog = page.getByRole('dialog', { name: 'عنوان افزونهٔ ZIP' });
	await dialog.getByLabel('عنوان دلخواه').fill('عنوان بومی ذخیره‌شده');
	await dialog.getByRole('button', { name: 'افزودن به صفحه' }).click();
	await expect(page.getByTestId('builder-canvas')).toContainText('عنوان بومی ذخیره‌شده');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto('/cms/plugins');
	await row.getByRole('button', { name: 'غیرفعال‌سازی' }).click();
	await expect(row).toContainText('غیرفعال');
	page.once('dialog', (confirmation) => confirmation.accept());
	await row.getByRole('button', { name: 'حذف بسته' }).click();
	await expect(row).toHaveCount(0);
	await page.goto(`/cms/builder/${slug}`);
	await expect(page.getByRole('button', { name: /عنوان افزونهٔ ZIP/ })).toHaveCount(0);
	await expect(page.getByTestId('builder-canvas')).toContainText('عنوان بومی ذخیره‌شده');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('.nvx-page__content h2')).toHaveText('عنوان بومی ذخیره‌شده');
	assertNoBrowserIssues(issues);
});

test('does not claim plugin installation when the success response is malformed', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const id = `data-malformed-${Date.now().toString(36)}`;
	const content = { schemaVersion: 1, id, version: '1.0.0', name: 'بستهٔ آزمایشی', description: '', components: [{ pluginId: id, pluginVersion: '1.0.0', componentId: 'notice', label: 'پیام', fields: [{ key: 'text', label: 'متن', kind: 'text', value: 'متن', maxLength: 100 }], parts: [{ type: 'text', textKey: 'text' }] }] };
	await page.goto('/cms/plugins');
	const panel = page.locator('#data-plugin-packages');
	await panel.locator('#data-plugin-file').setInputFiles({ name: 'plugin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(content)) });
	await expect(panel.locator('#data-plugin-summary')).toContainText('بستهٔ آزمایشی');
	await page.route('**/cms/api/builder/plugin-packages', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, record: {} }) }) : route.continue());
	page.once('dialog', (confirmation) => confirmation.accept());
	await panel.getByRole('button', { name: 'نصب بستهٔ مؤلفه' }).click();
	await expect(panel.locator('#data-plugin-status')).toContainText('پاسخ نصب معتبر نیست');
	await expect(panel.locator(`[data-data-plugin-id="${id}"]`)).toHaveCount(0);
	assertNoBrowserIssues(issues);
});

test('reviews Elementor metadata inside a WordPress export before importing it', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('wxr-elementor');
	await createPage(page, slug);
	const source = [{ id: 'wxr-heading', elType: 'widget', widgetType: 'heading', settings: { title: 'تیتر المنتور وردپرس', header_size: 'h2' }, elements: [] }, { id: 'unsupported-widget', elType: 'widget', widgetType: 'unavailable', settings: {}, elements: [] }];
	const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>صفحهٔ وردپرس</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[<p>متن معمولی</p>]]></content:encoded><wp:postmeta><wp:meta_key>_elementor_data</wp:meta_key><wp:meta_value><![CDATA[${JSON.stringify(source)}]]></wp:meta_value></wp:postmeta></item></channel></rss>`;
	await page.getByTestId('wxr-import-file').setInputFiles({ name: 'elementor-wxr.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	const dialog = page.getByRole('dialog', { name: 'بررسی خروجی WordPress WXR' });
	await expect(dialog).toContainText('متن معمولی');
	await dialog.getByLabel('استفاده از دادهٔ Elementor موجود در WXR').check();
	await expect(dialog).toContainText('تیتر المنتور وردپرس');
	await expect(dialog).toContainText('unsupported-widget');
	await expect(page.getByTestId('builder-canvas')).not.toContainText('تیتر المنتور وردپرس');
	page.once('dialog', (confirmation) => confirmation.accept());
	await dialog.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	await expect(page.getByTestId('builder-canvas')).toContainText('تیتر المنتور وردپرس');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('h2')).toContainText('تیتر المنتور وردپرس');
	assertNoBrowserIssues(issues);
});

test('rejects a malformed successful publication response instead of claiming success', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('bad-publish-response');
	await createPage(page, slug);
	await page.getByTestId('add-component-heading').click();
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	await page.route(`**/cms/api/builder/pages/${slug}`, async (route) => {
		if (route.request().method() === 'POST') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, revision: 'wrong', publicUrl: `/pages/${slug}` }) });
		else await route.continue();
	});
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('پاسخ انتشار معتبر نیست');
	expect((await page.request.get(`/pages/${slug}`)).status()).toBe(404);
	assertNoBrowserIssues(issues);
});

test('creates named responsive ranges with inheritance, undo and public boundaries', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('named-ranges');
	await createPage(page, slug);
	await page.getByLabel('نام اندازهٔ تازه').fill('گسترده');
	await page.getByLabel('عرض اندازهٔ تازه (px)').fill('1200');
	await page.getByTestId('add-breakpoint').click();
	await page.getByLabel('نام اندازهٔ تازه').fill('میانی');
	await page.getByLabel('عرض اندازهٔ تازه (px)').fill('850');
	await page.getByTestId('add-breakpoint').click();
	await expect(page.getByRole('button', { name: 'گسترده' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'میانی' })).toBeVisible();
	await page.getByTestId('add-component-container').click();
	const tree = page.getByRole('list', { name: 'ساختار صفحه' });
	const containerId = await tree.getByTestId('tree-node').first().getAttribute('data-node-id');
	if (!containerId) throw new Error('Container not found');
	await page.getByRole('button', { name: 'گسترده' }).click();
	await page.locator('#builder-field-styles-width-length').fill('75%');
	await page.locator('#builder-field-styles-width-length').blur();
	await page.getByRole('button', { name: 'میانی' }).click();
	await page.locator('#builder-field-styles-width-length').fill('45%');
	await page.locator('#builder-field-styles-width-length').blur();
	await page.getByRole('checkbox', { name: /پنهان در میانی/ }).check();
	await page.getByRole('button', { name: 'موبایل' }).click();
	await expect(page.getByTestId('builder-canvas').locator(`[data-builder-id="${containerId}"]`)).toHaveAttribute('style', /width: 45%/);
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	await page.reload();
	const saved = (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document;
	expect(saved.schemaVersion).toBe(5);
	expect(saved.breakpoints.custom.map((entry: { label: string; maxWidth: number }) => [entry.label, entry.maxWidth])).toEqual([['گسترده', 1200], ['میانی', 850]]);
	const narrowId = saved.breakpoints.custom[1].id;
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByTestId(`breakpoint-${narrowId}`).getByRole('button', { name: 'حذف اندازهٔ سفارشی' }).click();
	await expect(page.getByRole('button', { name: 'میانی' })).toHaveCount(0);
	await page.getByTestId('undo').click();
	await expect(page.getByRole('button', { name: 'میانی' })).toBeVisible();
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	const container = page.locator(`[data-builder-id="${containerId}"]`);
	const ratio = () => container.evaluate((node) => node.getBoundingClientRect().width / node.parentElement!.getBoundingClientRect().width);
	await page.setViewportSize({ width: 1250, height: 900 });
	expect(await ratio()).toBeCloseTo(1, 1);
	await page.setViewportSize({ width: 1100, height: 900 });
	expect(await ratio()).toBeCloseTo(0.75, 1);
	await page.setViewportSize({ width: 850, height: 900 });
	await expect(container).toHaveCSS('display', 'none');
	await page.setViewportSize({ width: 767, height: 900 });
	await expect(container).toHaveCSS('display', 'flex');
	expect(await ratio()).toBeCloseTo(0.45, 1);
	assertNoBrowserIssues(issues);
});

test('publishes reviewed administrator page-wide CSS and JavaScript without executing them in the editor', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('global-author-code');
	await createPage(page, slug);
	await page.getByTestId('add-component-heading').click();
	await page.getByTestId('add-component-globalcode').click();
	await page.locator('#builder-field-title').fill('کد اعتمادشده');
	await page.locator('#builder-field-css').fill('.nvx-page__title { color: rgb(19, 34, 55); } .nvx-page__title::after { content: "</style>"; }');
	await page.locator('#builder-field-javascript').fill(`
		const markup = '</script><script>notADelimiter()</script>';
		if (2 < 3 && markup.includes('notADelimiter')) document.documentElement.dataset.authorCode = 'ran';
	`);
	await expect(page.getByTestId('builder-canvas')).toContainText('در ویرایشگر اجرا نمی‌شود');
	expect(await page.evaluate(() => document.documentElement.dataset.authorCode)).toBeUndefined();
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	const draft = await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json();
	const denied = await page.request.post(`/cms/api/builder/pages/${slug}`, { data: { expectedRevision: draft.revision, document: draft.document } });
	expect(denied.status()).toBe(422);
	expect((await denied.json()).code).toBe('code_review_required');
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('html')).toHaveAttribute('data-author-code', 'ran');
	await expect(page.locator('.nvx-page__title')).toHaveCSS('color', 'rgb(19, 34, 55)');
	const pseudo = await page.locator('.nvx-page__title').evaluate((node) => getComputedStyle(node, '::after').content);
	expect(pseudo).toContain('</style>');
	assertNoBrowserIssues(issues);
});

test('maps Elementor images to existing local media during review without fetching source URLs', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('elementor-media-map');
	const sourceUrl = 'http://127.0.0.1/never-fetch-this-image.png';
	let sourceRequests = 0;
	page.on('request', (request) => { if (request.url() === sourceUrl) sourceRequests++; });
	await createPage(page, slug);
	const source = { version: '0.4', content: [
		{ id: 'source-image', elType: 'widget', widgetType: 'image', settings: { image: { id: 18, url: sourceUrl, alt: 'تصویر نگاشت‌شده' } }, elements: [] },
		{ id: 'source-gallery', elType: 'widget', widgetType: 'basic-gallery', settings: { wp_gallery: [{ id: 18, url: sourceUrl, alt: 'گالری نگاشت‌شده' }] }, elements: [] },
	] };
	await page.getByTestId('elementor-import-file').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
	const review = page.getByRole('dialog', { name: 'بررسی ورود Elementor' });
	await expect(review.locator('.builder-elementor-preview img')).toHaveCount(0);
	await review.getByTestId('elementor-media-map').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ 'id:18': 'https://example.com/not-local.png' })) });
	await expect(review.getByRole('status')).toContainText('نگاشت اعمال نشد');
	await expect(review.locator('.builder-elementor-preview img')).toHaveCount(0);
	await review.getByTestId('elementor-media-map').setInputFiles({ name: 'missing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ 'id:18': 'media://assets/does-not-exist.png' })) });
	await expect(review.getByRole('status')).toContainText('در کتابخانه پیدا نشد');
	await expect(review.locator('.builder-elementor-preview img')).toHaveCount(0);
	await review.getByTestId('elementor-media-map').setInputFiles({ name: 'mapping.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ 'id:18': 'media://assets/blog-placeholder-1.jpg' })) });
	await expect(review.getByRole('status')).toContainText('قانون بررسی شد');
	const previews = review.locator('.builder-elementor-preview img');
	await expect(previews).toHaveCount(2);
	await expect(previews.first()).toHaveAttribute('src', '/media/blog-placeholder-1.jpg');
	page.once('dialog', (confirmation) => confirmation.accept());
	await review.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	const saved = (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document;
	expect(saved.nodes[0].props.src).toBe('media://assets/blog-placeholder-1.jpg');
	expect(saved.nodes[1].props.items[0].src).toBe('media://assets/blog-placeholder-1.jpg');
	expect(JSON.stringify(saved)).not.toContain(sourceUrl);
	await page.goto(`/pages/${slug}`);
	const image = page.locator('img[alt="تصویر نگاشت‌شده"]');
	await expect(image).toBeVisible();
	await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
	expect(sourceRequests).toBe(0);
	assertNoBrowserIssues(issues);
});

test('uses one local media map for WordPress HTML, embedded Elementor and bulk drafts', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('wxr-media-map');
	const prefix = slugFor('wp-media');
	const sourceUrl = 'http://127.0.0.1/no-wxr-fetch.png';
	let sourceRequests = 0;
	page.on('request', (request) => { if (request.url() === sourceUrl) sourceRequests++; });
	await createPage(page, slug);
	const html = `<p>پیش‌نمایش وردپرس</p><img class="wp-image-25" src="${sourceUrl}" alt="تصویر وردپرس">`;
	const elementor = [{ id: 'elementor-image', elType: 'widget', widgetType: 'image', settings: { image: { id: 25, url: sourceUrl, alt: 'تصویر المنتور' } }, elements: [] }];
	const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>نوشته</title><wp:post_type>post</wp:post_type><content:encoded><![CDATA[${html}]]></content:encoded></item><item><title>صفحه</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[<p>جایگزین HTML</p>]]></content:encoded><wp:postmeta><wp:meta_key>_elementor_data</wp:meta_key><wp:meta_value><![CDATA[${JSON.stringify(elementor)}]]></wp:meta_value></wp:postmeta></item></channel></rss>`;
	await page.getByTestId('wxr-import-file').setInputFiles({ name: 'source.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	const review = page.getByRole('dialog', { name: 'بررسی خروجی WordPress WXR' });
	await review.getByTestId('wxr-media-map').setInputFiles({ name: 'mapping.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ 'id:25': 'media://assets/blog-placeholder-1.jpg' })) });
	await expect(review.getByRole('status')).toContainText('قانون بررسی شد');
	await expect(review.locator('.builder-elementor-preview img')).toHaveAttribute('alt', 'تصویر وردپرس');
	await review.getByLabel('استفاده از دادهٔ Elementor موجود در WXR').check();
	await review.getByLabel('مورد منبع').selectOption('1');
	await expect(review.locator('.builder-elementor-preview img')).toHaveAttribute('alt', 'تصویر المنتور');
	await review.getByLabel('پیشوند نامک برای ورود گروهی').fill(prefix);
	page.once('dialog', (confirmation) => confirmation.accept());
	await review.getByRole('button', { name: 'ساخت صفحه‌های پیش‌نویس' }).click();
	await expect(review.getByText('پیش‌نویس‌ها ساخته شدند:', { exact: false })).toBeVisible();
	const first = (await (await page.request.get(`/cms/api/builder/pages/${prefix}-1`)).json()).document;
	const second = (await (await page.request.get(`/cms/api/builder/pages/${prefix}-2`)).json()).document;
	expect(first.nodes.find((node: { type: string }) => node.type === 'Image').props.src).toBe('media://assets/blog-placeholder-1.jpg');
	expect(second.nodes[0].props.src).toBe('media://assets/blog-placeholder-1.jpg');
	expect(JSON.stringify([first, second])).not.toContain(sourceUrl);
	page.once('dialog', (confirmation) => confirmation.accept());
	await review.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('img[alt="تصویر المنتور"]')).toBeVisible();
	expect(sourceRequests).toBe(0);
	assertNoBrowserIssues(issues);
});

test('installs an isolated Wasm processor and inserts a validated native result', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const id = `data-wasm-${Date.now().toString(36)}`;
	const content = { schemaVersion: 3, id, version: '1.0.0', name: 'محاسبهٔ ایزوله', description: '', components: [], presets: [{
		id: `${id}-result`, label: 'نتیجهٔ بومی', description: '',
		document: { schemaVersion: 3, id: 'page_wasm-source', slug: 'wasm-source', title: 'نتیجه', description: '', themeId: 'site', nodes: [{ id: 'node_wasmresult01', type: 'Heading', componentVersion: 1, props: { text: 'مقدار', level: 2, align: 'start', color: 'ink', size: 'lg' } }] },
		parameters: [{ key: 'result', label: 'نتیجه', nodeId: 'node_wasmresult01', property: 'text', defaultValue: '', maxLength: 100 }],
	}], processors: [{
		id: `${id}-multiply`, label: 'ضرب ایزوله', description: 'محاسبهٔ ایمن', presetId: `${id}-result`, outputParameter: 'result', prefix: 'نتیجه: ', suffix: '',
		inputs: [{ key: 'first', label: 'عدد نخست', min: 0, max: 100, defaultValue: 2 }, { key: 'second', label: 'عدد دوم', min: 0, max: 100, defaultValue: 3 }],
		moduleBase64: 'AGFzbQEAAAABCQFgBH9/f38BfwMCAQAHBwEDcnVuAAAKCQEHACAAIAFsCw==',
	}] };
	await page.goto('/cms/plugins');
	const panel = page.locator('#data-plugin-packages');
	await panel.locator('#data-plugin-file').setInputFiles({ name: 'numeric-plugin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(content)) });
	await expect(panel.locator('#data-plugin-summary')).toContainText('1 پردازشگر ایزوله');
	page.once('dialog', (confirmation) => confirmation.accept());
	await panel.getByRole('button', { name: 'نصب بستهٔ مؤلفه' }).click();
	const row = panel.locator(`[data-data-plugin-id="${id}"]`);
	await expect(row).toContainText('فعال');
	const slug = slugFor('wasm-plugin');
	await createPage(page, slug);
	await page.getByTestId(`plugin-processor-${id}-multiply`).click();
	const dialog = page.getByRole('dialog', { name: 'ضرب ایزوله' });
	await dialog.getByLabel('عدد نخست').fill('6');
	await dialog.getByLabel('عدد دوم').fill('7');
	await page.route('**/cms/api/builder/plugin-processors', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, document: { nodes: 'invalid' } }) }));
	await dialog.getByRole('button', { name: 'محاسبه و افزودن' }).click();
	await expect(dialog.getByRole('alert')).toBeVisible();
	await expect(page.getByTestId('builder-canvas')).not.toContainText('نتیجه: 42');
	await page.unroute('**/cms/api/builder/plugin-processors');
	const execution = page.waitForResponse((response) => response.url().includes('/cms/api/builder/plugin-processors') && response.request().method() === 'POST');
	await dialog.getByRole('button', { name: 'محاسبه و افزودن' }).click();
	const executionResponse = await execution;
	if (executionResponse.status() === 503 && process.env.NOVEX_EXPECT_WASM_SANDBOX !== '1') {
		await assertSandboxUnavailable(executionResponse, dialog, page.getByTestId('builder-canvas'), 'نتیجه: 42', issues);
		await dialog.getByRole('button', { name: 'انصراف' }).click();
		await page.goto('/cms/plugins');
		page.once('dialog', (confirmation) => confirmation.accept());
		await row.getByRole('button', { name: 'حذف بسته' }).click();
		await expect(row).toHaveCount(0);
		assertNoBrowserIssues(issues);
		test.skip(true, 'OS sandbox unavailable; fail-closed behavior verified but execution cannot be tested');
	}
	expect(executionResponse.status()).toBe(200);
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId('builder-canvas')).toContainText('نتیجه: 42');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	const saved = (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document;
	expect(saved.nodes[0].type).toBe('Heading');
	expect(JSON.stringify(saved)).not.toContain('moduleBase64');
	await page.goto('/cms/plugins');
	page.once('dialog', (confirmation) => confirmation.accept());
	await row.getByRole('button', { name: 'حذف بسته' }).click();
	await expect(row).toHaveCount(0);
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('.nvx-page__content h2')).toHaveText('نتیجه: 42');
	assertNoBrowserIssues(issues);
});

test('installs a plugin ZIP with a Wasm module and protected local media', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const id = `data-wasm-zip-${Date.now().toString(36)}`;
	const pixels = await sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
	const content = { schemaVersion: 3, id, version: '1.0.0', name: 'بستهٔ محاسبه و تصویر', description: '', components: [], presets: [{
		id: `${id}-result`, label: 'تصویر و نتیجه', description: '',
		document: { schemaVersion: 3, id: 'page_zipwasm-source', slug: 'zipwasm-source', title: 'نتیجه', description: '', themeId: 'site', nodes: [
			{ id: 'node_zipwasmhead1', type: 'Heading', componentVersion: 1, props: { text: 'مقدار', level: 2, align: 'start', color: 'ink', size: 'lg' } },
			{ id: 'node_zipwasmimage1', type: 'Image', componentVersion: 1, props: { src: 'media://uploads/cover.png', alt: 'تصویر بستهٔ افزونه', caption: '', aspectRatio: 'auto', fit: 'cover' } },
		] },
		parameters: [{ key: 'result', label: 'نتیجه', nodeId: 'node_zipwasmhead1', property: 'text', defaultValue: '', maxLength: 100 }],
	}], processors: [{
		id: `${id}-multiply`, label: 'محاسبهٔ تصویری', description: '', presetId: `${id}-result`, outputParameter: 'result', prefix: 'حاصل: ', suffix: '',
		inputs: [{ key: 'first', label: 'عدد اول', min: 0, max: 100, defaultValue: 4 }, { key: 'second', label: 'عدد دوم', min: 0, max: 100, defaultValue: 5 }], modulePath: 'modules/multiply.wasm',
	}] };
	const zip = new ZipFile(); const chunks: Buffer[] = [];
	const ready = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); });
	zip.addBuffer(Buffer.from(JSON.stringify(content)), 'plugin.json');
	zip.addBuffer(Buffer.from('AGFzbQEAAAABCQFgBH9/f38BfwMCAQAHBwEDcnVuAAAKCQEHACAAIAFsCw==', 'base64'), 'modules/multiply.wasm');
	zip.addBuffer(pixels, 'assets/cover.png'); zip.end();
	await page.goto('/cms/plugins');
	const panel = page.locator('#data-plugin-packages');
	await panel.locator('#data-plugin-file').setInputFiles({ name: 'processor.zip', mimeType: 'application/zip', buffer: await ready });
	await expect(panel.locator('#data-plugin-summary')).toContainText('1 تصویر بسته');
	let installed: { uploaded: number; createdUploads: string[] } | undefined;
	await page.route('**/cms/api/builder/plugin-archive', async (route) => {
		const response = await route.fetch();
		const body = await response.body();
		if (response.status() === 201) {
			installed = JSON.parse(body.toString('utf8')) as { uploaded: number; createdUploads: string[] };
			for (const name of installed.createdUploads) await trackUploaded(page, name);
		}
		await route.fulfill({ response, body });
	});
	page.once('dialog', (confirmation) => confirmation.accept());
	await panel.getByRole('button', { name: 'نصب بستهٔ مؤلفه' }).click();
	const row = panel.locator(`[data-data-plugin-id="${id}"]`);
	await expect(row).toContainText('فعال');
	await page.unroute('**/cms/api/builder/plugin-archive');
	expect(installed?.uploaded).toBe(1);
	if (!installed) throw new Error('ZIP installation response missing');
	const slug = slugFor('wasm-zip-plugin');
	await createPage(page, slug);
	await page.getByTestId(`plugin-processor-${id}-multiply`).click();
	const dialog = page.getByRole('dialog', { name: 'محاسبهٔ تصویری' });
	const execution = page.waitForResponse((response) => response.url().includes('/cms/api/builder/plugin-processors') && response.request().method() === 'POST');
	await dialog.getByRole('button', { name: 'محاسبه و افزودن' }).click();
	const executionResponse = await execution;
	if (executionResponse.status() === 503 && process.env.NOVEX_EXPECT_WASM_SANDBOX !== '1') {
		await assertSandboxUnavailable(executionResponse, dialog, page.getByTestId('builder-canvas'), 'حاصل: 20', issues);
		expect((await page.request.delete(`/cms/api/media/${encodeURIComponent(installed.createdUploads[0])}`, { headers: { accept: 'application/json' } })).status()).toBe(409);
		await dialog.getByRole('button', { name: 'انصراف' }).click();
		await page.goto('/cms/plugins');
		page.once('dialog', (confirmation) => confirmation.accept());
		await row.getByRole('button', { name: 'حذف بسته' }).click();
		await expect(row).toHaveCount(0);
		expect((await page.request.delete(`/cms/api/media/${encodeURIComponent(installed.createdUploads[0])}`, { headers: { accept: 'application/json' } })).status()).toBe(200);
		assertNoBrowserIssues(issues);
		test.skip(true, 'OS sandbox unavailable; fail-closed behavior verified but execution cannot be tested');
	}
	expect(executionResponse.status()).toBe(200);
	await expect(page.getByTestId('builder-canvas')).toContainText('حاصل: 20');
	await expect(page.getByTestId('builder-canvas').locator('img[alt="تصویر بستهٔ افزونه"]')).toBeVisible();
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto('/cms/plugins');
	page.once('dialog', (confirmation) => confirmation.accept());
	await row.getByRole('button', { name: 'حذف بسته' }).click();
	await expect(row).toHaveCount(0);
	expect((await page.request.delete(`/cms/api/media/${encodeURIComponent(installed.createdUploads[0])}`, { headers: { accept: 'application/json' } })).status()).toBe(409);
	await page.goto(`/pages/${slug}`);
	await expect(page.locator('.nvx-page__content h2')).toHaveText('حاصل: 20');
	await expect(page.locator('.nvx-page__content img[alt="تصویر بستهٔ افزونه"]')).toBeVisible();
	assertNoBrowserIssues(issues);
});

test('reviews a WordPress archive and imports its local images into HTML and Elementor drafts', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const editor = slugFor('wxr-archive-editor');
	const prefix = slugFor('wxr-archive');
	const sourceUrl = 'http://127.0.0.1/wp-content/uploads/2024/hero.png';
	let sourceRequests = 0;
	page.on('request', (request) => { if (request.url() === sourceUrl) sourceRequests++; });
	const pixels = await sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
	const html = `<p>محتوای وردپرس</p><img class="wp-image-42" src="${sourceUrl}" alt="تصویر نوشته">`;
	const elementor = [{ id: 'source-image', elType: 'widget', widgetType: 'image', settings: { image: { id: 42, url: sourceUrl, alt: 'تصویر صفحه' } }, elements: [] }];
	const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>نوشته</title><wp:post_type>post</wp:post_type><content:encoded><![CDATA[${html}]]></content:encoded></item><item><title>صفحه</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[<p>جایگزین HTML</p>]]></content:encoded><wp:postmeta><wp:meta_key>_elementor_data</wp:meta_key><wp:meta_value><![CDATA[${JSON.stringify(elementor)}]]></wp:meta_value></wp:postmeta></item><item><wp:post_type>attachment</wp:post_type><wp:post_id>42</wp:post_id><wp:attachment_url>${sourceUrl}</wp:attachment_url><wp:postmeta><wp:meta_key>_wp_attached_file</wp:meta_key><wp:meta_value>2024/hero.png</wp:meta_value></wp:postmeta></item></channel></rss>`;
	const zip = new ZipFile(); const chunks: Buffer[] = [];
	const ready = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); });
	zip.addBuffer(Buffer.from(xml), 'wordpress.xml'); zip.addBuffer(pixels, 'wp-content/uploads/2024/hero.png'); zip.end();
	await createPage(page, editor);
	await page.getByTestId('wxr-archive-file').setInputFiles({ name: 'wordpress.zip', mimeType: 'application/zip', buffer: await ready });
	const dialog = page.getByRole('dialog', { name: 'بررسی بستهٔ WordPress ZIP' });
	await expect(dialog).toContainText('۱ تصویر');
	await expect(dialog).toContainText('۱ رسانهٔ شناسایی‌شده');
	await dialog.getByLabel('استفاده از دادهٔ Elementor موجود در بسته').check();
	await dialog.getByLabel('پیشوند نامک بستهٔ WordPress').fill(prefix);
	let installed: { uploaded: number; createdUploads: string[] } | undefined;
	await page.route('**/cms/api/builder/imports/wordpress-archive', async (route) => {
		const response = await route.fetch(); const body = await response.body();
		if (response.status() === 201) {
			installed = JSON.parse(body.toString('utf8')) as { uploaded: number; createdUploads: string[] };
			for (const name of installed.createdUploads) await trackUploaded(page, name);
		}
		await route.fulfill({ response, body });
	});
	page.once('dialog', (confirmation) => confirmation.accept());
	await dialog.getByRole('button', { name: 'ورود پیش‌نویس‌ها و رسانه' }).click();
	await expect(dialog.getByRole('status')).toContainText('هیچ صفحه‌ای منتشر نشد');
	await page.unroute('**/cms/api/builder/imports/wordpress-archive');
	expect(installed?.uploaded).toBe(1);
	if (!installed) throw new Error('WordPress archive installation response missing');
	const first = (await (await page.request.get(`/cms/api/builder/pages/${prefix}-1`)).json()).document;
	const second = (await (await page.request.get(`/cms/api/builder/pages/${prefix}-2`)).json()).document;
	expect(first.nodes[1].props.src).toBe(`media://uploads/${installed.createdUploads[0]}`);
	expect(second.nodes[0].props.src).toBe(`media://uploads/${installed.createdUploads[0]}`);
	expect(JSON.stringify([first, second])).not.toContain(sourceUrl);
	expect((await page.request.get(`/pages/${prefix}-2`)).status()).toBe(404);
	await page.goto(`/cms/builder/${prefix}-2`);
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${prefix}-2`);
	const image = page.locator('.nvx-page__content img[alt="تصویر صفحه"]');
	await expect(image).toBeVisible();
	await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(12);
	expect(sourceRequests).toBe(0);
	assertNoBrowserIssues(issues);
});


test('authors formatted text and safe links with undo, reload and published rendering', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('rich-text');
	await createPage(page, slug);
	await page.getByTestId('add-component-text').click();
	const text = page.locator('#builder-field-text');
	await text.fill('Hello bold linked <script>literal</script>');
	async function selectRange(start: number, end: number) {
		await text.evaluate((element: HTMLTextAreaElement, range) => { element.focus(); element.setSelectionRange(range.start, range.end); element.dispatchEvent(new Event('select', { bubbles: true })); }, { start, end });
	}
	await selectRange(6, 10);
	await page.getByRole('button', { name: 'پررنگ', exact: true }).click();
	const canvas = page.getByTestId('builder-canvas');
	await expect(canvas.locator('p strong')).toHaveText('bold');
	await selectRange(11, 17);
	await page.locator('#builder-field-text-link').fill('/about');
	await page.getByRole('button', { name: 'اعمال پیوند به انتخاب' }).click();
	await expect(canvas.locator('p a')).toHaveText('linked');
	await expect(canvas.locator('p a')).toHaveAttribute('href', '/about');
	await page.getByTestId('undo').click();
	await expect(canvas.locator('p a')).toHaveCount(0);
	await page.getByTestId('redo').click();
	await expect(canvas.locator('p a')).toHaveAttribute('href', '/about');
	await selectRange(11, 17);
	await page.locator('#builder-field-text-link').fill('javascript:alert(1)');
	await page.getByRole('button', { name: 'اعمال پیوند به انتخاب' }).click();
	await expect(page.locator('.builder-rich-text__error')).toBeVisible();
	await expect(canvas.locator('p a')).toHaveAttribute('href', '/about');
	await text.fill('Hi Hello bold linked <script>literal</script>');
	await expect(canvas.locator('p strong')).toHaveText('bold');
	await expect(canvas.locator('p a')).toHaveText('linked');
	await expect(canvas.locator('p script')).toHaveCount(0);
	await page.getByRole('button', { name: 'پیش‌نمایش صفحه' }).click();
	const preview = page.getByRole('dialog', { name: 'پیش‌نمایش تغییرات فعلی' });
	await expect(preview.locator('p strong')).toHaveText('bold');
	await expect(preview.locator('p a')).toHaveAttribute('href', '/about');
	await preview.getByRole('button', { name: 'بستن پیش‌نمایش' }).click();
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	await page.reload();
	await expect(canvas.locator('p strong')).toHaveText('bold');
	await expect(canvas.locator('p a')).toHaveAttribute('href', '/about');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	const published = page.locator('.nvx-page__content p.nvx-builder-text');
	await expect(published).toHaveText('Hi Hello bold linked <script>literal</script>');
	await expect(published.locator('strong')).toHaveText('bold');
	await expect(published.locator('a')).toHaveAttribute('href', '/about');
	await expect(published.locator('script')).toHaveCount(0);
	assertNoBrowserIssues(issues);
});

test('imports WordPress formatted headings, paragraphs, quotes and lists into editable published content', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('wxr-rich');
	await createPage(page, slug);
	const html = '<h2>Intro <em>heading</em></h2><p>Some <strong>bold <a href="/inside">linked</a></strong> text.</p><blockquote>Quote <em>emphasis</em> and <a href="/quote">quote link</a></blockquote><ul><li>First <a href="/item">item link</a></li><li><strong>Second</strong></li></ul><p><a href="javascript:alert(1)">unsafe text</a></p><script>window.evil=true</script>';
	const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Formatted</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[${html}]]></content:encoded></item></channel></rss>`;
	await page.getByTestId('wxr-import-file').setInputFiles({ name: 'formatted.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	const dialog = page.getByRole('dialog', { name: 'بررسی خروجی WordPress WXR' });
	await expect(dialog).toContainText('پیوند ناامن');
	await expect(dialog.locator('blockquote em')).toHaveText('emphasis');
	page.once('dialog', (confirmation) => confirmation.accept());
	await dialog.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	const canvas = page.getByTestId('builder-canvas');
	await expect(canvas.locator('h2 em')).toHaveText('heading');
	await expect(canvas.locator('p.nvx-builder-text a')).toHaveAttribute('href', '/inside');
	await expect(canvas.locator('p a strong')).toHaveText('linked');
	await expect(canvas.locator('blockquote a')).toHaveAttribute('href', '/quote');
	await expect(canvas.locator('ul.nvx-builder-list a')).toHaveAttribute('href', '/item');
	await expect(canvas.locator('ul.nvx-builder-list strong')).toHaveText('Second');
	await expect(canvas.locator('a[href^="javascript:"]')).toHaveCount(0);
	const heading = canvas.locator('h2');
	await heading.dblclick();
	await heading.fill('Intro heading updated');
	await heading.press('Enter');
	await expect(heading.locator('em')).toHaveText('heading');
	await canvas.locator('blockquote').click();
	await page.locator('#builder-field-text').fill('New Quote emphasis and quote link');
	await expect(canvas.locator('blockquote em')).toHaveText('emphasis');
	await expect(canvas.locator('blockquote a')).toHaveText('quote link');
	await canvas.locator('ul.nvx-builder-list li').first().click();
	const listItem = page.getByTestId('list-item').first();
	const itemText = listItem.getByLabel('متن مورد');
	await itemText.fill('New First item link');
	await itemText.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(4, 9); element.dispatchEvent(new Event('select', { bubbles: true })); });
	await listItem.getByRole('button', { name: 'پررنگ', exact: true }).click();
	await expect(canvas.locator('ul.nvx-builder-list li').first().locator('strong')).toHaveText('First');
	await expect(canvas.locator('ul.nvx-builder-list a')).toHaveAttribute('href', '/item');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	const content = page.locator('.nvx-page__content');
	await expect(content.locator('h2 em')).toHaveText('heading');
	await expect(content.locator('p a strong')).toHaveText('linked');
	await expect(content.locator('blockquote a')).toHaveAttribute('href', '/quote');
	await expect(content.locator('ul.nvx-builder-list a')).toHaveAttribute('href', '/item');
	await expect(content.locator('ul.nvx-builder-list strong')).toHaveText(['First', 'Second']);
	await expect(content).toContainText('unsafe text');
	await expect(content.locator('a[href^="javascript:"]')).toHaveCount(0);
	expect(await page.evaluate(() => Object.hasOwn(window, 'evil'))).toBe(false);
	assertNoBrowserIssues(issues);
});

test('reviews and resolves a structural kit conflict without discarding unrelated page edits', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const editor = slugFor('structural-editor');
	const prefix = slugFor('structural-kit');
	await createPage(page, editor);
	await page.getByRole('button', { name: 'قالب‌ها', exact: true }).click();
	const library = page.getByRole('dialog', { name: 'کتابخانهٔ قالب‌ها' });
	await library.getByText('بستهٔ سایت JSON', { exact: true }).click();
	const file = (version: string, text: string) => ({ name: 'structural.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
		schemaVersion: 1, id: 'browser-structural', version, name: 'بستهٔ ساختاری', description: '', category: 'business', language: 'fa', direction: 'rtl', minBuilderSchema: 3, license: 'MIT', author: 'Test', requiredComponents: ['Heading'], assets: [],
		pages: [{ suffix: 'home', title: 'خانه', document: { schemaVersion: 3, id: 'page_structural-source', slug: 'structural-source', title: 'خانه', description: '', themeId: 'site', nodes: [{ id: 'node_structural01', type: 'Heading', componentVersion: 1, props: { text, level: 2, align: 'start', color: 'ink', size: 'lg' } }] } }],
	})) });
	await library.getByTestId('site-kit-package').setInputFiles(file('1.0.0', 'تیتر پایه'));
	await library.getByLabel('پیشوند بستهٔ JSON').fill(prefix);
	page.once('dialog', (confirmation) => confirmation.accept());
	await library.getByRole('button', { name: 'نصب بستهٔ JSON' }).click();
	await expect(library).toContainText(`${prefix}-home`);
	const slug = `${prefix}-home`;
	const initial = await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json();
	const edited = await page.request.put(`/cms/api/builder/pages/${slug}`, { headers: { accept: 'application/json' }, data: { expectedRevision: initial.revision, document: { ...initial.document, description: 'تغییر مستقل', nodes: [] } } });
	expect(edited.status()).toBe(200);
	await library.getByTestId('site-kit-package').setInputFiles(file('1.1.0', 'تیتر تازه'));
	await library.getByRole('button', { name: 'به‌روزرسانی بستهٔ JSON' }).click();
	const review = page.getByRole('dialog', { name: 'بررسی تعارض بسته' });
	await expect(review.getByTestId('kit-review-field')).toHaveCount(1);
	await expect(review).toContainText('کل مؤلفه یا مورد');
	await expect(review).toContainText('موجود نیست');
	await expect(review).toContainText('تیتر تازه');
	await review.getByLabel('استفاده از مقدار بسته').check();
	page.once('dialog', (confirmation) => confirmation.accept());
	await review.getByRole('button', { name: 'تأیید و به‌روزرسانی پیش‌نویس‌ها' }).click();
	await expect(review).toHaveCount(0);
	const updated = (await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json()).document;
	expect(updated.description).toBe('تغییر مستقل');
	expect(updated.nodes[0].props.text).toBe('تیتر تازه');
	assertNoBrowserIssues(issues);
});

test('imports linked Elementor headings and formatted price tables without truncating long labels', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('elementor-pricing');
	await createPage(page, slug);
	const label = 'a'.repeat(79) + '😀 end';
	const source = { version: '0.4', content: [
		{ id: 'heading', elType: 'widget', widgetType: 'heading', settings: { title: '<strong>Offer</strong>', link: { url: '/offer' } }, elements: [] },
		{ id: 'price', elType: 'widget', widgetType: 'price-table', settings: { heading: '<em>Premium</em>', price: '9', period: '<strong>month</strong>', features_list: [{ item_text: 'A <a href="/features">feature</a>' }], button_text: label, link: { url: '/buy' } }, elements: [] },
		{ id: 'rich', elType: 'widget', widgetType: 'text-editor', settings: { editor: '<h3>Rich <em>heading</em></h3><p>Rich <strong>paragraph</strong></p><blockquote>Rich <em>quote</em></blockquote><ul><li>First <a href="/inside">link</a></li></ul>' }, elements: [] },
	] };
	await page.getByTestId('elementor-import-file').setInputFiles({ name: 'pricing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
	const review = page.getByRole('dialog', { name: 'بررسی ورود Elementor' });
	await expect(review).toContainText('ادامهٔ برچسب بلند');
	page.once('dialog', (confirmation) => confirmation.accept());
	await review.getByRole('button', { name: 'جایگزینی پیش‌نویس' }).click();
	const canvas = page.getByTestId('builder-canvas');
	await expect(canvas.locator('h2 a strong')).toHaveText('Offer');
	await expect(canvas.locator('h2 a')).toHaveAttribute('href', '/offer');
	await expect(canvas.locator('h2 em')).toHaveText('Premium');
	await expect(canvas.locator('h3 em')).toHaveText('heading');
	await expect(canvas.locator('blockquote em')).toHaveText('quote');
	await expect(canvas.locator('ul.nvx-builder-list a')).toHaveAttribute('href', '/inside');
	await expect(canvas.locator('p a')).toHaveAttribute('href', '/features');
	await expect(canvas).toContainText('😀 end');
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${slug}`);
	const published = page.locator('.nvx-page__content');
	await expect(published.locator('h2 a strong')).toHaveText('Offer');
	await expect(published.locator('h2 a')).toHaveAttribute('href', '/offer');
	await expect(published.locator('h2 em')).toHaveText('Premium');
	await expect(published.locator('h3 em')).toHaveText('heading');
	await expect(published.locator('blockquote em')).toHaveText('quote');
	await expect(published.locator('ul.nvx-builder-list a')).toHaveAttribute('href', '/inside');
	await expect(published.locator('p a')).toHaveAttribute('href', '/features');
	await expect(published.locator('a[href="/buy"]')).toHaveText('a'.repeat(79));
	await expect(published).toContainText('😀 end');
	assertNoBrowserIssues(issues);
});

test('imports a WordPress post as an actual unpublished CMS blog draft', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const pageSlug = slugFor('wxr-blog-editor');
	const postSlug = slugFor('wxr-blog');
	const imageUrl = 'http://127.0.0.1/never-fetch-blog-image.png';
	let sourceRequests = 0;
	page.on('request', (request) => { if (request.url() === imageUrl) sourceRequests++; });
	await createPage(page, pageSlug);
	const html = `<h2>Blog <em>heading</em></h2><p>Some <strong>formatted</strong> text with <a href="/inside">link</a>.</p><ul><li>First</li><li>Second</li></ul><img src="${imageUrl}" alt="Unimported photo"><script>window.wxrBlogBad=true</script>`;
	const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Imported blog post</title><wp:post_type>post</wp:post_type><wp:post_name>${postSlug}</wp:post_name><wp:post_date_gmt>2024-06-13 12:34:56</wp:post_date_gmt><category>News</category><excerpt:encoded>Blog summary</excerpt:encoded><content:encoded><![CDATA[${html}]]></content:encoded></item></channel></rss>`;
	await page.getByTestId('wxr-import-file').setInputFiles({ name: 'blog.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	const dialog = page.getByRole('dialog', { name: 'بررسی خروجی WordPress WXR' });
	const postImport = dialog.getByRole('region', { name: 'ورود نوشتهٔ مجله' });
	await expect(postImport).toContainText('تصاویر به متن جای‌نگهدار');
	await expect(postImport.getByLabel('نامک نوشتهٔ مجله')).toHaveValue(postSlug);
	await postImport.getByText('متن نوشته پیش از ورود').click();
	await expect(postImport.locator('pre')).toContainText('formatted');
	page.once('dialog', (confirmation) => confirmation.accept());
	await postImport.getByRole('button', { name: 'ساخت نوشتهٔ پیش‌نویس' }).click();
	await expect(postImport.getByRole('status')).toContainText('منتشر نشده است');
	await expect(postImport.getByRole('button', { name: 'ساخت نوشتهٔ پیش‌نویس' })).toBeDisabled();
	const response = await page.request.get('/cms/api/posts');
	const posts = (await response.json()).posts as Array<{ slug: string; draft: boolean; tags: string[] }>;
	const post = posts.find((item) => item.slug === postSlug);
	expect(post?.draft).toBe(true);
	expect(post?.tags).toEqual(['News']);
	expect((await page.request.get(`/blog/${postSlug}`)).status()).toBe(404);
	await postImport.getByRole('link', { name: 'ویرایش نوشتهٔ ساخته‌شده' }).click();
	await expect(page.locator('textarea[name="body"]')).toContainText('formatted');
	await expect(page.locator('textarea[name="body"]')).not.toContainText('window.wxrBlogBad');
	await page.locator('[data-published]').check();
	await Promise.all([page.waitForURL((url) => url.pathname === `/cms/posts/${postSlug}.md` && url.searchParams.get('flash') === 'saved'), page.locator('[data-save]').click()]);
	await page.goto(`/blog/${postSlug}`);
	const content = page.locator('.article__content');
	await expect(content.locator('h2 em')).toHaveText('heading');
	await expect(content.locator('p strong')).toHaveText('formatted');
	await expect(content.locator('p a')).toHaveAttribute('href', '/inside');
	await expect(content.locator('li')).toHaveText(['First', 'Second']);
	await expect(content.locator('img')).toHaveCount(0);
	expect(await page.evaluate(() => Object.hasOwn(window, 'wxrBlogBad'))).toBe(false);
	expect(sourceRequests).toBe(0);
	assertNoBrowserIssues(issues);
});

test('maps a WordPress blog image to protected local media through draft and publication', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const editorSlug = slugFor('wxr-blog-media-editor');
	const postSlug = slugFor('wxr-blog-media');
	const sourceUrl = 'http://127.0.0.1/never-fetch-blog-mapped.png';
	let sourceRequests = 0;
	page.on('request', (request) => { if (request.url() === sourceUrl) sourceRequests++; });
	await createPage(page, editorSlug);
	const upload = await page.request.post('/cms/api/media/upload', {
		headers: { accept: 'application/json' },
		multipart: { files: { name: 'e2e-pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64') } },
	});
	expect(upload.ok()).toBeTruthy();
	const local = (await upload.json()).files[0] as { name: string; assetRef: string; publicUrl: string };
	await trackUploaded(page, local.name);
	const html = `<p>Imported body</p><img class="wp-image-42" src="${sourceUrl}" alt="Local blog image">`;
	const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Blog image post</title><wp:post_type>post</wp:post_type><wp:post_name>${postSlug}</wp:post_name><excerpt:encoded>Summary</excerpt:encoded><content:encoded><![CDATA[${html}]]></content:encoded></item></channel></rss>`;
	await page.getByTestId('wxr-import-file').setInputFiles({ name: 'post.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	const review = page.getByRole('dialog', { name: 'بررسی خروجی WordPress WXR' });
	const postImport = review.getByRole('region', { name: 'ورود نوشتهٔ مجله' });
	await expect(postImport).toContainText('جای‌نگهدار');
	await review.getByTestId('wxr-media-map').setInputFiles({ name: 'map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ 'id:42': local.assetRef })) });
	await expect(review.getByRole('status')).toContainText('قانون بررسی شد');
	await postImport.getByText('متن نوشته پیش از ورود').click();
	await expect(postImport.locator('pre')).toContainText(`/media/uploads/${local.name}`);
	page.once('dialog', (confirmation) => confirmation.accept());
	await postImport.getByRole('button', { name: 'ساخت نوشتهٔ پیش‌نویس' }).click();
	await expect(postImport.getByRole('status')).toContainText('منتشر نشده است');
	expect((await page.request.delete(`/cms/api/media/${local.name}`, { headers: { accept: 'application/json' } })).status()).toBe(409);
	await postImport.getByRole('link', { name: 'ویرایش نوشتهٔ ساخته‌شده' }).click();
	await expect(page.locator('textarea[name="body"]')).toContainText(`/media/uploads/${local.name}`);
	await page.locator('[data-published]').check();
	await Promise.all([page.waitForURL((url) => url.pathname === `/cms/posts/${postSlug}.md` && url.searchParams.get('flash') === 'saved'), page.locator('[data-save]').click()]);
	await page.goto(`/blog/${postSlug}`);
	const image = page.locator('.article__content img[alt="Local blog image"]');
	await expect(image).toBeVisible();
	await expect(image).toHaveAttribute('src', `/media/uploads/${local.name}`);
	await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
	expect((await page.request.delete(`/cms/api/media/${local.name}`, { headers: { accept: 'application/json' } })).status()).toBe(409);
	expect((await page.request.delete(`/cms/api/posts/${postSlug}.md`, { headers: { accept: 'application/json' } })).ok()).toBeTruthy();
	expect((await page.request.delete(`/cms/api/media/${local.name}`, { headers: { accept: 'application/json' } })).ok()).toBeTruthy();
	expect(sourceRequests).toBe(0);
	assertNoBrowserIssues(issues);
});

test('imports WXR posts in bulk as real unpublished blog drafts, separate from pages', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const editorSlug = slugFor('wxr-bulk-blog-editor');
	const prefix = slugFor('wxr-bulk-blog');
	const sourceUrl = 'http://127.0.0.1/never-fetch-bulk-blog.png';
	let sourceRequests = 0;
	page.on('request', (request) => { if (request.url() === sourceUrl) sourceRequests++; });
	await createPage(page, editorSlug);
	const first = `<p>First <strong>post</strong></p><img class="wp-image-71" src="${sourceUrl}" alt="Bulk image">`;
	const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>First blog</title><wp:post_type>post</wp:post_type><excerpt:encoded>Summary</excerpt:encoded><content:encoded><![CDATA[${first}]]></content:encoded></item><item><title>Page ignored</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[<p>Page</p>]]></content:encoded></item><item><title>Second blog</title><wp:post_type>post</wp:post_type><content:encoded><![CDATA[<p>Second</p>]]></content:encoded></item></channel></rss>`;
	await page.getByTestId('wxr-import-file').setInputFiles({ name: 'bulk.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	const review = page.getByRole('dialog', { name: 'بررسی خروجی WordPress WXR' });
	const bulk = review.getByRole('region', { name: 'ورود گروهی نوشته‌های مجله' });
	await expect(bulk).toContainText('۲ نوشتهٔ منبع');
	await review.getByTestId('wxr-media-map').setInputFiles({ name: 'map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ 'id:71': 'media://assets/blog-placeholder-1.jpg' })) });
	await expect(review.getByRole('status')).toContainText('قانون بررسی شد');
	await review.getByLabel('پیشوند نامک برای ورود گروهی').fill(prefix);
	await bulk.getByText('هشدارهای نوشته‌های مجله').click();
	await expect(bulk).toContainText('تصاویر نگاشت‌شده');
	page.once('dialog', (confirmation) => confirmation.accept());
	await bulk.getByRole('button', { name: 'ساخت گروهی نوشته‌های پیش‌نویس' }).click();
	await expect(bulk.getByRole('status')).toContainText('هیچ نوشته‌ای منتشر نشد');
	await expect(bulk.getByRole('button', { name: 'ساخت گروهی نوشته‌های پیش‌نویس' })).toBeDisabled();
	await expect(bulk.getByRole('link', { name: `${prefix}-1.md` })).toBeVisible();
	await expect(bulk.getByRole('link', { name: `${prefix}-2.md` })).toBeVisible();
	const posts = (await (await page.request.get('/cms/api/posts')).json()).posts as Array<{ slug: string; draft: boolean }>;
	expect(posts.filter((post) => post.slug.startsWith(prefix)).map((post) => post.slug).sort()).toEqual([`${prefix}-1`, `${prefix}-2`]);
	expect(posts.filter((post) => post.slug.startsWith(prefix)).every((post) => post.draft)).toBe(true);
	expect((await page.request.get(`/blog/${prefix}-1`)).status()).toBe(404);
	await bulk.getByRole('link', { name: `${prefix}-1.md` }).click();
	await expect(page.locator('textarea[name="body"]')).toContainText('/media/blog-placeholder-1.jpg');
	await page.locator('[data-published]').check();
	await Promise.all([page.waitForURL((url) => url.pathname === `/cms/posts/${prefix}-1.md` && url.searchParams.get('flash') === 'saved'), page.locator('[data-save]').click()]);
	await page.goto(`/blog/${prefix}-1`);
	await expect(page.locator('.article__content strong')).toHaveText('post');
	await expect(page.locator('.article__content img[alt="Bulk image"]')).toHaveAttribute('src', '/media/blog-placeholder-1.jpg');
	expect(sourceRequests).toBe(0);
	assertNoBrowserIssues(issues);
});

test('does not claim bulk blog success or allow retry after an invalid success response', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	await createPage(page, slugFor('wxr-bulk-invalid'));
	const xml = '<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Post</title><wp:post_type>post</wp:post_type><content:encoded>Content</content:encoded></item></channel></rss>';
	await page.getByTestId('wxr-import-file').setInputFiles({ name: 'one.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	const review = page.getByRole('dialog', { name: 'بررسی خروجی WordPress WXR' });
	const bulk = review.getByRole('region', { name: 'ورود گروهی نوشته‌های مجله' });
	await review.getByLabel('پیشوند نامک برای ورود گروهی').fill(slugFor('uncertain'));
	await page.route('**/cms/api/builder/imports/wordpress-posts', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true,"posts":[]}' }));
	page.once('dialog', (confirmation) => confirmation.accept());
	await bulk.getByRole('button', { name: 'ساخت گروهی نوشته‌های پیش‌نویس' }).click();
	await expect(bulk.getByRole('status')).toContainText('فهرست نوشته‌ها را بررسی کنید');
	await expect(bulk.getByRole('button', { name: 'ساخت گروهی نوشته‌های پیش‌نویس' })).toBeDisabled();
	await expect(bulk.getByRole('link')).toHaveCount(0);
	assertNoBrowserIssues(issues);
});

test('imports WordPress ZIP posts and their local images into real CMS drafts', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const editor = slugFor('wxr-archive-blog-editor');
	const prefix = slugFor('wxr-archive-blog');
	const sourceUrl = 'http://127.0.0.1/wp-content/uploads/2024/blog.png';
	let sourceRequests = 0;
	page.on('request', (request) => { if (request.url() === sourceUrl) sourceRequests++; });
	const pixels = await sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
	const pagePixels = await sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
	const html = `<p>Archive <strong>blog</strong></p><img class="wp-image-42" src="${sourceUrl}" alt="Archive blog image">`;
	const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Archive blog</title><wp:post_type>post</wp:post_type><excerpt:encoded>Summary</excerpt:encoded><content:encoded><![CDATA[${html}]]></content:encoded></item><item><title>Page</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[<img src="http://127.0.0.1/wp-content/uploads/2024/page.png">]]></content:encoded></item><item><wp:post_type>attachment</wp:post_type><wp:post_id>42</wp:post_id><wp:attachment_url>${sourceUrl}</wp:attachment_url><wp:postmeta><wp:meta_key>_wp_attached_file</wp:meta_key><wp:meta_value>2024/blog.png</wp:meta_value></wp:postmeta></item></channel></rss>`;
	const zip = new ZipFile(); const chunks: Buffer[] = [];
	const ready = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); });
	zip.addBuffer(Buffer.from(xml), 'wordpress.xml'); zip.addBuffer(pixels, 'wp-content/uploads/2024/blog.png'); zip.addBuffer(pagePixels, 'wp-content/uploads/2024/page.png'); zip.end();
	await createPage(page, editor);
	await page.getByTestId('wxr-archive-file').setInputFiles({ name: 'archive.zip', mimeType: 'application/zip', buffer: await ready });
	const dialog = page.getByRole('dialog', { name: 'بررسی بستهٔ WordPress ZIP' });
	const postImport = dialog.getByRole('region', { name: 'ورود نوشته‌های مجله از بسته' });
	await expect(dialog).toContainText('۲ تصویر');
	await expect(postImport).toContainText('۱ تصویر موردنیاز');
	await dialog.getByLabel('پیشوند نامک بستهٔ WordPress').fill(prefix);
	let installed: { uploaded: number; createdUploads: string[] } | undefined;
	await page.route('**/cms/api/builder/imports/wordpress-archive', async (route) => {
		const response = await route.fetch(); const body = await response.body();
		if (response.status() === 201) {
			installed = JSON.parse(body.toString('utf8')) as { uploaded: number; createdUploads: string[] };
			for (const name of installed.createdUploads) await trackUploaded(page, name);
		}
		await route.fulfill({ response, body });
	});
	page.once('dialog', (confirmation) => confirmation.accept());
	await postImport.getByRole('button', { name: 'ورود نوشته‌های پیش‌نویس و رسانه' }).click();
	await expect(postImport.getByRole('status')).toContainText('هیچ نوشته‌ای منتشر نشد');
	await expect(postImport.getByRole('button', { name: 'ورود نوشته‌های پیش‌نویس و رسانه' })).toBeDisabled();
	await page.unroute('**/cms/api/builder/imports/wordpress-archive');
	expect(installed?.uploaded).toBe(1);
	if (!installed) throw new Error('WordPress post archive result missing');
	const name = installed.createdUploads[0];
	expect((await page.request.delete(`/cms/api/media/${name}`, { headers: { accept: 'application/json' } })).status()).toBe(409);
	expect((await page.request.get(`/blog/${prefix}-1`)).status()).toBe(404);
	await postImport.getByRole('link', { name: `${prefix}-1.md` }).click();
	await expect(page.locator('textarea[name="body"]')).toContainText(`/media/uploads/${name}`);
	await page.locator('[data-published]').check();
	await Promise.all([page.waitForURL((url) => url.pathname === `/cms/posts/${prefix}-1.md` && url.searchParams.get('flash') === 'saved'), page.locator('[data-save]').click()]);
	await page.goto(`/blog/${prefix}-1`);
	await expect(page.locator('.article__content strong')).toHaveText('blog');
	const image = page.locator('.article__content img[alt="Archive blog image"]');
	await expect(image).toHaveAttribute('src', `/media/uploads/${name}`);
	await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(12);
	expect(sourceRequests).toBe(0);
	assertNoBrowserIssues(issues);
});

test('disables ZIP import retries when a server success response is malformed', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	await createPage(page, slugFor('wxr-archive-uncertain'));
	const xml = '<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>One post</title><wp:post_type>post</wp:post_type><content:encoded>Text</content:encoded></item></channel></rss>';
	const zip = new ZipFile(); const chunks: Buffer[] = [];
	const ready = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); });
	zip.addBuffer(Buffer.from(xml), 'wordpress.xml'); zip.end();
	await page.getByTestId('wxr-archive-file').setInputFiles({ name: 'archive.zip', mimeType: 'application/zip', buffer: await ready });
	const dialog = page.getByRole('dialog', { name: 'بررسی بستهٔ WordPress ZIP' });
	await dialog.getByLabel('پیشوند نامک بستهٔ WordPress').fill(slugFor('wxr-uncertain'));
	await page.route('**/cms/api/builder/imports/wordpress-archive', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, posts: [], pages: [] }) }));
	const region = dialog.getByRole('region', { name: 'ورود نوشته‌های مجله از بسته' });
	const postButton = region.getByRole('button', { name: 'ورود نوشته‌های پیش‌نویس و رسانه' });
	page.once('dialog', (confirmation) => confirmation.accept());
	await postButton.click();
	await expect(region.getByRole('status')).toContainText('فهرست نوشته‌ها را بررسی کنید');
	await expect(postButton).toBeDisabled();
	const pageButton = dialog.getByRole('button', { name: 'ورود پیش‌نویس‌ها و رسانه', exact: true });
	page.once('dialog', (confirmation) => confirmation.accept());
	await pageButton.click();
	await expect(dialog.getByRole('status').first()).toContainText('وضعیت صفحه‌ها را پیش از تلاش دوباره بررسی کنید');
	await expect(pageButton).toBeDisabled();
	await page.unroute('**/cms/api/builder/imports/wordpress-archive');
	assertNoBrowserIssues(issues);
});

test('protects a product image used by a live Builder product grid until the product removes it', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('product-asset');
	const pixels = await sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
	const upload = await page.request.post('/cms/api/media/upload', { headers: { accept: 'application/json' }, multipart: { files: { name: 'product.png', mimeType: 'image/png', buffer: pixels } } });
	expect(upload.ok()).toBeTruthy();
	const image = (await upload.json()).files[0] as { name: string; publicUrl: string };
	await trackUploaded(page, image.name);
	await page.goto('/cms/products/new');
	await page.locator('[name="name"]').fill('محصول تصویری آزمون');
	await page.locator('[name="slug"]').fill(slug);
	await page.locator('[name="sku"]').fill(`SKU-${Date.now()}`);
	await page.locator('[name="price"]').fill('50000');
	await page.locator('[name="stock"]').fill('3');
	await page.locator('[name="category"]').fill('تصویر آزمون');
	await page.locator('[name="status"]').selectOption('active');
	await page.locator('[name="featured"]').check();
	await page.getByLabel('انتخاب تصویر محصول').selectOption(image.publicUrl);
	await Promise.all([page.waitForURL((url) => /\/cms\/products\/prd_/.test(url.pathname) && url.searchParams.get('flash') === 'created'), page.locator('[data-product-save]').click()]);
	const productId = new URL(page.url()).pathname.split('/').pop()!;
	expect((await page.request.delete(`/cms/api/media/${image.name}`, { headers: { accept: 'application/json' } })).status()).toBe(409);
	const builder = slugFor('product-image-grid');
	await createPage(page, builder);
	await page.getByTestId('add-component-productgrid').click();
	const card = page.getByTestId('product-grid-preview').locator(`[data-product-slug="${slug}"]`);
	await expect(card).toBeVisible();
	await expect(card.locator('img')).toHaveAttribute('src', image.publicUrl);
	await page.getByTestId('publish-page').click();
	await expect(page.locator('.builder-message')).toContainText('صفحه منتشر شد');
	await page.goto(`/pages/${builder}`);
	const liveCard = page.locator(`[data-product-slug="${slug}"]`);
	await expect(liveCard.locator('img')).toHaveAttribute('src', image.publicUrl);
	await expect.poll(() => liveCard.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(12);
	await page.goto(`/cms/products/${productId}`);
	await page.getByLabel('انتخاب تصویر محصول').selectOption('');
	await Promise.all([page.waitForURL((url) => url.searchParams.get('flash') === 'saved'), page.locator('[data-product-save]').click()]);
	expect((await page.request.delete(`/cms/api/media/${image.name}`, { headers: { accept: 'application/json' } })).status()).toBe(200);
	expect((await page.request.delete(`/cms/api/products/${productId}`, { headers: { accept: 'application/json' } })).ok()).toBeTruthy();
	assertNoBrowserIssues(issues);
});

test('keeps unsaved Builder edits recoverable when a newly referenced upload is missing', async ({ page }) => {
	const issues = issuesByPage.get(page)!;
	const slug = slugFor('missing-builder-image');
	await createPage(page, slug);
	const name = 'e2e-missing-never-uploaded.png';
	const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64');
	await page.route(`**/media/uploads/${name}`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
	await page.getByTestId('add-component-image').click();
	await page.locator('#builder-field-src').fill(`/media/uploads/${name}`);
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--error')).toBeVisible();
	await expect(page.getByRole('alert')).toContainText('رسانهٔ محلی پیدا نشد');
	await expect(page.getByRole('alert').getByRole('button', { name: 'خروجی از تغییرات محلی' })).toBeVisible();
	const saved = await (await page.request.get(`/cms/api/builder/pages/${slug}`)).json();
	expect(saved.document.nodes.every((node: { type: string; props?: { src?: string } }) => node.type !== 'Image' || node.props?.src !== `/media/uploads/${name}`)).toBeTruthy();
	await page.locator('#builder-field-src').fill('');
	await page.getByTestId('save-page').click();
	await expect(page.locator('.builder-save-state--saved')).toBeVisible();
	await page.unroute(`**/media/uploads/${name}`);
	issues.consoleErrors = issues.consoleErrors.filter((entry) => !entry.includes('status of 409 (Conflict)'));
	assertNoBrowserIssues(issues);
});
