/**
 * Plugin Name: پیامک کاوه‌نگار
 * Description: پیکربندی پیامک و توابع SMS/OTP؛ گردش‌کارهای خرید هنوز به آن وصل نیستند.
 * Version:     1.0.0
 * License:     MIT
 * Text Domain: novex-kaveh-neg-sms
 *
 * این افزونه صفحهٔ تنظیمات و توابع سروری SMS/OTP دارد؛ فعال‌سازی آن به‌تنهایی
 * پیام نمی‌فرستد و گردش‌کارهای فروشگاه هنوز به این توابع وصل نشده‌اند.
 * کلید فقط از secret محیطی خوانده می‌شود و در فایل تنظیمات ذخیره نمی‌شود.
 */

import { escapeHtml } from '../../src/lib/plugins/html.ts';
import { pluginSecretEnvironmentName } from '../../src/lib/plugins/secrets.ts';
import type { PluginApi } from '../../src/lib/plugins/types.ts';

interface KavenegarSendResponse {
	return?: {
		status?: number;
		message?: string;
	};
	entries?: Array<{
		messageid?: string;
		message?: string;
		status?: number;
		statusText?: string;
		receptor?: string;
		date?: number;
		cost?: number;
	}>;
}

function validReceptor(value: unknown): value is string {
	return typeof value === 'string' && /^\+?[0-9]{7,15}$/.test(value.trim());
}

function validApiKey(value: string): boolean {
	return value.length > 0 && value.length <= 512 && !/\s/.test(value);
}

/** Send SMS via Kaveh Negar API using the declared environment secret and plugin settings. */
async function kavenegarSendSms(api: PluginApi, payload: {
	receptor: string;
	message: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; message: string }> {
	const apiKey = api.getSecret('apiKey');
	if (!apiKey) {
		return { ok: false, message: 'متغیر محیطی کلید API کاوه‌نگار تنظیم نشده است.' };
	}
	if (!validApiKey(apiKey)) {
		return { ok: false, message: 'قالب کلید API محیطی معتبر نیست.' };
	}

	const receptor = typeof payload.receptor === 'string' ? payload.receptor.trim() : '';
	const message = typeof payload.message === 'string' ? payload.message.trim() : '';
	if (!validReceptor(receptor)) {
		return { ok: false, message: 'شمارهٔ گیرنده باید ۷ تا ۱۵ رقم و بدون فاصله باشد.' };
	}
	if (!message || message.length > 1000) {
		return { ok: false, message: 'متن پیامک نباید خالی یا بیشتر از ۱۰۰۰ نویسه باشد.' };
	}

	const sender = String(api.getOption('senderNumber', '')).trim();
	if (sender && !/^[0-9]{4,20}$/.test(sender)) {
		return { ok: false, message: 'شمارهٔ فرستنده باید فقط شامل ۴ تا ۲۰ رقم باشد.' };
	}

	try {
		const res = await fetch(
			`https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/sms/send.json`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json',
				},
				body: JSON.stringify({ receptor, message, sender }),
				signal: AbortSignal.timeout(10_000),
			},
		);

		const data: KavenegarSendResponse = await res.json();
		const messageId = data.entries?.[0]?.messageid;
		if (!res.ok || data.return?.status !== 200 || !messageId) {
			return { ok: false, message: data.return?.message || 'ارسال پیامک از سوی سرویس تأیید نشد.' };
		}

		return { ok: true, messageId };
	} catch {
		return { ok: false, message: 'پاسخی از سرویس پیامک دریافت نشد؛ وضعیت ارسال از اینجا قابل تأیید نیست.' };
	}
}

/** Send verification OTP via Kaveh Negar verify/lookup using the declared environment secret and plugin settings. */
async function kavenegarSendOtp(api: PluginApi, payload: {
	receptor: string;
	token: string;
	tokenType: string;
	template?: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; message: string }> {
	const apiKey = api.getSecret('apiKey');
	if (!apiKey) {
		return { ok: false, message: 'متغیر محیطی کلید API کاوه‌نگار تنظیم نشده است.' };
	}
	if (!validApiKey(apiKey)) {
		return { ok: false, message: 'قالب کلید API محیطی معتبر نیست.' };
	}

	const receptor = typeof payload.receptor === 'string' ? payload.receptor.trim() : '';
	const token = typeof payload.token === 'string' ? payload.token.trim() : '';
	const tokenType = typeof payload.tokenType === 'string' ? payload.tokenType.trim() : '';
	const providedTemplate = typeof payload.template === 'string' ? payload.template.trim() : '';
	const template = String(providedTemplate || api.getOption('defaultTemplate', '')).trim();
	if (!validReceptor(receptor)) {
		return { ok: false, message: 'شمارهٔ گیرنده باید ۷ تا ۱۵ رقم و بدون فاصله باشد.' };
	}
	if (!token || token.length > 100 || !tokenType || tokenType.length > 40) {
		return { ok: false, message: 'کد و نوع کد تأیید باید مقدار معتبر و کوتاه داشته باشند.' };
	}
	if (!template || template.length > 80) {
		return { ok: false, message: 'نام قالب Verify Lookup را از پنل کاوه‌نگار تنظیم کنید.' };
	}

	try {
		const res = await fetch(
			`https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/verify/lookup.json`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json',
				},
				body: JSON.stringify({ receptor, token, token_type: tokenType, template }),
				signal: AbortSignal.timeout(10_000),
			},
		);

		const data: KavenegarSendResponse = await res.json();
		const messageId = data.entries?.[0]?.messageid;
		if (!res.ok || data.return?.status !== 200 || !messageId) {
			return { ok: false, message: data.return?.message || 'ارسال کد تأیید از سوی سرویس تأیید نشد.' };
		}

		return { ok: true, messageId };
	} catch {
		return { ok: false, message: 'پاسخی از سرویس پیامک دریافت نشد؛ وضعیت ارسال از اینجا قابل تأیید نیست.' };
	}
}

