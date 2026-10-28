import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

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
	const mediaAsset = picker.getByTestId('media-asset').first();
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
