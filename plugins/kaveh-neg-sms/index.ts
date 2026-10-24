/**
 * Plugin Name: پیامک کاوه‌نگار
 * Description: ارسال پیامک تاییدیه و اعلان از طریق کاوه‌نگار.
 * Version:     1.0.0
 * Author:      تیم نووکس
 * License:     MIT
 * Text Domain: novex-kaveh-neg-sms
 *
 * این افزونه صفحهٔ تنظیمات در پنل مدیریت دارد و توابع کمکی برای ارسال SMS
 * و کد تایید (OTP) از طریق API کاوه‌نگار ارائه می‌دهد.
 * داده را فقط از API می‌گیرد و به فایل‌های سرور دسترسی ندارد.
 */

import { escapeHtml } from '../../src/lib/plugins/html';
import type { PluginApi } from '../../src/lib/plugins/types';

interface KavenegarSendResponse {
	return: {
		status: number;
		message: string;
	};
	entries?: Array<{
		messageid: string;
		message: string;
		status: number;
		statusText: string;
		receptor: string;
		date: number;
		cost: number;
	}>;
}

/** Send SMS via Kaveh Negar API using the plugin's stored options. */
async function kavenegarSendSms(api: PluginApi, payload: {
	receptor: string;
	message: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; message: string }> {
	const apiKey = String(api.getOption('apiKey', ''));
	if (!apiKey) {
		return { ok: false, message: 'کلید API کاوه‌نگار در تنظیمات تعریف نشده است.' };
	}

	try {
		const res = await fetch(
			`https://api.kavenegar.com/v1/${apiKey}/sms/send.json`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json',
				},
				body: JSON.stringify({
					receptor: payload.receptor,
					message: payload.message,
					sender: String(api.getOption('senderNumber', '')),
				}),
			},
		);

		const data: KavenegarSendResponse = await res.json();

		if (data.return.status !== 200 || !data.entries?.[0]) {
			return { ok: false, message: data.return.message || 'خطا در ارسال پیامک.' };
		}

		return {
			ok: true,
			messageId: data.entries[0].messageid,
		};
	} catch {
		return { ok: false, message: 'اتصال به سرور کاوه‌نگار ممکن نشد.' };
	}
}

/** Send verification OTP via Kaveh Negar verify/lookup using the plugin's stored options. */
async function kavenegarSendOtp(api: PluginApi, payload: {
	receptor: string;
	token: string;
	tokenType: string;
	template?: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; message: string }> {
	const apiKey = String(api.getOption('apiKey', ''));
	if (!apiKey) {
		return { ok: false, message: 'کلید API کاوه‌نگار در تنظیمات تعریف نشده است.' };
	}

	const template = payload.template ?? String(api.getOption('defaultTemplate', 'کد تایید شما: {code}'));

	try {
		const res = await fetch(
			`https://api.kavenegar.com/v1/${apiKey}/verify/lookup.json`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json',
				},
				body: JSON.stringify({
					receptor: payload.receptor,
					token: payload.token,
					token_type: payload.tokenType,
					template,
				}),
			},
		);

		const data: KavenegarSendResponse = await res.json();

		if (data.return.status !== 200 || !data.entries?.[0]) {
			return { ok: false, message: data.return.message || 'خطا در ارسال کد تایید.' };
		}

		return {
			ok: true,
			messageId: data.entries[0].messageid,
		};
	} catch {
		return { ok: false, message: 'اتصال به سرور تاییدیه کاوه‌نگار ممکن نشد.' };
	}
}

/** صفحهٔ تنظیمات افزونه. */
function settingsHtml(api: PluginApi): string {
	const apiKey = String(api.getOption('apiKey', ''));
	const senderNumber = String(api.getOption('senderNumber', ''));
	const defaultTemplate = String(api.getOption('defaultTemplate', 'کد تایید شما: {code}'));

	return `<section class="card">
		<div class="card__head">
			<h2 class="card__title">تنظیمات پیامک کاوه‌نگار</h2>
		</div>
		<form method="post" action="/cms/api/plugins" novalidate>
			<input type="hidden" name="action" value="save-options" />
			<input type="hidden" name="pluginId" value="kaveh-neg-sms" />

			<div class="form-group">
				<label class="form-label">کلید API کاوه‌نگار</label>
				<input class="form-input" type="text" name="opt_apiKey" value="${escapeHtml(apiKey)}" placeholder="xxxxxxxxxxxxxxxx" />
				<p class="form-help">کلید API را از پنل کاربری کاوه‌نگار دریافت کنید.</p>
			</div>

			<div class="form-group">
				<label class="form-label">شماره فرستنده (خط عددی)</label>
				<input class="form-input" type="text" name="opt_senderNumber" value="${escapeHtml(senderNumber)}" placeholder="30005000000000" />
				<p class="form-help">شماره خط عددی ثبت‌شده در کاوه‌نگار.</p>
			</div>

			<div class="form-group">
				<label class="form-label">قالب پیش‌فرض پیامک</label>
				<input class="form-input" type="text" name="opt_defaultTemplate" value="${escapeHtml(defaultTemplate)}" placeholder="کد تایید شما: {code}" />
				<p class="form-help">از {@code} برای جایگذاری کد تایید استفاده کنید.</p>
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