/** صفحهٔ تنظیمات افزونه. */
function settingsHtml(api: PluginApi): string {
	const apiKeyConfigured = api.hasSecret('apiKey');
	const apiKeyEnvironment = pluginSecretEnvironmentName(api.id, 'apiKey');
	const senderNumber = String(api.getOption('senderNumber', ''));
	const defaultTemplate = String(api.getOption('defaultTemplate', ''));

	return `<section class="card">
		<div class="card__head">
			<h2 class="card__title">تنظیمات پیامک کاوه‌نگار</h2>
		</div>
		<div class="card__body">
			<p class="alert alert--info">فعال‌سازی یا ذخیرهٔ این صفحه هیچ پیامکی نمی‌فرستد. توابع ارسال فقط در صورت فراخوانی از کد سرور اجرا می‌شوند؛ گردش‌کار خرید در حال حاضر به آن‌ها متصل نیست.</p>
		</div>
		<form method="post" action="/cms/api/plugins" novalidate>
			<input type="hidden" name="action" value="save-options" />
			<input type="hidden" name="pluginId" value="kaveh-neg-sms" />

				<div class="form-group">
					<label class="form-label">کلید API کاوه‌نگار</label>
					<span class="badge ${apiKeyConfigured ? 'badge--success' : 'badge--warning'}">${apiKeyConfigured ? 'در محیط اجرا تنظیم شده' : 'تنظیم نشده'}</span>
					<p class="form-help">کلید را در متغیر محیطی <code dir="ltr">${escapeHtml(apiKeyEnvironment)}</code> قرار دهید؛ مقدار محرمانه در پنل یا فایل JSON ذخیره نمی‌شود.</p>
				</div>

			<div class="form-group">
						<label class="form-label">شمارهٔ فرستنده</label>
						<input class="form-input" type="text" name="opt_senderNumber" value="${escapeHtml(senderNumber)}" placeholder="شمارهٔ خط ثبت‌شده" />
						<p class="form-help">شمارهٔ فرستنده‌ای را وارد کنید که برای حساب شما در کاوه‌نگار ثبت شده است.</p>
			</div>

			<div class="form-group">
						<label class="form-label">نام قالب تأیید OTP</label>
						<input class="form-input" type="text" name="opt_defaultTemplate" value="${escapeHtml(defaultTemplate)}" placeholder="نام قالب ثبت‌شده در پنل کاوه‌نگار" />
						<p class="form-help">نام قالب Verify Lookup را وارد کنید، نه متن پیام. تا پیش از ثبت قالب در پنل سرویس، این فیلد را خالی بگذارید.</p>
			</div>

			<div class="form-actions">
				<button class="btn btn--primary" type="submit">ذخیره تنظیمات</button>
			</div>
		</form>
	</section>`;
}

export function register(_api: PluginApi): void {
	// افزونه فقط صفحهٔ تنظیمات و توابع کمکی را فراهم می‌کند.
	// سایر افزونه‌ها می‌توانند از طریق import مستقیم توابع ارسال پیامک را فراخوانی کنند.
}

/** صفحهٔ اختصاصی پنل — کلید همان `path` است که در plugin.json اعلام شده است. */
export const pages = {
	async settings(api: PluginApi): Promise<string> {
		return settingsHtml(api);
	},
};

/** ارسال پیامک عادی (برای استفاده توسط سایر ماژول‌ها با دسترسی به api). */
export async function sendSms(api: PluginApi, receptor: string, message: string): Promise<{ ok: boolean; message?: string; messageId?: string }> {
	return kavenegarSendSms(api, { receptor, message });
}

/** ارسال کد تایید (OTP) (برای استفاده توسط سایر ماژول‌ها با دسترسی به api). */
export async function sendOtp(api: PluginApi, receptor: string, token: string, tokenType: string, template?: string): Promise<{ ok: boolean; message?: string; messageId?: string }> {
	return kavenegarSendOtp(api, { receptor, token, tokenType, template });
}
