/**
 * Plugin Name: بازبینی محتوا
 * Description: ویجت داشبورد برای پیدا کردن نوشته‌های ناقص.
 * Version:     1.0.0
 * Author:      تیم نووکس
 * License:     MIT
 *
 * نمونهٔ افزونه‌ای که فقط سمت پنل کار می‌کند و از فیلتر ویجت‌های داشبورد
 * استفاده می‌کند. برای این کار به فایل‌ها دسترسی ندارد؛ داده را از context
 * می‌گیرد و HTML امن برمی‌گرداند.
 */

import { escapeHtml } from '../../src/lib/plugins/html';
import type { DashboardWidget, PluginApi } from '../../src/lib/plugins/types';

interface PostLike {
	id: string;
	title: string;
	description: string;
	tags: string[];
	heroImage: string;
	draft: boolean;
}

interface DashboardContext {
	posts?: PostLike[];
}

function clampItems(value: unknown, fallback: number): number {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(10, Math.max(1, parsed));
}

export function register(api: PluginApi): void {
	api.addFilter('cms.dashboard.widgets', (value, context) => {
		const widgets = Array.isArray(value) ? (value as DashboardWidget[]) : [];
		const posts = ((context ?? {}) as DashboardContext).posts ?? [];
		const includeDrafts = Boolean(api.getOption('includeDrafts', true));
		const maxItems = clampItems(api.getOption('maxItems', '5'), 5);

		const incomplete = posts
			.filter((post) => includeDrafts || !post.draft)
			.map((post) => {
				const missing: string[] = [];
				if (!post.description.trim()) missing.push('توضیح');
				if (!post.tags.length) missing.push('برچسب');
				if (!post.heroImage) missing.push('تصویر');
				return { post, missing };
			})
			.filter((item) => item.missing.length > 0)
			.slice(0, maxItems);

		const body = incomplete.length
			? `<ul class="list">${incomplete
					.map(
						({ post, missing }) => `<li>
					<a class="list__row" href="/cms/posts/${escapeHtml(post.id)}">
						<span class="list__main">
							<span class="list__title">${escapeHtml(post.title)}</span>
							<span class="list__meta">بدون ${escapeHtml(missing.join('، '))}</span>
						</span>
						<span class="badge badge--warning">${missing.length}</span>
					</a>
				</li>`,
					)
					.join('')}</ul>`
			: '<p class="hint" style="padding:12px 16px">همهٔ نوشته‌ها کامل‌اند — توضیح، برچسب و تصویر دارند.</p>';

		widgets.push({
			id: 'content-audit',
			title: 'بازبینی محتوا',
			html: body,
		});

		return widgets;
	});
}
