/**
 * Filesystem-backed blog store for the CMS.
 *
 * Posts stay plain Markdown/MDX files inside `src/content/blog` — the CMS is a
 * front-end for the same content the site already builds from, so nothing has
 * to be migrated to a database.
 */

import { link, mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AppError as CmsError } from '../errors.ts';
import { canEditPost, type Role } from './rbac.ts';
import { assertPostUploadsExist } from './blog-media.ts';
import { commitPostBatchUnderLock, recoverPostBatchesUnderLock } from './post-batch.ts';
import {
	asString,
	type Frontmatter,
	parseFrontmatter,
	parseTags,
	serializeFrontmatter,
} from './frontmatter.ts';

export { CmsError };

export const BLOG_DIR = path.resolve(process.env.CMS_BLOG_DIR || path.join(process.cwd(), 'src/content/blog'));

const FRONTMATTER_ORDER = [
	'title',
	'description',
	'pubDate',
	'updatedDate',
	'heroImage',
	'tags',
	'draft',
];

export interface PostSummary {
	id: string;
	title: string;
	description: string;
	slug: string;
	pubDate: string;
	updatedDate?: string;
	heroImage: string;
	tags: string[];
	draft: boolean;
	words: number;
	readingMinutes: number;
	bytes: number;
	modifiedAt: string;
}

export interface PostDraft {
	title: string;
	description: string;
	slug: string;
	pubDate: string;
	updatedDate: string;
	heroImage: string;
	tags: string[];
	draft: boolean;
	body: string;
}

export type PostInput = Partial<
	Omit<PostDraft, 'tags' | 'slug' | 'body' | 'updatedDate'>
> & {
	body?: string;
	slug?: string;
	/** Accepts the comma separated string a form sends, or an array. */
	tags?: string | string[];
};



const persianDigits = /[\u06F0-\u06F9]/g;
const arabicDigits = /[\u0660-\u0669]/g;

