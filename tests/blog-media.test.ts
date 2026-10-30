import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { assertBlogUploadUnused, postUploadName, postUploadReferences } from '../src/lib/cms/blog-media.ts';
import { publicImageSrc } from '../src/lib/cms/public-image.ts';

// This process has a completely private blog, Builder store, and asset tree.
const root = await mkdtemp(path.join(os.tmpdir(), 'novex-blog-media-'));
const old = { blog: process.env.CMS_BLOG_DIR, assets: process.env.CMS_ASSETS_DIR, builder: process.env.BUILDER_DATA_FILE };
process.env.CMS_BLOG_DIR = path.join(root, 'blog');
process.env.CMS_ASSETS_DIR = path.join(root, 'assets');
process.env.BUILDER_DATA_FILE = path.join(root, 'builder.json');
await mkdir(process.env.CMS_BLOG_DIR, { recursive: true });
const { createPost, deletePost, getPostDraft, updatePost } = await import('../src/lib/cms/posts.ts');
const { deleteUpload, saveUpload, UPLOAD_DIR } = await import('../src/lib/cms/media.ts');
after(async () => {
	for (const [key, value] of [['CMS_BLOG_DIR', old.blog], ['CMS_ASSETS_DIR', old.assets], ['BUILDER_DATA_FILE', old.builder]] as const) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	await rm(root, { recursive: true, force: true });
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64');
const upload = () => saveUpload(new File([png], 'isolated-post.png', { type: 'image/png' }));
const input = (slug: string) => ({ title: 'Post title', description: 'Summary', slug, pubDate: '2024-01-01', draft: true, body: 'Text' });
const conflict = (error: unknown) => error instanceof Error && 'status' in error && error.status === 409;

describe('coordinated CMS blog media', () => {
	it('recognizes local, legacy, encoded, reference-style and linked upload paths without fetching remote URLs', () => {
		assert.equal(postUploadName('/media/uploads/photo%2Epng?width=10'), 'photo.png');
		assert.equal(postUploadName('../../assets/uploads/photo.png'), 'photo.png');
		assert.equal(postUploadName('../../media/uploads/photo.png'), 'photo.png');
		assert.equal(postUploadName('media://uploads/photo.png'), 'photo.png');
		assert.equal(postUploadName('https://outside.example/media/uploads/photo.png'), null);
		assert.equal(postUploadName('https://site.example/media/uploads/photo%2Epng', ['https://site.example']), 'photo.png');
		assert.equal(postUploadName('//site.example/media/uploads/photo.png', ['https://site.example']), 'photo.png');
		assert.equal(postUploadName('//outside.example/media/uploads/photo.png', ['https://site.example']), null);
		assert.equal(postUploadName('https://outside.example/media/uploads/photo.png', ['https://site.example']), null);
		assert.equal(postUploadName('https://person@site.example/media/uploads/photo.png', ['https://site.example']), null);
		assert.equal(postUploadName('http://site.example/media/uploads/photo.png', ['https://site.example']), null);
		assert.deepEqual([...postUploadReferences('', '![picture][ref]\n\n[ref]: /media/uploads/photo&#46;png\n\n[download](/media/uploads/another.png)')].sort(), ['another.png', 'photo.png']);
	});

	it('protects hero and body references, then permits deletion after they are removed', async () => {
		const hero = await upload();
		const body = await upload();
		const encoded = body.name.replace('.', '&#46;');
		const id = await createPost({ ...input('protected-post'), heroImage: hero.reference, body: `![photo][image]\n\n[image]: /media/uploads/${encoded}` });
		assert.equal(publicImageSrc(hero.reference), `/media/uploads/${hero.name}`);
		assert.equal(publicImageSrc('javascript:assets/uploads/photo.png'), '');
		await assert.rejects(deleteUpload(hero.name), conflict);
		await assert.rejects(deleteUpload(body.name), conflict);
		assert.ok((await stat(path.join(UPLOAD_DIR, hero.name))).isFile());
		assert.ok((await stat(path.join(UPLOAD_DIR, body.name))).isFile());
		await updatePost(id, { heroImage: '', body: 'No image here.' });
		await deleteUpload(hero.name);
		await deleteUpload(body.name);
		await deletePost(id);
	});

	it('rejects new missing local uploads, while allowing unrelated edits of existing legacy references', async () => {
		await assert.rejects(createPost({ ...input('missing-post'), body: '![missing](/media/uploads/not-present.png)' }), conflict);
		assert.ok(!(await readdir(process.env.CMS_BLOG_DIR!)).includes('missing-post.md'));
		const legacy = path.join(process.env.CMS_BLOG_DIR!, 'legacy.md');
		await writeFile(legacy, '---\ntitle: Legacy\ndescription: Old\npubDate: 2024-01-01\ndraft: true\n---\n\n![old](/media/uploads/already-missing.png)\n');
		await updatePost('legacy.md', { description: 'Edited without changing the missing image' });
		assert.match((await getPostDraft('legacy.md')).body, /already-missing/);
		await assert.rejects(updatePost('legacy.md', { body: '![new](/media/uploads/another-missing.png)' }), conflict);
		assert.match((await getPostDraft('legacy.md')).body, /already-missing/);
		await deletePost('legacy.md');
	});

	it('serializes post creation with deletion so neither ordering creates a dangling new reference', async () => {
		for (const deleteFirst of [false, true]) {
			const asset = await upload();
			const slug = deleteFirst ? 'delete-first' : 'write-first';
			const save = () => createPost({ ...input(slug), body: `![photo](/media/uploads/${asset.name})` });
			const remove = () => deleteUpload(asset.name);
			const results = await Promise.allSettled(deleteFirst ? [remove(), save()] : [save(), remove()]);
			assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
			const created = (await readdir(process.env.CMS_BLOG_DIR!)).includes(`${slug}.md`);
			if (created) {
				assert.ok((await stat(path.join(UPLOAD_DIR, asset.name))).isFile());
				await deletePost(`${slug}.md`);
				await deleteUpload(asset.name);
			} else await assert.rejects(stat(path.join(UPLOAD_DIR, asset.name)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		}
	});

	it('recognizes absolute same-origin media under the lock while leaving external URLs alone', async () => {
		const origins = ['https://site.example'];
		await assert.rejects(createPost({ ...input('same-origin-missing'), body: '![missing](https://site.example/media/uploads/missing.png)' }, { origins }), conflict);
		const external = await createPost({ ...input('external-post'), body: '![external](https://outside.example/media/uploads/not-local.png)' }, { origins });
		await deletePost(external);
		for (const deleteFirst of [false, true]) {
			const asset = await upload();
			const slug = deleteFirst ? 'absolute-delete-first' : 'absolute-write-first';
			const save = () => createPost({ ...input(slug), heroImage: `https://site.example/media/uploads/${asset.name}` }, { origins });
			const remove = () => deleteUpload(asset.name);
			const results = await Promise.allSettled(deleteFirst ? [remove(), save()] : [save(), remove()]);
			assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
			if ((await readdir(process.env.CMS_BLOG_DIR!)).includes(`${slug}.md`)) {
				assert.ok((await stat(path.join(UPLOAD_DIR, asset.name))).isFile());
				await deletePost(`${slug}.md`); await deleteUpload(asset.name);
			} else await assert.rejects(stat(path.join(UPLOAD_DIR, asset.name)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		}
	});

	it('applies the forwarded public origin to post API saves without treating other hosts as local', async () => {
		const { POST } = await import('../src/pages/cms/api/posts/index.ts');
		const call = (slug: string, body: string) => POST({
			locals: { cmsUser: { role: 'editor' } },
			request: new Request('http://internal/cms/api/posts', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-forwarded-host': 'public.example', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ ...input(slug), body }) }),
		} as never);
		const rejected = await call('api-same-origin', '![x](https://public.example/media/uploads/missing.png)');
		assert.equal(rejected.status, 409);
		const allowed = await call('api-external', '![x](https://outside.example/media/uploads/missing.png)');
		assert.equal(allowed.status, 200);
		await deletePost('api-external.md');
	});

	it('fails closed for MDX, symlinked posts, excessive files and unreadable blog directories', async () => {
		const asset = await upload();
		const mdx = path.join(process.env.CMS_BLOG_DIR!, 'dynamic.mdx');
		await writeFile(mdx, '<img src={computeAnUnknownPath()} />');
		await assert.rejects(deleteUpload(asset.name), conflict);
		await rm(mdx);
		const link = path.join(process.env.CMS_BLOG_DIR!, 'linked.md');
		await symlink(path.join(root, 'target.md'), link);
		await assert.rejects(deleteUpload(asset.name), conflict);
		await rm(link);
		const giant = path.join(process.env.CMS_BLOG_DIR!, 'giant.md');
		await writeFile(giant, 'x'.repeat(4 * 1024 * 1024 + 1));
		await assert.rejects(deleteUpload(asset.name), (error: unknown) => error instanceof Error && 'status' in error && error.status === 503);
		await rm(giant);
		const notDirectory = path.join(root, 'not-directory'); await writeFile(notDirectory, 'x');
		await assert.rejects(assertBlogUploadUnused(notDirectory, asset.name), (error: unknown) => error instanceof Error && 'status' in error && error.status === 503);
		await deleteUpload(asset.name);
	});
});
