/**
 * Site settings edited from the panel and persisted as JSON next to the code,
 * so changes survive restarts without a database.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CmsError } from './posts';
import { asBoolean, asText } from './http';

export const SETTINGS_FILE = path.resolve(process.cwd(), 'data/cms-settings.json');

export interface SiteSettings {
	siteTitle: string;
	siteDescription: string;
	authorName: string;
	authorEmail: string;
	heroTitle: string;
	heroSubtitle: string;
	footerNote: string;
	language: 'fa';
	direction: 'rtl';
	calendar: 'jalali' | 'gregorian';
	dateStyle: 'long' | 'medium' | 'short';
	digits: 'persian' | 'latin';
	timezone: string;
	postsPerPage: number;
	showAuthor: boolean;
	showReadingTime: boolean;
	enableRss: boolean;
	enableComments: boolean;
	maintenanceMode: boolean;
	/** ماژول فروشگاه: منو، داشبورد و صفحه‌های تجارت را روشن می‌کند. */
	commerceEnabled: boolean;
	currency: string;
	shopTitle: string;
	shopDescription: string;
	social: {
		github: string;
		telegram: string;
		instagram: string;
		linkedin: string;
	};
}

export const defaultSettings: SiteSettings = {
	siteTitle: 'نووکس‌کد',
	siteDescription: 'آزمایشگاه نوشتن، کد و طراحی — با تمرکز بر تجربهٔ فارسی.',
	authorName: 'سینا قفاری',
	authorEmail: 'hello@novexcode.ir',
	heroTitle: 'کد را فارسی بنویس، فارسی بخوان.',
	heroSubtitle: 'مجلهٔ فنی نووکس‌کد؛ نوشته‌هایی دربارهٔ فرانت‌اند، معماری نرم‌افزار و طراحی راست‌به‌چپ.',
	footerNote: 'ساخته‌شده با آسترو و احترام به تایپوگرافی فارسی.',
	language: 'fa',
	direction: 'rtl',
	calendar: 'jalali',
	dateStyle: 'medium',
	digits: 'persian',
	timezone: 'Asia/Tehran',
	postsPerPage: 6,
	showAuthor: false,
	showReadingTime: true,
	enableRss: true,
	enableComments: false,
	maintenanceMode: false,
	commerceEnabled: true,
	currency: 'تومان',
	shopTitle: 'فروشگاه نووکس‌کد',
	shopDescription: 'ابزارهای فارسی برای ساخت وب‌سایت و فروشگاه — قالب، کیت رابط کاربری و دورهٔ آموزشی.',
	social: {
		github: 'https://github.com/sinaqaffari',
		telegram: '',
		instagram: '',
		linkedin: '',
	},
};

function coerce(raw: Partial<SiteSettings> | undefined): SiteSettings {
	const merged: SiteSettings = {
		...defaultSettings,
		...((raw ?? {}) as Partial<SiteSettings>),
		social: { ...defaultSettings.social, ...(raw?.social ?? {}) },
	};

	merged.postsPerPage = Number.isFinite(Number(merged.postsPerPage))
		? Math.min(50, Math.max(1, Math.round(Number(merged.postsPerPage))))
		: defaultSettings.postsPerPage;

	// The panel is RTL and Persian by design — never drift from that contract.
	merged.language = 'fa';
	merged.direction = 'rtl';

	return merged;
}

export async function readSettings(): Promise<SiteSettings> {
	try {
		const raw = await readFile(SETTINGS_FILE, 'utf8');
		return coerce(JSON.parse(raw) as Partial<SiteSettings>);
	} catch {
		return { ...defaultSettings, social: { ...defaultSettings.social } };
	}
}

export async function writeSettings(payload: Record<string, unknown>): Promise<SiteSettings> {
	const current = await readSettings();
	const next = coerce({
		...current,
		siteTitle: asText(payload.siteTitle, current.siteTitle).trim(),
		siteDescription: asText(payload.siteDescription, current.siteDescription).trim(),
		authorName: asText(payload.authorName, current.authorName).trim(),
		authorEmail: asText(payload.authorEmail, current.authorEmail).trim(),
		heroTitle: asText(payload.heroTitle, current.heroTitle).trim(),
		heroSubtitle: asText(payload.heroSubtitle, current.heroSubtitle).trim(),
		footerNote: asText(payload.footerNote, current.footerNote).trim(),
		calendar: payload.calendar === 'gregorian' ? 'gregorian' : 'jalali',
		dateStyle:
			payload.dateStyle === 'long' || payload.dateStyle === 'short'
				? payload.dateStyle
				: 'medium',
		digits: payload.digits === 'latin' ? 'latin' : 'persian',
		timezone: asText(payload.timezone, current.timezone).trim() || defaultSettings.timezone,
		postsPerPage: Number(payload.postsPerPage ?? current.postsPerPage),
		showAuthor: asBoolean(payload.showAuthor ?? current.showAuthor),
		showReadingTime: asBoolean(payload.showReadingTime ?? current.showReadingTime),
		enableRss: asBoolean(payload.enableRss ?? current.enableRss),
		enableComments: asBoolean(payload.enableComments ?? current.enableComments),
		maintenanceMode: asBoolean(payload.maintenanceMode ?? current.maintenanceMode),
		commerceEnabled: asBoolean(payload.commerceEnabled ?? current.commerceEnabled),
		currency: asText(payload.currency, current.currency).trim() || defaultSettings.currency,
		shopTitle: asText(payload.shopTitle, current.shopTitle).trim() || defaultSettings.shopTitle,
		shopDescription:
			asText(payload.shopDescription, current.shopDescription).trim() ||
			defaultSettings.shopDescription,
		social: {
			github: asText(payload['social.github'], current.social.github).trim(),
			telegram: asText(payload['social.telegram'], current.social.telegram).trim(),
			instagram: asText(payload['social.instagram'], current.social.instagram).trim(),
			linkedin: asText(payload['social.linkedin'], current.social.linkedin).trim(),
		},
	});

	if (!next.siteTitle) throw new CmsError('نام سایت الزامی است.', 'siteTitle');
	if (!next.siteDescription) throw new CmsError('توضیح کوتاه سایت الزامی است.', 'siteDescription');
	if (next.authorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.authorEmail)) {
		throw new CmsError('ایمیل واردشده معتبر نیست.', 'authorEmail');
	}

	await mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
	await writeFile(SETTINGS_FILE, `${JSON.stringify(next, null, '\t')}\n`, 'utf8');
	return next;
}

/** Timezone options offered in the panel — all of them Iranian defaults. */
export const TIMEZONES = [
	{ value: 'Asia/Tehran', label: 'تهران (ایران)' },
	{ value: 'Asia/Kabul', label: 'کابل (افغانستان)' },
	{ value: 'Asia/Baghdad', label: 'بغداد (عراق)' },
	{ value: 'Asia/Dubai', label: 'دوبی (امارات)' },
	{ value: 'Europe/Berlin', label: 'برلین (آلمان)' },
	{ value: 'America/New_York', label: 'نیویورک (آمریکا)' },
];
