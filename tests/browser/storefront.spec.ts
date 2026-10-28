import { expect, test, type Page } from '@playwright/test';

interface BrowserIssues {
	consoleErrors: string[];
	runtimeErrors: string[];
	failedRequests: string[];
	serverErrors: string[];
}

function monitorBrowser(page: Page): BrowserIssues {
	const issues: BrowserIssues = { consoleErrors: [], runtimeErrors: [], failedRequests: [], serverErrors: [] };
	page.on('console', (message) => { if (message.type() === 'error') issues.consoleErrors.push(message.text()); });
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

async function signIn(page: Page): Promise<void> {
	await page.goto('/cms/login');
	await page.getByLabel('نام کاربری').fill('novex-e2e-admin');
	await page.locator('#cms-password').fill('novex-e2e-password-only-for-local-tests');
	await page.getByRole('button', { name: 'ورود به پنل' }).click();
	await page.waitForURL((url) => url.pathname === '/cms');
}

function assertNoBrowserIssues(issues: BrowserIssues): void {
	expect(issues.consoleErrors, 'browser console errors').toEqual([]);
	expect(issues.runtimeErrors, 'uncaught page errors').toEqual([]);
	expect(issues.failedRequests, 'failed browser requests').toEqual([]);
	expect(issues.serverErrors, 'HTTP 5xx responses').toEqual([]);
}

test('browses a real product through cart and checkout without claiming an unconfigured payment succeeded', async ({ page }) => {
	const issues = monitorBrowser(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/shop');
	await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	await expect(page.locator('.product-card')).toHaveCount(1);
	const listingWidth = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
	expect(listingWidth.content).toBeLessThanOrEqual(listingWidth.viewport + 1);

	await page.goto('/shop/e2e-test-product');
	await expect(page.getByRole('heading', { name: 'محصول آزمایشی' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'افزودن به سبد خرید' })).toBeEnabled();
	await page.getByRole('button', { name: 'افزودن به سبد خرید' }).click();
	await page.waitForURL((url) => url.pathname === '/shop/e2e-test-product' && url.searchParams.get('added') === '1');
	await expect(page.getByRole('status')).toContainText('محصول به سبد خرید اضافه شد');

	await page.goto('/shop/cart');
	await expect(page.getByText('محصول آزمایشی', { exact: true })).toBeVisible();
	await page.getByRole('link', { name: 'ادامهٔ فرآیند خرید' }).click();
	await expect(page).toHaveURL(/\/shop\/checkout$/);
	await expect(page.getByRole('note')).toContainText('ثبت سفارش به‌معنای پرداخت موفق نیست');
	const idempotencyKey = await page.locator('input[name="idempotencyKey"]').inputValue();
	const checkoutItems = await page.locator('input[name="checkoutItems"]').inputValue();
	const customer = {
		customerName: 'خریدار آزمایشی',
		email: '',
		phone: '09123456789',
		city: 'تهران',
		address: 'نشانی آزمایشی برای آزمون مستقل',
		note: '',
		discountCode: '',
	};
	await page.locator('#customerName').fill(customer.customerName);
	await page.locator('#phone').fill(customer.phone);
	await page.locator('#city').fill(customer.city);
	await page.locator('#address').fill(customer.address);
	await page.getByRole('button', { name: 'ثبت سفارش' }).click();
	await page.waitForURL((url) => /^\/shop\/order\/NVX-\d+$/.test(url.pathname));
	const orderPath = new URL(page.url()).pathname;
	await expect(page.locator('.order-payment-message')).toContainText('درگاه پرداخت آنلاین برای این فروشگاه فعال نیست');
	await expect(page.getByRole('heading', { name: /سفارش NVX-/ })).toBeVisible();

	const replay = await page.request.post('/shop/api/checkout', {
		headers: { accept: 'application/json' },
		multipart: { ...customer, idempotencyKey, checkoutItems },
	});
	expect(replay.status()).toBe(200);
	const replayBody = await replay.json();
	expect(replayBody.number).toBe(orderPath.split('/').at(-1));
	expect(replayBody.paymentState).toBe('not-configured');
	assertNoBrowserIssues(issues);
});

test('provides RTL contact and policy routes and a working mobile navigation menu', async ({ page }) => {
	const issues = monitorBrowser(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
	await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	await page.getByRole('button', { name: 'نمایش منو' }).click();
	const menu = page.locator('#mobile-menu');
	await expect(menu).toBeVisible();
	await expect(page.locator('.menu-toggle')).toHaveAttribute('aria-expanded', 'true');
	await menu.getByRole('link', { name: 'تماس' }).click();
	await expect(page).toHaveURL(/\/contact$/);
	await expect(page.getByRole('heading', { name: /تماس با/ })).toBeVisible();
	await expect(menu).toBeHidden();
	const contactWidth = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
	expect(contactWidth.content).toBeLessThanOrEqual(contactWidth.viewport + 1);

	for (const route of ['/policies', '/privacy', '/terms', '/shipping', '/returns']) {
		const response = await page.goto(route);
		expect(response?.status(), `${route} response`).toBe(200);
		await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
		await expect(page.locator('main')).toBeVisible();
	}

	await page.goto('/shop');
	const searchButton = page.getByRole('button', { name: 'جست‌وجو', exact: true });
	const searchGeometry = await page.evaluate(() => {
		const icon = document.querySelector('.catalog-search svg')!.getBoundingClientRect();
		const button = document.querySelector('.catalog-search__submit')!.getBoundingClientRect();
		return {
			icon: { left: icon.left, right: icon.right },
			button: { left: button.left, right: button.right, height: button.height },
		};
	});
	const overlaps = searchGeometry.icon.left < searchGeometry.button.right && searchGeometry.icon.right > searchGeometry.button.left;
	expect(overlaps, 'search icon and button do not overlap on mobile').toBe(false);
	expect(searchGeometry.button.height).toBeGreaterThanOrEqual(43);
	await page.locator('#catalog-q').fill('محصول آزمایشی');
	await searchButton.click();
	await expect(page).toHaveURL(/q=/);
	await expect(page.locator('.product-card')).toHaveCount(1);
	assertNoBrowserIssues(issues);
});

test('disables product browsing and order creation when the commerce module is switched off', async ({ page }) => {
	const issues = monitorBrowser(page);
	await signIn(page);
	const changed = await page.request.post('/cms/api/settings', {
		headers: { accept: 'application/json', 'content-type': 'application/json' },
		data: { commerceEnabled: false },
	});
	expect(changed.status()).toBe(200);
	try {
		await page.goto('/shop');
		await expect(page.getByRole('heading', { name: 'فروشگاه غیرفعال است' })).toBeVisible();
		await page.goto('/shop/e2e-test-product');
		await expect(page).toHaveURL(/\/shop$/);
		await expect(page.getByRole('heading', { name: 'فروشگاه غیرفعال است' })).toBeVisible();

		const addToCart = await page.request.post('/shop/api/cart', {
			headers: { accept: 'application/json' },
			multipart: { action: 'add', productId: 'e2e_product_internal_id', quantity: '1' },
		});
		expect(addToCart.status()).toBe(503);
		const checkout = await page.request.post('/shop/api/checkout', { headers: { accept: 'application/json' } });
		expect(checkout.status()).toBe(503);
	} finally {
		await page.request.post('/cms/api/settings', {
			headers: { accept: 'application/json', 'content-type': 'application/json' },
			data: { commerceEnabled: true },
		}).catch(() => undefined);
	}
	assertNoBrowserIssues(issues);
});
