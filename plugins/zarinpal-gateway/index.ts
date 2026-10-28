/**
 * Plugin Name: درگاه پرداخت زرین‌پال
 * Description: آداپتر درخواست و تأیید پرداخت زرین‌پال؛ تراکنش زنده در این مخزن آزمایش نشده.
 * Version:     1.0.0
 * License:     MIT
 * Text Domain: novex-zarinpal
 *
 * این افزونه دو قلاب برای فروشگاه ثبت می‌کند:
 *  - `shop.payment.initiate`: ساخت درخواست پرداخت در زرین‌پال و برگرداندن آدرس درگاه.
 *  - `shop.payment.verify`: تایید پرداخت پس از بازگشت از بانک.
 *
 * صفحهٔ تنظیمات نشان می‌دهد Merchant ID محیطی پیکربندی شده است یا نه؛ حالت Sandbox در پنل ذخیره می‌شود.
 * داده را فقط از API می‌گیرد و به فایل‌های سرور دسترسی ندارد.
 */

import { escapeHtml } from '../../src/lib/plugins/html';
import { pluginSecretEnvironmentName } from '../../src/lib/plugins/secrets';
import type { DashboardWidget, PluginApi } from '../../src/lib/plugins/types';

type ZarinpalEnvironment = 'sandbox' | 'production';

interface ZarinpalRequestResponse {
	code: number;
	message: string;
	data?: {
		authority: string;
		url: string;
	};
}

interface ZarinpalVerifyResponse {
	code: number;
	message: string;
	data?: {
		code: number;
		message: string;
		ref_id: string;
		card_pan?: string;
		card_hash?: string;
	};
}

function baseUrl(env: ZarinpalEnvironment): string {
	return env === 'sandbox'
		? 'https://sandbox.zarinpal.com/pg/v4/payment'
		: 'https://api.zarinpal.com/pg/v4/payment';
}

function startPayUrl(env: ZarinpalEnvironment, authority: string): string {
	return env === 'sandbox'
		? `https://sandbox.zarinpal.com/pg/StartPay/${authority}`
		: `https://www.zarinpal.com/pg/StartPay/${authority}`;
}

/** درخواست پرداخت از زرین‌پال و برگرداندن آدرس درگاه. */
async function requestPayment(api: PluginApi, payload: {
	amount: number;
	description: string;
	callbackUrl: string;
	metadata?: { mobile?: string; email?: string };
}): Promise<{ ok: true; authority: string; url: string } | { ok: false; message: string }> {
	const merchantId = api.getSecret('merchantId');
	const isSandbox = Boolean(api.getOption('isSandbox', true));
	const env: ZarinpalEnvironment = isSandbox ? 'sandbox' : 'production';

	if (!merchantId) {
		return { ok: false, message: 'متغیر محیطی Merchant ID برای افزونهٔ زرین‌پال تنظیم نشده است.' };
	}

	try {
		const res = await fetch(`${baseUrl(env)}/request.json`, {
			method: 'POST',
			signal: AbortSignal.timeout(10_000),
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json',
			},
			body: JSON.stringify({
				merchant_id: merchantId,
				amount: payload.amount,
				callback_url: new URL(payload.callbackUrl, 'http://localhost').href,
				description: payload.description,
				metadata: payload.metadata ?? {},
			}),
		});

		const data: ZarinpalRequestResponse = await res.json();

		if (data.code !== 100 || !data.data?.authority) {
			return { ok: false, message: data.message || 'خطا در درخواست پرداخت از زرین‌پال.' };
		}

		return {
			ok: true,
			authority: data.data.authority,
			url: startPayUrl(env, data.data.authority),
		};
	} catch {
		return { ok: false, message: 'اتصال به درگاه زرین‌پال ممکن نشد.' };
	}
}

/** تایید پرداخت پس از بازگشت از بانک. */
async function verifyPayment(api: PluginApi, payload: {
	authority: string;
	amount: number;
}): Promise<{ ok: true; refId: string; cardPan?: string } | { ok: false; message: string }> {
	const merchantId = api.getSecret('merchantId');
	const isSandbox = Boolean(api.getOption('isSandbox', true));
	const env: ZarinpalEnvironment = isSandbox ? 'sandbox' : 'production';

	if (!merchantId) {
		return { ok: false, message: 'متغیر محیطی Merchant ID برای افزونهٔ زرین‌پال تنظیم نشده است.' };
	}

	try {
		const res = await fetch(`${baseUrl(env)}/verify.json`, {
			method: 'POST',
			signal: AbortSignal.timeout(10_000),
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json',
			},
			body: JSON.stringify({
				merchant_id: merchantId,
				authority: payload.authority,
				amount: payload.amount,
			}),
		});

		const data: ZarinpalVerifyResponse = await res.json();

		if (data.code !== 100 || !data.data?.ref_id) {
			return { ok: false, message: data.message || 'تایید پرداخت با خطا مواجه شد.' };
		}

		return {
			ok: true,
			refId: data.data.ref_id,
			cardPan: data.data.card_pan,
		};
	} catch {
		return { ok: false, message: 'اتصال به سرور تایید زرین‌پال ممکن نشد.' };
	}
}

