/**
 * Plugin Name: سئوی صفحات عمومی
 * Description: کنونیکال، Twitter Card و JSON-LD برای صفحه‌های قابل نمایه‌سازی.
 * Version:     1.0.0
 * License:     MIT
 *
 * متادیتای پایهٔ Open Graph را پوستهٔ میزبان تولید می‌کند؛ این افزونه فقط
 * موارد تکمیلی را می‌افزاید تا تگ‌های تکراری ساخته نشوند.
 */

import { escapeAttribute, escapeHtml, escapeJsonLd } from '../../src/lib/plugins/html.ts';
import type { PluginApi } from '../../src/lib/plugins/types.ts';

interface HeadContext {
	title?: string;
	description?: string;
	url?: string;
	type?: 'website' | 'article';
	image?: string;
	publishedAt?: string;
	siteName?: string;
	indexable?: boolean;
}

function normalizeHandle(value: string): string {
	const handle = value.trim().replace(/^@/, '');
	return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `@${handle}` : '';
}

function settingsPage(api: PluginApi): string {
	const twitterHandle = normalizeHandle(String(api.getOption('twitterHandle', '')));
	const jsonLdEnabled = Boolean(api.getOption('enableJsonLd', true));
	const handleStatus = twitterHandle ? 'شناسه ثبت شده' : 'شناسه‌ای تنظیم نشده';
	const structuredDataStatus = jsonLdEnabled ? 'فعال' : 'غیرفعال';

	return `<section class="card">
		<div class="card__head">
			<h2 class="card__title">وضعیت سئوی صفحات</h2>
		</div>
		<div class="card__body stack" style="gap:16px">
			<p class="hint">پوستهٔ سایت عنوان، توضیح و داده‌های پایهٔ Open Graph را می‌سازد. افزونهٔ فعال، نشانی canonical، کارت Twitter و دادهٔ ساختاریافته را تکمیل می‌کند. صفحه‌های noindex از این خروجی‌ها مستثنا هستند.</p>
			<dl class="dl">
				<div class="dl__row">
					<dt>نام کاربری Twitter</dt>
					<dd><span class="badge ${twitterHandle ? 'badge--success' : 'badge--neutral'}">${escapeHtml(handleStatus)}</span>${twitterHandle ? ` <code class="mono ltr" dir="ltr">${escapeHtml(twitterHandle)}</code>` : ''}</dd>
				</div>
				<div class="dl__row">
					<dt>دادهٔ ساختاریافته (JSON-LD)</dt>
					<dd><span class="badge ${jsonLdEnabled ? 'badge--success' : 'badge--neutral'}">${structuredDataStatus}</span></dd>
				</div>
			</dl>
			<a class="btn btn--sm btn--primary" href="/cms/plugins?plugin=seo-meta&amp;view=settings">ویرایش تنظیمات سئو</a>
		</div>
	</section>`;
}

export function register(api: PluginApi): void {
	api.addFilter('site.head', (value, context) => {
		const head = (context ?? {}) as HeadContext;
		if (head.indexable === false) return String(value ?? '');

		const url = head.url ?? '';
		const title = head.title ?? '';
		const description = head.description ?? '';
		const type = head.type ?? 'website';
		const image = head.image;
		const lines: string[] = [];

		if (url) lines.push(`<link rel="canonical" href="${escapeAttribute(url)}" />`);
		if (head.siteName) {
			lines.push(`<meta property="og:site_name" content="${escapeAttribute(head.siteName)}" />`);
		}
		lines.push(
			`<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
			`<meta name="twitter:title" content="${escapeAttribute(title)}" />`,
			`<meta name="twitter:description" content="${escapeAttribute(description)}" />`,
		);

		if (image) {
			lines.push(`<meta name="twitter:image" content="${escapeAttribute(image)}" />`);
		}

		const handle = normalizeHandle(String(api.getOption('twitterHandle', '')));
		if (handle) lines.push(`<meta name="twitter:site" content="${escapeAttribute(handle)}" />`);

		if (Boolean(api.getOption('enableJsonLd', true)) && url) {
			const schema =
				type === 'article'
					? {
							'@context': 'https://schema.org',
							'@type': 'BlogPosting',
							headline: title,
							description,
							url,
							datePublished: head.publishedAt,
							image,
						}
					: {
							'@context': 'https://schema.org',
							'@type': 'WebSite',
							name: head.siteName ?? title,
							url,
							description,
						};

			lines.push(`<script type="application/ld+json">${escapeJsonLd(schema)}</script>`);
		}

		return `${String(value ?? '')}\n\t\t${lines.join('\n\t\t')}\n`;
	});
}

export const pages = {
	async settings(api: PluginApi): Promise<string> {
		return settingsPage(api);
	},
};
