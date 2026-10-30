import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import sharp from 'sharp';
import { ZipFile } from 'yazl';

const root = await mkdtemp(path.join(os.tmpdir(), 'novex-wordpress-post-archive-'));
const old = { blog: process.env.CMS_BLOG_DIR, assets: process.env.CMS_ASSETS_DIR, builder: process.env.BUILDER_DATA_FILE };
process.env.CMS_BLOG_DIR = path.join(root, 'blog');
process.env.CMS_ASSETS_DIR = path.join(root, 'assets');
process.env.BUILDER_DATA_FILE = path.join(root, 'builder.json');
await mkdir(process.env.CMS_BLOG_DIR, { recursive: true });
const { POST } = await import('../src/pages/cms/api/builder/imports/wordpress-archive.ts');
const { createPost, deletePost, getPostDraft } = await import('../src/lib/cms/posts.ts');
const { deleteUpload, UPLOAD_DIR } = await import('../src/lib/cms/media.ts');
after(async () => {
	for (const [key, value] of [['CMS_BLOG_DIR', old.blog], ['CMS_ASSETS_DIR', old.assets], ['BUILDER_DATA_FILE', old.builder]] as const) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	await rm(root, { recursive: true, force: true });
});

async function pixels() { return sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer(); }
async function archive(image: Buffer, pageImage: Buffer): Promise<Buffer> {
	const url = 'http://127.0.0.1/wp-content/uploads/2024/blog.png';
	const html = `<p>Blog content</p><img class="wp-image-42" src="${url}" alt="Local picture">`;
	const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Blog post</title><wp:post_type>post</wp:post_type><excerpt:encoded>Summary</excerpt:encoded><content:encoded><![CDATA[${html}]]></content:encoded></item><item><title>Page</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[<img src="http://127.0.0.1/wp-content/uploads/2024/page.png">]]></content:encoded></item><item><wp:post_type>attachment</wp:post_type><wp:post_id>42</wp:post_id><wp:attachment_url>${url}</wp:attachment_url><wp:postmeta><wp:meta_key>_wp_attached_file</wp:meta_key><wp:meta_value>2024/blog.png</wp:meta_value></wp:postmeta></item></channel></rss>`;
	const zip = new ZipFile(); const chunks: Buffer[] = [];
	const ready = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); });
	zip.addBuffer(Buffer.from(xml), 'wordpress.xml'); zip.addBuffer(image, 'wp-content/uploads/2024/blog.png'); zip.addBuffer(pageImage, 'wp-content/uploads/2024/page.png'); zip.end();
	return ready;
}
function request(bytes: Buffer, action: 'inspect' | 'install-posts', prefix = 'archive-blog', confirm = true, preferElementor = false) {
	const form = new FormData(); form.set('archive', new File([new Uint8Array(bytes)], 'wordpress.zip', { type: 'application/zip' })); form.set('action', action);
	if (action === 'install-posts') { form.set('prefix', prefix); form.set('preferElementor', String(preferElementor)); if (confirm) form.set('confirm', 'true'); }
	return new Request('http://local/cms/api/builder/imports/wordpress-archive', { method: 'POST', body: form });
}
const conflict = (error: unknown) => error instanceof Error && 'status' in error && error.status === 409;

describe('WordPress ZIP import into real CMS posts', () => {
	it('inspects without writing and installs only used local assets into unpublished blog drafts', async () => {
		const image = await pixels(); const pageImage = await pixels(); const bytes = await archive(image, pageImage);
		const call = (role: string, action: 'inspect' | 'install-posts', confirm = true, prefer = false) => POST({ locals: { cmsUser: { role } }, request: request(bytes, action, 'archive-blog', confirm, prefer) } as never);
		assert.equal((await call('subscriber', 'inspect')).status, 403);
		const inspection = await call('contributor', 'inspect'); assert.equal(inspection.status, 200);
		const summary = (await inspection.json()).summary;
		assert.equal(summary.assetCount, 2); assert.equal(summary.postAssetCount, 1);
		assert.ok(summary.items[0].blogWarnings.some((warning: string) => warning.includes('نگاشت‌شده')));
		await assert.rejects(stat(UPLOAD_DIR), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		assert.equal((await call('editor', 'install-posts', false)).status, 400);
		assert.equal((await call('editor', 'install-posts', true, true)).status, 400);
		assert.equal((await call('contributor', 'install-posts')).status, 403);
		const response = await call('editor', 'install-posts'); assert.equal(response.status, 201);
		const result = await response.json();
		assert.deepEqual(result.posts, [{ id: 'archive-blog-1.md' }]); assert.equal(result.uploaded, 1);
		const name = `kit-${createHash('sha256').update(image).digest('hex')}.png`;
		assert.deepEqual(result.createdUploads, [name]);
		const post = await getPostDraft('archive-blog-1.md'); assert.equal(post.draft, true);
		assert.match(post.body, new RegExp(`/media/uploads/${name}`)); assert.doesNotMatch(post.body, /127\\.0\\.0\\.1/);
		assert.ok(!(await readdir(UPLOAD_DIR)).includes(`kit-${createHash('sha256').update(pageImage).digest('hex')}.png`));
		await assert.rejects(deleteUpload(name), conflict);
		await deletePost('archive-blog-1.md'); await deleteUpload(name);
	});
	it('rolls back newly imported images after a post-slug collision', async () => {
		await createPost({ title: 'Existing', description: 'Summary', slug: 'collision-1', pubDate: '2024-01-01', draft: true, body: 'Original' });
		const image = await pixels(); const pageImage = await pixels(); const bytes = await archive(image, pageImage);
		const response = await POST({ locals: { cmsUser: { role: 'editor' } }, request: request(bytes, 'install-posts', 'collision') } as never);
		assert.ok(response.status >= 400);
		assert.equal((await getPostDraft('collision-1.md')).body, 'Original');
		const name = `kit-${createHash('sha256').update(image).digest('hex')}.png`;
		await assert.rejects(stat(path.join(UPLOAD_DIR, name)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		assert.ok(!(await readdir(process.env.CMS_BLOG_DIR!)).some((item) => item.startsWith('.post-batch-')));
	});
});