/** ویجت داشبورد: فقط وضعیت پیکربندی Merchant ID و حالت انتخاب‌شده را نشان می‌دهد. */
function widgetHtml(api: PluginApi): string {
	const merchantIdConfigured = api.hasSecret('merchantId');
	const isSandbox = Boolean(api.getOption('isSandbox', true));

	const status = merchantIdConfigured ? 'شناسهٔ Merchant ثبت شده' : 'شناسهٔ Merchant تنظیم نشده';
	const envLabel = isSandbox ? 'حالت انتخاب‌شده: آزمایشی' : 'حالت انتخاب‌شده: عملی';

	return `<div class="zarinpal-widget">
		<span class="zarinpal__label">پیکربندی افزونهٔ زرین‌پال</span>
		<span class="zarinpal__status">${escapeHtml(status)}</span>
		<span class="zarinpal__env">${escapeHtml(envLabel)}</span>
	</div>`;
}

/** صفحهٔ تنظیمات افزونه. */
function settingsHtml(api: PluginApi): string {
	const merchantIdConfigured = api.hasSecret('merchantId');
	const merchantIdEnvironment = pluginSecretEnvironmentName(api.id, 'merchantId');
	const isSandbox = Boolean(api.getOption('isSandbox', true));

	const checked = (value: boolean) => (value ? 'checked' : '');

	return `<section class="card">
		<div class="card__head">
			<h2 class="card__title">تنظیمات درگاه پرداخت زرین‌پال</h2>
		</div>
		<div class="card__body">
			<p class="alert alert--info">وجود Merchant ID یا انتخاب Sandbox به‌معنی اتصال تأییدشده نیست. اتصال زنده و تراکنش واقعی در این مخزن آزمایش نشده است؛ پیش از دریافت وجه، پروتکل جاری را با مستندات رسمی و محیط آزمایشی تأیید کنید.</p>
		</div>
		<form method="post" action="/cms/api/plugins" novalidate>
			<input type="hidden" name="action" value="save-options" />
			<input type="hidden" name="pluginId" value="zarinpal-gateway" />

				<div class="form-group">
					<label class="form-label">شناسه تاجر (Merchant ID)</label>
					<span class="badge ${merchantIdConfigured ? 'badge--success' : 'badge--warning'}">${merchantIdConfigured ? 'در محیط اجرا تنظیم شده' : 'تنظیم نشده'}</span>
					<p class="form-help">مقدار را در متغیر محیطی <code dir="ltr">${escapeHtml(merchantIdEnvironment)}</code> قرار دهید؛ مقدار خام در پنل یا فایل JSON ذخیره نمی‌شود.</p>
				</div>

			<div class="form-group">
				<label class="form-switch">
					<input type="checkbox" name="opt_isSandbox" ${checked(isSandbox)} />
					<span>حالت آزمایشی (Sandbox)</span>
				</label>
				<p class="form-help">اگر فعال باشد، به درگاه آزمایشی زرین‌پال وصل می‌شود.</p>
			</div>

			<div class="form-actions">
				<button class="btn btn--primary" type="submit">ذخیره تنظیمات</button>
			</div>
		</form>
	</section>`;
}

export function register(api: PluginApi): void {
	/* réduit les doublons : on garde le widget optionnel pour le dashboard */
	api.addFilter('cms.dashboard.widgets', (_value, _context) => {
		const widgets = Array.isArray(_value) ? (_value as DashboardWidget[]) : [];
		widgets.push({
			id: 'zarinpal-status',
			title: 'وضعیت درگاه زرین‌پال',
			html: widgetHtml(api),
		});
		return widgets;
	});

	/* پیاده‌سازی reduce_t: payment initiate */
	api.addFilter('shop.payment.initiate', async (_value, context) => {
		const ctx = (context ?? {}) as { orderId: string; amount: number; description: string; callbackUrl: string; metadata?: { mobile?: string; email?: string } };

		const result = await requestPayment(api, {
			amount: ctx.amount,
			description: ctx.description,
			callbackUrl: ctx.callbackUrl,
			metadata: ctx.metadata,
		});

		if (!result.ok) {
			throw new Error(result.message);
		}

		return {
			provider: 'zarinpal',
			authority: result.authority,
			url: result.url,
		};
	});

	/* پیاده‌سازی reduce_t: payment verify */
	api.addFilter('shop.payment.verify', async (_value, context) => {
		const ctx = (context ?? {}) as { authority: string; amount: number };

		const result = await verifyPayment(api, {
			authority: ctx.authority,
			amount: ctx.amount,
		});

		if (!result.ok) {
			throw new Error(result.message);
		}

		return {
			provider: 'zarinpal',
			refId: result.refId,
			cardPan: result.cardPan,
			verified: true,
		};
	});
}

/** صفحهٔ اختصاصی پنل — کلید همان `path` است که در plugin.json اعلام شده است. */
export const pages = {
	async settings(api: PluginApi): Promise<string> {
		return settingsHtml(api);
	},
};