/** Normalise Persian/Arabic digits and Arabic letter variants for slugging. */
function normalizeDigits(input: string): string {
	return input
		.replace(persianDigits, (digit) => String(digit.charCodeAt(0) - 0x06f0))
		.replace(arabicDigits, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

export function countWords(text: string): number {
	const cleaned = text
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[#>*_~`|\-]/g, ' ');
	return cleaned.split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(words: number): number {
	return Math.max(1, Math.round(words / 200));
}

/**
 * Latin transliteration for Persian titles, so an empty slug field still
 * yields a readable, ASCII-only URL (`/blog/taypwgrafty-farsy`).
 */
const TRANSLITERATION: Record<string, string> = {
	آ: 'a',
	ا: 'a',
	أ: 'a',
	إ: 'e',
	ب: 'b',
	پ: 'p',
	ت: 't',
	ث: 's',
	ج: 'j',
	چ: 'ch',
	ح: 'h',
	خ: 'kh',
	د: 'd',
	ذ: 'z',
	ر: 'r',
	ز: 'z',
	ژ: 'zh',
	س: 's',
	ش: 'sh',
	ص: 's',
	ض: 'z',
	ط: 't',
	ظ: 'z',
	ع: 'a',
	غ: 'gh',
	ف: 'f',
	ق: 'gh',
	ک: 'k',
	ك: 'k',
	گ: 'g',
	ل: 'l',
	م: 'm',
	ن: 'n',
	و: 'v',
	ؤ: 'o',
	ه: 'h',
	ة: 'h',
	ی: 'y',
	ي: 'y',
	ى: 'y',
	ئ: 'y',
	ء: '',
};

function transliterate(input: string): string {
	return normalizeDigits(input)
		.replace(/[\u064B-\u0652\u0670\u06D6-\u06ED]/g, '')
		.replace(/\u200c/g, '-')
		.replace(/[\u0600-\u06FF]/g, (character) => TRANSLITERATION[character] ?? '-');
}

/** URL-safe slug, derived from the title when none is provided. */
export function slugify(input: string, fallbackSeed = Date.now()): string {
	const full = transliterate(input)
		.toLowerCase()
		.replace(/['"’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	if (!full) return `post-${fallbackSeed.toString(36)}`;
	if (full.length <= 60) return full;

	// Cut long titles at a word boundary instead of mid-word.
	return full.slice(0, 60).replace(/-[^-]*$/, '').replace(/-+$/g, '') || full.slice(0, 60);
}

export function isValidSlug(slug: string): boolean {
	return /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(slug) && slug.length <= 120;
}

function toIsoDate(value: string): string {
	const raw = value.trim();
	// `<input type="date">` gives us a bare day; anchor it at noon UTC so the
	// Jalali date never slips a day for readers in other timezones.
	const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00.000Z` : raw;
	const date = new Date(normalized);
	if (Number.isNaN(date.valueOf())) {
		throw new CmsError('تاریخ انتشار معتبر نیست.', 'pubDate');
	}
	return date.toISOString();
}

function summarize(id: string, raw: string, modifiedAt: Date, size: number): PostSummary {
	const { data, body } = parseFrontmatter(raw);
	const words = countWords(body);
	return {
		id,
		title: asString(data.title, 'بدون عنوان'),
		description: asString(data.description),
		slug: id.replace(/\.(md|mdx)$/i, ''),
		pubDate: asString(data.pubDate),
		updatedDate: asString(data.updatedDate) || undefined,
		heroImage: asString(data.heroImage),
		tags: Array.isArray(data.tags) ? data.tags : parseTags(asString(data.tags)),
		draft: data.draft === true || data.draft === 'true',
		words,
		readingMinutes: readingMinutes(words),
		bytes: size,
		modifiedAt: modifiedAt.toISOString(),
	};
}

function isPostFile(name: string): boolean {
	return /\.(md|mdx)$/i.test(name) && !name.startsWith('.');
}

function resolvePostPath(id: string): string {
	let decoded: string;
	try { decoded = decodeURIComponent(id); } catch { throw new CmsError('شناسهٔ نوشته معتبر نیست.', undefined, 400); }
	if (!isPostFile(decoded) || decoded.includes('/') || decoded.includes('\\')) {
		throw new CmsError('شناسهٔ نوشته معتبر نیست.', undefined, 400);
	}
	return path.join(BLOG_DIR, decoded);
}

async function listPostsUnlocked(): Promise<PostSummary[]> {
	await mkdir(BLOG_DIR, { recursive: true });
	const entries = await readdir(BLOG_DIR, { withFileTypes: true });
	const files = entries.filter((entry) => entry.isFile() && isPostFile(entry.name));

	const posts = await Promise.all(
		files.map(async (entry) => {
			const filePath = path.join(BLOG_DIR, entry.name);
			const [raw, info] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
			return summarize(entry.name, raw, info.mtime, info.size);
		}),
	);

	return posts.sort((a, b) => {
		const aTime = new Date(a.pubDate).valueOf() || 0;
		const bTime = new Date(b.pubDate).valueOf() || 0;
		return bTime - aTime;
	});
}

export async function listPosts(): Promise<PostSummary[]> {
	return withPostWriteLock(listPostsUnlocked);
}

async function getPostDraftUnlocked(id: string): Promise<PostDraft & { raw: string; id: string }> {
	const filePath = resolvePostPath(id);
	let raw: string;
	try {
		raw = await readFile(filePath, 'utf8');
	} catch {
		throw new CmsError('نوشتهٔ مورد نظر پیدا نشد.', undefined, 404);
	}

	const { data, body } = parseFrontmatter(raw);
	const canonicalId = path.basename(filePath);
	return {
		id: canonicalId,
		title: asString(data.title),
		description: asString(data.description),
		slug: canonicalId.replace(/\.(md|mdx)$/i, ''),
		pubDate: asString(data.pubDate),
		updatedDate: asString(data.updatedDate),
		heroImage: asString(data.heroImage),
		tags: Array.isArray(data.tags) ? data.tags : parseTags(asString(data.tags)),
		draft: data.draft === true || data.draft === 'true',
		body,
		raw,
	};
}

export async function getPostDraft(id: string): Promise<PostDraft & { raw: string; id: string }> {
	return withPostWriteLock(() => getPostDraftUnlocked(id));
}

async function assertSlugAvailable(slug: string, currentId?: string): Promise<void> {
	const entries = await readdir(BLOG_DIR, { withFileTypes: true });
	const taken = entries.some(
		(entry) =>
			entry.isFile() &&
			isPostFile(entry.name) &&
			entry.name.replace(/\.(md|mdx)$/i, '') === slug &&
			entry.name !== currentId,
	);
	if (taken) {
		throw new CmsError('این نامک قبلاً استفاده شده است. نام دیگری انتخاب کنید.', 'slug');
	}
}

function buildFile(previousRaw: string | null, draft: PostDraft): string {
	const previous = previousRaw ? parseFrontmatter(previousRaw).data : {};
	const data: Frontmatter = { ...previous };

	data.title = draft.title.trim();
	data.description = draft.description.trim();
	data.pubDate = toIsoDate(draft.pubDate);
	if (draft.updatedDate.trim()) data.updatedDate = toIsoDate(draft.updatedDate);
	else delete data.updatedDate;

	if (draft.heroImage.trim()) data.heroImage = draft.heroImage.trim();
	else delete data.heroImage;

	if (draft.tags.length) data.tags = draft.tags;
	else delete data.tags;

	if (draft.draft) data.draft = true;
	else delete data.draft;

	return serializeFrontmatter(data, draft.body, FRONTMATTER_ORDER);
}

function validate(draft: PostDraft): void {
	if (!draft.title.trim()) throw new CmsError('عنوان نوشته الزامی است.', 'title');
	if (draft.title.trim().length > 200) {
		throw new CmsError('عنوان نباید بیشتر از ۲۰۰ نویسه باشد.', 'title');
	}
	if (!draft.description.trim()) {
		throw new CmsError('خلاصهٔ نوشته الزامی است.', 'description');
	}
	if (!draft.pubDate.trim()) throw new CmsError('تاریخ انتشار الزامی است.', 'pubDate');
	if (!isValidSlug(draft.slug)) {
		throw new CmsError('نامک فقط می‌تواند شامل حروف، ارقام و خط تیره باشد.', 'slug');
	}
}

/** CMS post reads and writes share the filesystem lock with Builder media.
 * Recovery and slug checks are serialized across both .md and .mdx files. */
async function withPostWriteLock<T>(operation: () => Promise<T>): Promise<T> {
	const { BuilderStoreError, withBuilderAssetLock } = await import('../builder/store.ts');
	try { return await withBuilderAssetLock(async () => { await recoverPostBatchesUnderLock(BLOG_DIR); return operation(); }); }
	catch (error) {
		if (error instanceof BuilderStoreError) throw new CmsError(error.message, undefined, error.status);
		throw error;
	}
}

/** Stage complete content before publishing a filename. New names use an
 * exclusive hard link; same-name updates atomically replace the old file. */
async function writeStagedPost(id: string, contents: string, replace: boolean): Promise<void> {
	const temporary = path.join(BLOG_DIR, `.post-${randomUUID()}.tmp`);
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	let owned = false;
	try {
		handle = await open(temporary, 'wx', 0o600); owned = true;
		await handle.writeFile(contents, 'utf8');
		await handle.close(); handle = undefined;
		if (replace) await rename(temporary, path.join(BLOG_DIR, id));
		else {
			try { await link(temporary, path.join(BLOG_DIR, id)); }
			catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new CmsError('این نامک قبلاً استفاده شده است. نام دیگری انتخاب کنید.', 'slug', 409);
				throw error;
			}
		}
	} finally {
		if (handle) await handle.close().catch(() => undefined);
		if (owned) await unlink(temporary).catch(() => undefined);
	}
}

function newPostDraft(input: PostInput): PostDraft {
	const title = (input.title ?? '').toString();
	const slug = slugify(
		(input.slug || title || 'post').toString(),
		Date.now(),
	);
	const draft: PostDraft = {
		title,
		description: (input.description ?? '').toString(),
		slug,
		pubDate: toIsoDate((input.pubDate as string) || new Date().toISOString()),
		updatedDate: '',
		heroImage: (input.heroImage ?? '').toString(),
		tags: parseTags(input.tags ?? []),
		draft: input.draft === true,
		body: (input.body ?? '').toString(),
	};

	validate(draft);
	return draft;
}

/** Create a post and return its file name. */
export async function createPost(input: PostInput, options?: { origins?: readonly string[] }): Promise<string> {
	await mkdir(BLOG_DIR, { recursive: true });
	const draft = newPostDraft(input);
	return withPostWriteLock(async () => {
		await assertSlugAvailable(draft.slug);
		const { UPLOAD_DIR } = await import('./media.ts');
		await assertPostUploadsExist(UPLOAD_DIR, draft.heroImage, draft.body, undefined, options?.origins);
		const id = `${draft.slug}.md`;
		await writeStagedPost(id, buildFile(null, draft), false);
		return id;
	});
}

/** Create a bounded collection of drafts as one recoverable filesystem batch.
 * Validation and media checks happen before any public filename is linked. */
export async function createDraftPostBatch(inputs: PostInput[], options?: { origins?: readonly string[] }): Promise<string[]> {
	if (!Array.isArray(inputs) || !inputs.length || inputs.length > 20 || inputs.some((input) => input.draft !== true)) throw new CmsError('بین ۱ تا ۲۰ نوشتهٔ پیش‌نویس لازم است.', 'draft', 422);
	await mkdir(BLOG_DIR, { recursive: true });
	const drafts = inputs.map(newPostDraft);
	if (new Set(drafts.map((draft) => draft.slug)).size !== drafts.length) throw new CmsError('نامک‌های نوشته‌ها باید یکتا باشند.', 'slug', 409);
	return withPostWriteLock(async () => {
		const { UPLOAD_DIR } = await import('./media.ts');
		for (const draft of drafts) {
			await assertSlugAvailable(draft.slug);
			await assertPostUploadsExist(UPLOAD_DIR, draft.heroImage, draft.body, undefined, options?.origins);
		}
		return commitPostBatchUnderLock(BLOG_DIR, drafts.map((draft) => ({ id: `${draft.slug}.md`, contents: buildFile(null, draft) })));
	});
}

/** Update a post. When the slug changes the file is renamed and the old one removed. */
export async function updatePost(id: string, input: PostInput, options?: { role: Role; origins?: readonly string[] }): Promise<string> {
	return withPostWriteLock(async () => {
		const current = await getPostDraftUnlocked(id);
		if (options && !canEditPost(options.role, current.draft, input.draft ?? current.draft)) {
			throw new CmsError('برای ویرایش نوشتهٔ منتشرشده یا تغییر وضعیت انتشار، مجوز ویراستار لازم است.', 'draft', 403);
		}
		const requestedSlug = (input.slug ?? current.slug).toString().trim() || current.slug;
		// Keep an existing slug untouched, but repair anything a keyboard produced
		// that cannot live in a URL (spaces, punctuation, Persian punctuation).
		const nextSlug = isValidSlug(requestedSlug)
			? requestedSlug
			: slugify(requestedSlug, Date.now());

		const draft: PostDraft = {
			title: (input.title ?? current.title).toString(),
			description: (input.description ?? current.description).toString(),
			slug: nextSlug,
			pubDate: (input.pubDate ?? current.pubDate).toString(),
			updatedDate: current.updatedDate,
			heroImage: (input.heroImage ?? current.heroImage).toString(),
			tags: input.tags === undefined ? current.tags : parseTags(input.tags),
			draft: input.draft === undefined ? current.draft : input.draft === true,
			body: (input.body ?? current.body).toString(),
		};

		validate(draft);
		if (draft.slug !== current.slug) await assertSlugAvailable(draft.slug, current.id);
		const { UPLOAD_DIR } = await import('./media.ts');
		await assertPostUploadsExist(UPLOAD_DIR, draft.heroImage, draft.body, current, options?.origins);

		const isMdx = current.id.toLowerCase().endsWith('.mdx');
		const nextId = `${draft.slug}${isMdx ? '.mdx' : '.md'}`;
		const contents = buildFile(current.raw, draft);

		if (nextId !== current.id) {
			await writeStagedPost(nextId, contents, false);
			await unlink(resolvePostPath(current.id));
		} else await writeStagedPost(nextId, contents, true);
		return nextId;
	});
}

export async function deletePost(id: string): Promise<void> {
	return withPostWriteLock(async () => {
		const filePath = resolvePostPath(id);
		try {
			await unlink(filePath);
		} catch {
			throw new CmsError('نوشتهٔ مورد نظر پیدا نشد.', undefined, 404);
		}
	});
}

export async function duplicatePost(id: string, options?: { origins?: readonly string[] }): Promise<string> {
	return withPostWriteLock(async () => {
		const current = await getPostDraftUnlocked(id);
		const timestamp = Date.now();
		const draft: PostDraft = {
			...current,
			title: `${current.title} — رونوشت`,
			slug: `${current.slug}-copy-${timestamp.toString(36)}`,
			pubDate: new Date().toISOString(),
			updatedDate: '',
			draft: true,
		};
		const nextId = `${draft.slug}.md`;
		await assertSlugAvailable(draft.slug);
		const { UPLOAD_DIR } = await import('./media.ts');
		await assertPostUploadsExist(UPLOAD_DIR, draft.heroImage, draft.body, undefined, options?.origins);
		await writeStagedPost(nextId, buildFile(null, draft), false);
		return nextId;
	});
}

export interface BlogStats {
	total: number;
	published: number;
	drafts: number;
	words: number;
	tags: Array<{ name: string; count: number }>;
	latest?: PostSummary;
}

export function buildStats(posts: PostSummary[]): BlogStats {
	const tagCounts = new Map<string, number>();
	for (const post of posts) {
		for (const tag of post.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
	}

	return {
		total: posts.length,
		published: posts.filter((post) => !post.draft).length,
		drafts: posts.filter((post) => post.draft).length,
		words: posts.reduce((sum, post) => sum + post.words, 0),
		tags: [...tagCounts.entries()]
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 12),
		latest: posts[0],
	};
}
