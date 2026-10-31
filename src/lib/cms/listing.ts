import type { PostSummary } from './posts.ts';

/** Match common Persian and Arabic letter variants without changing stored text. */
export function normalizeSearch(value: string): string {
	return value.toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064B-\u065F\u0670]/g, '').trim();
}

export type PostStatusFilter = 'all' | 'published' | 'draft';

export function filterPosts(posts: PostSummary[], options: { query?: string; tag?: string; status?: PostStatusFilter }): PostSummary[] {
	const needle = normalizeSearch(options.query ?? '');
	return posts.filter((post) => {
		if (options.tag && !post.tags.includes(options.tag)) return false;
		if (options.status === 'draft' && !post.draft) return false;
		if (options.status === 'published' && post.draft) return false;
		return !needle || normalizeSearch(`${post.title} ${post.description} ${post.slug} ${post.tags.join(' ')}`).includes(needle);
	});
}

export function paginate<T>(items: T[], page: number, perPage: number) {
	const size = Number.isSafeInteger(perPage) && perPage > 0 ? perPage : 20;
	const pages = Math.max(1, Math.ceil(items.length / size));
	const current = Number.isSafeInteger(page) ? Math.min(pages, Math.max(1, page)) : 1;
	return { items: items.slice((current - 1) * size, current * size), page: current, pages, perPage: size, total: items.length };
}
