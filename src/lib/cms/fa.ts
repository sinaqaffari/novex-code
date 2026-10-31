/**
 * Persian (fa-IR) formatting helpers.
 * Every number, date and label rendered by the CMS goes through here so the
 * whole panel speaks one language — Persian — with Persian digits and the
 * Jalali (Solar Hijri) calendar.
 */

export const FA_LOCALE = 'fa-IR';
export const JALALI_LOCALE = 'fa-IR-u-ca-persian';

const numberFormatter = new Intl.NumberFormat(FA_LOCALE);
const relativeFormatter = new Intl.RelativeTimeFormat(FA_LOCALE, { numeric: 'auto' });
const decimalFormatter = new Intl.NumberFormat(FA_LOCALE, {
	maximumFractionDigits: 1,
});

const timeFormatter = new Intl.DateTimeFormat(JALALI_LOCALE, {
	hour: '2-digit',
	minute: '2-digit',
});

const dateStyles = {
	short: { month: 'short', day: 'numeric' },
	medium: { year: 'numeric', month: 'long', day: 'numeric' },
	long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
} as const;

const dateFormatters = {
	short: new Intl.DateTimeFormat(JALALI_LOCALE, dateStyles.short),
	medium: new Intl.DateTimeFormat(JALALI_LOCALE, dateStyles.medium),
	long: new Intl.DateTimeFormat(JALALI_LOCALE, dateStyles.long),
};

/** Turn any value into a valid Date, or `null`. */
export function toDate(value: unknown): Date | null {
	if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value;
	if (typeof value === 'number') return new Date(value);
	if (typeof value !== 'string' || value.trim() === '') return null;
	const raw = value.trim();
	// `1404-02-02` style input is Jalali, not Gregorian — refuse to guess.
	const parsed = new Date(raw);
	return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

/** ۱۲۳۴ */
export function faNumber(value: number | string): string {
	const numeric = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(numeric)) return '—';
	return numberFormatter.format(numeric);
}

/** ۲٫۵ */
export function faDecimal(value: number): string {
	return Number.isFinite(value) ? decimalFormatter.format(value) : '—';
}

/** ۱۲ آبان ۱۴۰۵ */
export function faDate(value: unknown, style: keyof typeof dateFormatters = 'medium'): string {
	const date = toDate(value);
	if (!date) return '—';
	return dateFormatters[style].format(date);
}

/** ۱۲ آبان ۱۴۰۵، ساعت ۱۴:۳۰ */
export function faDateTime(value: unknown): string {
	const date = toDate(value);
	if (!date) return '—';
	return `${dateFormatters.medium.format(date)}، ساعت ${timeFormatter.format(date)}`;
}

/** ISO date (YYYY-MM-DD) for `<input type="date">`. */
export function toIsoDateInput(value: unknown): string {
	const date = toDate(value);
	if (!date) return '';
	const dateOnly = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return dateOnly.toISOString().slice(0, 10);
}

/** «۳ روز پیش» — falls back to an absolute date for anything older than a month. */
export function faRelative(value: unknown, now = new Date()): string {
	const date = toDate(value);
	if (!date) return '—';
	const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
	const absolute = Math.abs(seconds);

	const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
		['year', 31_536_000],
		['month', 2_592_000],
		['day', 86_400],
		['hour', 3_600],
		['minute', 60],
		['second', 1],
	];

	if (absolute > 2_592_000) return faDate(date);

	for (const [unit, unitSeconds] of units) {
		if (absolute >= unitSeconds || unit === 'second') {
			return relativeFormatter.format(Math.round(seconds / unitSeconds), unit);
		}
	}
	return faDate(date);
}

/** ۱۲٫۴ کیلوبایت */
export function faFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '۰ بایت';
	const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const size = bytes / 1024 ** exponent;
	return `${faDecimal(Math.round(size * 10) / 10)} ${units[exponent]}`;
}

/** Slow, thoughtful reading — ۲۰۰ واژه در دقیقه for Persian prose. */
export function faReadingTime(words: number): string {
	const minutes = Math.max(1, Math.round(words / 200));
	return `${faNumber(minutes)} دقیقه مطالعه`;
}

/** Convert Latin digits to Persian digits inside any string. */
export function toPersianDigits(input: string): string {
	return input.replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

const moneyFormatter = new Intl.NumberFormat(FA_LOCALE, { maximumFractionDigits: 0 });

/** ۱٬۲۵۰٬۰۰۰ تومان */
export function faMoney(amount: number, currency = 'تومان'): string {
	if (!Number.isFinite(amount)) return '—';
	return `${moneyFormatter.format(Math.round(amount))}\u00A0${currency}`;
}

/** ۱۲٫۵ میلیون تومان — برای کارت‌های خلاصه */
export function faCompactMoney(amount: number, currency = 'تومان'): string {
	if (!Number.isFinite(amount)) return '—';
	const abs = Math.abs(amount);
	if (abs >= 1_000_000_000) {
		return `${decimalFormatter.format(Math.round((amount / 1_000_000_000) * 10) / 10)}\u00A0میلیارد ${currency}`;
	}
	if (abs >= 1_000_000) {
		return `${decimalFormatter.format(Math.round((amount / 1_000_000) * 10) / 10)}\u00A0میلیون ${currency}`;
	}
	if (abs >= 1_000) {
		return `${decimalFormatter.format(Math.round((amount / 1_000) * 10) / 10)}\u00A0هزار ${currency}`;
	}
	return faMoney(amount, currency);
}

/** ۲۵٪ */
export function faPercent(value: number): string {
	if (!Number.isFinite(value)) return '—';
	return `${decimalFormatter.format(Math.round(value * 10) / 10)}٪`;
}

/** ۲۵٪ — alias خوانا برای جدول‌ها */
export const faRate = faPercent;
