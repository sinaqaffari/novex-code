import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { listPosts } from '../lib/cms/posts';
import { readSettings } from '../lib/cms/settings';

export const prerender = false;

/** فید RSS از همان فایل‌هایی خوانده می‌شود که پنل مدیریت می‌نویسد. */
export const GET: APIRoute = async (context) => {
	const settings = await readSettings();
	const posts = (await listPosts()).filter((post) => !post.draft && post.id.endsWith('.md'));

	return rss({
		title: settings.siteTitle,
		description: settings.siteDescription,
		site: context.site ?? 'https://example.com',
		items: posts.map((post) => ({
			title: post.title,
			description: post.description,
			pubDate: new Date(post.pubDate),
			link: `/blog/${post.slug}/`,
		})),
	});
};
