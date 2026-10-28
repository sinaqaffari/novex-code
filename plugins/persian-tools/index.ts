/**
 * Plugin Name: ابزارهای فارسی
 * Description: تقویم جلالی، اعداد فارسی و تنظیمات نمایش تاریخ.
 * Version:     1.0.0
 * License:     MIT
 * Text Domain: novex-persian-tools
 *
 * این افزونه دو لایه رابط دارد:
 *  - ویجت داشبورد: تاریخ امروز در تقویم جلالی (همراه با زمان تهران).
 *  - صفحهٔ تنظیمات: انتخاب فرمت تاریخ، اعداد فارسی و نمایش روز هفته.
 *
 * داده را فقط از API می‌گیرد و HTML امن برمی‌گرداند؛ به فایل‌ها دسترسی ندارد.
 */

import { escapeHtml } from '../../src/lib/plugins/html';
import type { DashboardWidget, PluginApi } from '../../src/lib/plugins/types';

const JALALI_LOCALE = 'fa-IR-u-ca-persian';

const dateFormatters: Record<string, Intl.DateTimeFormat> = {
	short: new Intl.DateTimeFormat(JALALI_LOCALE, {
		timeZone: 'Asia/Tehran',
		month: 'short',
		day: 'numeric',
	}),
	medium: new Intl.DateTimeFormat(JALALI_LOCALE, {
		timeZone: 'Asia/Tehran',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	}),
	long: new Intl.DateTimeFormat(JALALI_LOCALE, {
		timeZone: 'Asia/Tehran',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		weekday: 'long',
	}),
};

const timeFormatter = new Intl.DateTimeFormat(JALALI_LOCALE, {
	timeZone: 'Asia/Tehran',
	hour: '2-digit',
	minute: '2-digit',
});

function toPersianDigits(input: string): string {
	return input.replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function formatDate(value: unknown, style: string, showWeekday: boolean): string {
	const date = new Date(String(value ?? ''));
	if (Number.isNaN(date.valueOf())) return '—';

	const formatter = dateFormatters[style] ?? dateFormatters.medium;
	let result = formatter.format(date);

	if (!showWeekday && style === 'long') {
		// حذف روز هفته برای فرمت long وقتی showWeekday غیرفعال است.
		result = result.replace(/^(دوشنبه|سه‌شنبه|چهارشنبه|پنج‌شنبه|جمعه|شنبه|یک‌شنبه)،\s*/, '');
	}

	return result;
}

function formatTime(value: unknown): string {
	const date = new Date(String(value ?? ''));
	if (Number.isNaN(date.valueOf())) return '—';
	return timeFormatter.format(date);
}

/** ویجت داشبورد: تاریخ و زمان امروز در تقویم جلالی. */
function widgetHtml(api: PluginApi): string {
	const now = new Date();
	const dateFormat = String(api.getOption('dateFormat', 'medium'));
	const usePersianDigits = Boolean(api.getOption('usePersianDigits', true));
	const showWeekday = Boolean(api.getOption('showWeekday', false));

	const datePart = formatDate(now, dateFormat, showWeekday);
	const timePart = formatTime(now);

	const html = `<div class="persian-tools__now">
		<span class="persian-tools__label">تاریخ امروز (جلالی)</span>
		<span class="persian-tools__date">${escapeHtml(datePart)}</span>
		<span class="persian-tools__time">${escapeHtml(timePart)}</span>
	</div>`;

	return usePersianDigits ? toPersianDigits(html) : html;
}

/** صفحهٔ تنظیمات افزونه. */
function settingsHtml(api: PluginApi): string {
	const dateFormat = String(api.getOption('dateFormat', 'medium'));
	const usePersianDigits = Boolean(api.getOption('usePersianDigits', true));
	const showWeekday = Boolean(api.getOption('showWeekday', false));

	const checked = (value: boolean) => (value ? 'checked' : '');
	const selected = (value: string) => (dateFormat === value ? 'selected' : '');

	return `<section class="card">
		<div class="card__head">
			<h2 class="card__title">تنظیمات ابزارهای فارسی</h2>
		</div>
		<form method="post" action="/cms/api/plugins" novalidate>
			<input type="hidden" name="action" value="save-options" />
			<input type="hidden" name="pluginId" value="persian-tools" />

			<div class="form-group">
				<label class="form-label">فرمت تاریخ ویجت</label>
				<select class="form-input" name="opt_dateFormat">
					<option value="short" ${selected('short')}>کوتاه (۱۲ آبان)</option>
					<option value="medium" ${selected('medium')}>متوسط (۱۲ آبان ۱۴۰۵)</option>
					<option value="long" ${selected('long')}>طولانی (سه‌شنبه ۱۲ آبان ۱۴۰۵)</option>
				</select>
				<p class="form-help">فقط تاریخ ویجت داشبورد را تغییر می‌دهد؛ فرمت تاریخ سایر صفحه‌ها از تنظیمات سایت می‌آید.</p>
			</div>

			<div class="form-group">
				<label class="form-switch">
					<input type="checkbox" name="opt_usePersianDigits" ${checked(usePersianDigits)} />
					<span>اعداد فارسی در ویجت تاریخ</span>
				</label>
				<p class="form-help">این گزینه فقط شکل اعداد همین ویجت را تغییر می‌دهد؛ برای کل سایت از تنظیمات سایت استفاده کنید.</p>
			</div>

			<div class="form-group">
				<label class="form-switch">
					<input type="checkbox" name="opt_showWeekday" ${checked(showWeekday)} />
					<span>نمایش روز هفته در ویجت</span>
				</label>
				<p class="form-help">روز هفته به تاریخ جلالی همین ویجت اضافه می‌شود.</p>
			</div>

			<div class="form-actions">
				<button class="btn btn--primary" type="submit">ذخیره تنظیمات</button>
			</div>
		</form>
	</section>`;
}

export function register(api: PluginApi): void {
	api.addFilter('cms.dashboard.widgets', (_value, _context) => {
		const widgets = Array.isArray(_value) ? (_value as DashboardWidget[]) : [];

		widgets.push({
			id: 'persian-tools-now',
			title: 'تاریخ امروز (جلالی)',
			html: widgetHtml(api),
		});

		return widgets;
	});
}

/** صفحهٔ اختصاصی پنل — کلید همان `path` است که در plugin.json اعلام شده است. */
export const pages = {
	async settings(api: PluginApi): Promise<string> {
		return settingsHtml(api);
	},
};
