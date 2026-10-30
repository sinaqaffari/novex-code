import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { decodeHTML } from 'entities';
import { marked } from 'marked';
import { AppError } from '../errors.ts';
import { parseBuilderMediaReference } from '../builder/media-reference.ts';

const MAX_POST_BYTES = 4 * 1024 * 1024;
const MAX_SCAN_BYTES = 64 * 1024 * 1024;
const MAX_POSTS = 5000;
const UPLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:avif|gif|jpe?g|png|webp|svg)$/i;

function validName(name: string): boolean {
	return UPLOAD_NAME.test(name) && !name.includes('..');
}

/** Decode representations that Markdown, HTML attributes, and a browser may
 * use for the same literal path. No remote URL is fetched. */
function decodeReference(value: string): string {
	let decoded = decodeHTML(value).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
	for (let attempt = 0; attempt < 2; attempt++) {
		const next = decoded.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
			try { return decodeURIComponent(encoded); } catch { return encoded; }
		});
		if (next === decoded) break;
		decoded = next;
	}
	return decoded;
}

/** Canonical and request origins are explicit; arbitrary remote hosts remain
 * external and are never fetched. Multiple deployments/aliases should include
 * each public origin in the caller's list. */
function localOrigins(origins: readonly string[]): Set<string> {
	const result = new Set<string>();
	for (const value of [...origins, process.env.SITE_URL ?? '']) {
		try {
			const url = new URL(value);
			if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) result.add(url.origin);
		} catch { /* An invalid configured origin cannot identify a local URL. */ }
	}
	return result;
}

/** Identify managed local upload URLs and legacy CMS hero-image references. */
export function postUploadName(value: string, origins: readonly string[] = []): string | null {
	const source = decodeReference(value.trim());
	const builder = parseBuilderMediaReference(source);
	if (builder?.bucket === 'uploads') return builder.name;
	if (!source) return null;
	if (source.startsWith('//')) {
		for (const origin of localOrigins(origins)) {
			try {
				const url = new URL(source, origin);
				if (!url.username && !url.password && localOrigins(origins).has(url.origin)) return postUploadName(`${url.pathname}${url.search}${url.hash}`);
			} catch { /* Ignore malformed protocol-relative URLs. */ }
		}
		return null;
	}
	if (/^[a-z][a-z\d+.-]*:/i.test(source)) {
		try {
			const url = new URL(source);
			if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || !localOrigins(origins).has(url.origin)) return null;
			return postUploadName(`${url.pathname}${url.search}${url.hash}`);
		} catch { return null; }
	}
	const legacy = /(?:^|\/)assets\/uploads\/([^/?#]+)(?:[?#].*)?$/.exec(source);
	if (legacy && !source.startsWith('/') && validName(legacy[1])) return legacy[1];
	try {
		// The public article route has one slug segment, so relative links have
		// the same base regardless of the individual post slug.
		const url = new URL(source, 'https://novex.invalid/blog/post');
		const match = /^\/(?:media\/uploads|cms\/media\/file\/uploads)\/([^/]+)$/.exec(url.pathname);
		const name = match ? decodeURIComponent(match[1]) : '';
		return validName(name) ? name : null;
	} catch { return null; }
}

/** Extract actual Markdown image/link destinations, including reference-style
 * links, plus the CMS hero field. Raw HTML in Markdown is escaped by the
 * public renderer; the deletion scanner is additionally conservative. */
export function postUploadReferences(heroImage: string, body: string, origins: readonly string[] = []): Set<string> {
	if (Buffer.byteLength(body, 'utf8') > MAX_POST_BYTES) throw new AppError('متن نوشته برای بررسی رسانه بیش از حد مجاز است.', 'body', 413);
	const names = new Set<string>();
	const add = (value: string) => { const name = postUploadName(value, origins); if (name) names.add(name); };
	add(heroImage);
	try {
		const tokens = marked.lexer(body, { gfm: true, breaks: false });
		marked.walkTokens(tokens, (token) => {
			if (token.type === 'image' || token.type === 'link' || token.type === 'def') add(token.href);
		});
	} catch {
		throw new AppError('بررسی رسانه‌های متن نوشته ممکن نشد؛ تغییری انجام نشد.', 'body', 422);
	}
	return names;
}

/** Called only while the shared Builder/media/post filesystem lock is held.
 * Previously missing legacy references may remain editable; newly introduced
 * references must point to existing regular uploads. */
export async function assertPostUploadsExist(uploadDir: string, heroImage: string, body: string, previous?: { heroImage: string; body: string }, origins: readonly string[] = []): Promise<void> {
	const prior = previous ? postUploadReferences(previous.heroImage, previous.body, origins) : new Set<string>();
	for (const name of postUploadReferences(heroImage, body, origins)) {
		if (prior.has(name)) continue;
		try {
			const info = await lstat(path.join(uploadDir, name));
			if (info.isFile() && !info.isSymbolicLink()) continue;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError('بررسی فایل رسانه ممکن نشد؛ نوشته ذخیره نشد.', 'body', 503);
		}
		throw new AppError('یکی از رسانه‌های محلی نوشته پیدا نشد؛ پیش از ذخیره دوباره آن را انتخاب کنید.', 'body', 409);
	}
}

/** Called under the same lock as post writes and media deletion. The scan is
 * deliberately conservative: any literal filename in a post protects it,
 * even when it is a link or an unfamiliar representation. Executable MDX
 * cannot be completely analyzed without executing it, so deletion fails
 * closed while any MDX post is present. */
export async function assertBlogUploadUnused(blogDir: string, name: string): Promise<void> {
	if (!validName(name)) throw new AppError('نام فایل معتبر نیست.', 'file', 400);
	let entries;
	try { entries = await readdir(blogDir, { withFileTypes: true }); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw new AppError('بررسی نوشته‌ها ممکن نشد؛ رسانه حذف نشد.', 'file', 503);
	}
	const posts = entries.filter((entry) => !entry.name.startsWith('.') && /\.(?:md|mdx)$/i.test(entry.name));
	if (posts.length > MAX_POSTS) throw new AppError('تعداد نوشته‌ها برای بررسی رسانه بیش از حد مجاز است؛ حذف انجام نشد.', 'file', 503);
	let total = 0;
	for (const entry of posts) {
		if (!entry.isFile() || /\.mdx$/i.test(entry.name)) {
			throw new AppError('بررسی ایمن نوشتهٔ MDX یا پیوند فایل ممکن نیست؛ رسانه حذف نشد.', 'file', 409);
		}
		let source: string;
		try {
			const absolute = path.join(blogDir, entry.name);
			const info = await lstat(absolute);
			if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_POST_BYTES || (total += info.size) > MAX_SCAN_BYTES) {
				throw new Error('unsafe blog scan');
			}
			source = await readFile(absolute, 'utf8');
		} catch {
			throw new AppError('بررسی ایمن نوشته‌ها ممکن نشد؛ رسانه حذف نشد.', 'file', 503);
		}
		if (decodeReference(source).includes(name)) {
			throw new AppError('این رسانه در یک نوشتهٔ مجله استفاده شده است و حذف نمی‌شود.', 'file', 409);
		}
	}
}
