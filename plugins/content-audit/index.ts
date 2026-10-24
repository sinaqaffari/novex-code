/**
 * Plugin Name: بازبینی محتوا
 * Description: ویجت داشبورد و صفحهٔ اختصاصی برای پیدا کردن نوشته‌های ناقص.
 * Version:     1.0.0
 * Author:      تیم نووکس
 * License:     MIT
 * Text Domain: novex-content-audit
 *
 * نمونهٔ افزونهٔ سمت پنل با دو سطح رابط:
 *  - ویجت داشبورد از فیلتر `cms.dashboard.widgets`
 *  - صفحهٔ اختصاصی `/cms/plugins/content-audit/audit` از `admin.pages`
 *
 * داده را از API می‌گیرد (توانایی `content:read`) و HTML امن برمی‌گرداند؛
 * به فایل‌ها یا پایگاه‌داده دسترسی مستقیم ندارد.
 */

import { escapeHtml } from '../../src/lib/plugins/html';
import type { DashboardWidget, PluginApi, PluginPost } from '../../src/lib/plugins/types';

interface DashboardContext {
	posts?: PluginPost[];
}

interface AuditRow {
	post: PluginPost;
	missing: string[];
}

function clampItems(value: unknown, fallback: number): number {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(10, Math.max(1, parsed));
}

/** یک قاعدهٔ بازبینی برای ویجت و صفحه — تا هر دو یک چیز نشان دهند. */
function auditPosts(posts: PluginPost[], includeDrafts: boolean): AuditRow[] {
	return posts
		.filter((post) => includeDrafts || !post.draft)
		.map((post) => {
			const missing: string[] = [];
			if (!post.description.trim()) missing.push('توضیح');
			if (!post.tags.length) missing.push('برچسب');
			if (!post.heroImage) missing.push('تصویر');
			return { post, missing };
		})
		.filter((row) => row.missing.length > 0);
}

function widgetHtml(rows: AuditRow[]): string {
	if (!rows.length) {
		return '<p class="hint" style="padding:12px 16px">همهٔ نوشته‌ها کامل‌اند — توضیح، برچسب و تصویر دارند.</p>';
	}

	return `<ul class="list">${rows
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
		.join('')}</ul>`;
}

function pageHtml(rows: AuditRow[]): string {
	const body = rows.length
		? `<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th scope="col">نوشته</th>
							<th scope="col">وضعیت</th>
							<th scope="col">چیزهای کم</th>
							<th scope="col">ویرایش</th>
						</tr>
					</thead>
					<tbody>
						${rows
							.map(
								({ post, missing }) => `<tr>
									<td>${escapeHtml(post.title)}</td>
									<td>
										<span class="badge ${post.draft ? 'badge--warning' : 'badge--success'}">
											${post.draft ? 'پیش‌نویس' : 'منتشرشده'}
										</span>
									</td>
									<td>${missing.map((item) => `<span class="badge badge--neutral">${escapeHtml(item)}</span>`).join(' ')}</td>
									<td><a class="btn btn--sm btn--ghost" href="/cms/posts/${escapeHtml(post.id)}">ویرایش</a></td>
								</tr>`,
							)
							.join('')}
					</tbody>
				</table>
			</div>`
		: `<div class="empty" style="padding:32px">
				<span class="empty__title">هیچ نوشتهٔ ناقصی پیدا نشد.</span>
				<span class="hint">توضیح، برچسب و تصویر همهٔ نوشته‌ها کامل است.</span>
			</div>`;

	return `<section class="card">
		<div class="card__head">
			<h2 class="card__title">نوشته‌های ناقص</h2>
			<span class="badge badge--neutral">${rows.length} مورد</span>
		</div>
		${body}
	</section>
	<p class="hint" style="margin-top:12px">
		این صفحه را افزونهٔ «بازبینی محتوا» می‌سازد؛ نه پنل. برای برداشتنش کافی است افزونه
		غیرفعال شود.
	</p>`;
}

export function register(api: PluginApi): void {
	api.addFilter('cms.dashboard.widgets', (value, context) => {
		const widgets = Array.isArray(value) ? (value as DashboardWidget[]) : [];
		const posts = ((context ?? {}) as DashboardContext).posts ?? [];
		const includeDrafts = Boolean(api.getOption('includeDrafts', true));
		const maxItems = clampItems(api.getOption('maxItems', 5), 5);

		widgets.push({
			id: 'content-audit',
			title: 'بازبینی محتوا',
			html: widgetHtml(auditPosts(posts, includeDrafts).slice(0, maxItems)),
		});

		return widgets;
	});
}

/** کلیدها همان `path`هایی هستند که در plugin.json اعلام شده‌اند. */
export const pages = {
	async audit(api: PluginApi): Promise<string> {
		const includeDrafts = Boolean(api.getOption('includeDrafts', true));
		const posts = await api.getPosts();
		return pageHtml(auditPosts(posts, includeDrafts));
	},
};
