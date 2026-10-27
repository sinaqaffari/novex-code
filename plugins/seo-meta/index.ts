/**
 * Plugin Name: سئوی صفحات عمومی
 * Description: کنونیکال، Open Graph و JSON-LD برای صفحه‌های عمومی.
 * Version:     1.0.0
 * Author:      تیم نووکس
 * License:     MIT
 *
 * این افزونه نمونهٔ مرجع قرارداد است: فقط از API استفاده می‌کند، به فایل‌ها
 * دست نمی‌زند و همهٔ خروجی‌اش از فیلتر `site.head` می‌آید.
 */

import { escapeAttribute, escapeJsonLd } from '../../src/lib/plugins/html';
import type { PluginApi } from '../../src/lib/plugins/types';

interface HeadContext {
	title?: string;
	description?: string;
	url?: string;
	type?: 'website' | 'article';
	image?: string;
	publishedAt?: string;
	siteName?: string;
}

function normalizeHandle(value: string): string {
	const handle = value.trim();
	if (!handle) return '';
	return handle.startsWith('@') ? handle : `@${handle}`;
}

export function register(api: PluginApi): void {
	api.addFilter('site.head', (value, context) => {
		const head = (context ?? {}) as HeadContext;
		const url = head.url ?? '';
		const title = head.title ?? '';
		const description = head.description ?? '';
		const type = head.type ?? 'website';
		const handle = normalizeHandle(String(api.getOption('twitterHandle', '')));

		const lines: string[] = [
			`<link rel="canonical" href="${escapeAttribute(url)}" />`,
			`<meta property="og:site_name" content="${escapeAttribute(head.siteName ?? '')}" />`,
			`<meta property="og:type" content="${escapeAttribute(type)}" />`,
			`<meta property="og:title" content="${escapeAttribute(title)}" />`,
			`<meta property="og:description" content="${escapeAttribute(description)}" />`,
			`<meta property="og:url" content="${escapeAttribute(url)}" />`,
			`<meta name="twitter:card" content="${head.image ? 'summary_large_image' : 'summary'}" />`,
			`<meta name="twitter:title" content="${escapeAttribute(title)}" />`,
			`<meta name="twitter:description" content="${escapeAttribute(description)}" />`,
		];

		if (head.image) {
			lines.push(
				`<meta property="og:image" content="${escapeAttribute(head.image)}" />`,
				`<meta name="twitter:image" content="${escapeAttribute(head.image)}" />`,
			);
		}

		if (handle) lines.push(`<meta name="twitter:site" content="${escapeAttribute(handle)}" />`);

		if (type === 'article' && head.publishedAt) {
			lines.push(
				`<meta property="article:published_time" content="${escapeAttribute(head.publishedAt)}" />`,
			);
		}

		if (api.getOption('enableJsonLd', true)) {
			const schema =
				type === 'article'
					? {
							'@context': 'https://schema.org',
							'@type': 'BlogPosting',
							headline: title,
							description,
							url,
							datePublished: head.publishedAt,
							image: head.image,
						}
					: {
							'@context': 'https://schema.org',
							'@type': 'WebSite',
							name: head.siteName ?? title,
							url,
							description,
						};

			lines.push(
				`<script type="application/ld+json">${escapeJsonLd(schema)}</script>`,
			);
		}

		return `${String(value ?? '')}\n\t\t${lines.join('\n\t\t')}\n`;
	});
}
