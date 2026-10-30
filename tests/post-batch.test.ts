import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { commitPostBatchUnderLock } from '../src/lib/cms/post-batch.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'novex-post-batch-'));
const old = { blog: process.env.CMS_BLOG_DIR, assets: process.env.CMS_ASSETS_DIR, builder: process.env.BUILDER_DATA_FILE };
process.env.CMS_BLOG_DIR = path.join(root, 'blog');
process.env.CMS_ASSETS_DIR = path.join(root, 'assets');
process.env.BUILDER_DATA_FILE = path.join(root, 'builder.json');
await mkdir(process.env.CMS_BLOG_DIR, { recursive: true });
const { createDraftPostBatch, createPost, getPostDraft, listPosts } = await import('../src/lib/cms/posts.ts');
const { withBuilderAssetLock } = await import('../src/lib/builder/store.ts');
const { saveUpload } = await import('../src/lib/cms/media.ts');
const { POST: importPostBatch } = await import('../src/pages/cms/api/builder/imports/wordpress-posts.ts');
const { requiredCmsPermission } = await import('../src/lib/cms/access.ts');
after(async () => {
	for (const [key, value] of [['CMS_BLOG_DIR', old.blog], ['CMS_ASSETS_DIR', old.assets], ['BUILDER_DATA_FILE', old.builder]] as const) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	await rm(root, { recursive: true, force: true });
});
const blogDir = process.env.CMS_BLOG_DIR!;
const input = (slug: string) => ({ title: slug, description: 'Summary', slug, pubDate: '2024-01-01', draft: true, body: 'Safe text' });
const noJournal = async () => assert.ok((await readdir(blogDir)).every((name) => !name.startsWith('.post-batch-')));
const status = (value: number) => (error: unknown) => error instanceof Error && 'status' in error && error.status === value;

async function simulateJournal(state: 'pending' | 'committed', specs: Array<{ id: string; contents: string; linked: boolean }>) {
	const token = randomUUID();
	const entries = [];
	for (const [index, spec] of specs.entries()) {
		const stage = `.post-batch-${token}-${index}.tmp`;
		const stagePath = path.join(blogDir, stage);
		await writeFile(stagePath, spec.contents, { flag: 'wx' });
		const info = await lstat(stagePath, { bigint: true });
		if (spec.linked) await link(stagePath, path.join(blogDir, spec.id));
		entries.push({ id: spec.id, stage, sha256: createHash('sha256').update(spec.contents).digest('hex'), dev: info.dev.toString(), ino: info.ino.toString() });
	}
	const journal = path.join(blogDir, `.post-batch-${token}.json`);
	await writeFile(journal, JSON.stringify({ version: 1, state, entries }), { flag: 'wx' });
	return { journal, entries };
}

describe('recoverable CMS draft batches', () => {
	it('creates bounded drafts together and rejects collisions or invalid batches without partial writes', async () => {
		assert.deepEqual(await createDraftPostBatch([input('batch-one'), input('batch-two')]), ['batch-one.md', 'batch-two.md']);
		assert.equal((await getPostDraft('batch-one.md')).draft, true);
		assert.equal((await getPostDraft('batch-two.md')).draft, true);
		await assert.rejects(createDraftPostBatch([input('fresh-post'), input('batch-one')]));
		assert.ok(!(await readdir(blogDir)).includes('fresh-post.md'));
		await assert.rejects(createDraftPostBatch([input('duplicate'), input('duplicate')]), status(409));
		await assert.rejects(createDraftPostBatch([{ ...input('publish'), draft: false }]), status(422));
		await assert.rejects(createDraftPostBatch([]), status(422));
		await noJournal();
	});

	it('rolls back owned links after a mid-commit collision without touching the existing file', async () => {
		const existing = await createPost(input('already-there'));
		const original = await readFile(path.join(blogDir, existing), 'utf8');
		await assert.rejects(withBuilderAssetLock(() => commitPostBatchUnderLock(blogDir, [
			{ id: 'would-be-partial.md', contents: 'temporary post' },
			{ id: existing, contents: 'must not overwrite' },
		])), status(409));
		assert.ok(!(await readdir(blogDir)).includes('would-be-partial.md'));
		assert.equal(await readFile(path.join(blogDir, existing), 'utf8'), original);
		await noJournal();
	});

	it('rolls back an interrupted batch before any reader can observe it', async () => {
		await simulateJournal('pending', [
			{ id: 'interrupted-one.md', contents: 'one', linked: true },
			{ id: 'interrupted-two.md', contents: 'two', linked: false },
		]);
		const posts = await listPosts();
		assert.ok(!posts.some((post) => post.id.startsWith('interrupted-')));
		assert.ok(!(await readdir(blogDir)).includes('interrupted-one.md'));
		await noJournal();
	});

	it('keeps every committed post and finishes cleanup after an interrupted commit', async () => {
		await simulateJournal('committed', [
			{ id: 'committed-one.md', contents: 'First committed', linked: true },
			{ id: 'committed-two.md', contents: 'Second committed', linked: true },
		]);
		const posts = await listPosts();
		assert.ok(posts.some((post) => post.id === 'committed-one.md'));
		assert.equal(await readFile(path.join(blogDir, 'committed-two.md'), 'utf8'), 'Second committed');
		await noJournal();
	});

	it('never rolls back a modified owned post or follows an invalid journal path', async () => {
		const simulated = await simulateJournal('pending', [{ id: 'modified.md', contents: 'Original', linked: true }]);
		await writeFile(path.join(blogDir, 'modified.md'), 'Changed externally');
		await assert.rejects(listPosts(), status(503));
		assert.equal(await readFile(path.join(blogDir, 'modified.md'), 'utf8'), 'Changed externally');
		// These files were created by this isolated test, not by the user.
		await rm(simulated.journal); await rm(path.join(blogDir, simulated.entries[0].stage)); await rm(path.join(blogDir, 'modified.md'));
		const forged = await simulateJournal('pending', [{ id: 'forged.md', contents: 'original', linked: false }]);
		await writeFile(forged.journal, JSON.stringify({ version: 1, state: 'pending', entries: [{ ...forged.entries[0], id: '../outside.md' }] }));
		await writeFile(path.join(root, 'outside.md'), 'unrelated');
		await assert.rejects(listPosts(), status(503));
		assert.equal(await readFile(path.join(root, 'outside.md'), 'utf8'), 'unrelated');
		await rm(forged.journal); await rm(path.join(blogDir, forged.entries[0].stage));
	});
	it('reinspects WXR on the authorized API and imports only actual CMS drafts with local images', async () => {
		const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64');
		const asset = await saveUpload(new File([bytes], 'batch-image.png', { type: 'image/png' }));
		const longTitle = 'A'.repeat(140);
		const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>${longTitle}</title><wp:post_type>post</wp:post_type><excerpt:encoded>First summary</excerpt:encoded><content:encoded><![CDATA[<p>First</p><img src="https://source.example/a.png" alt="local">]]></content:encoded></item><item><title>A page</title><wp:post_type>page</wp:post_type><content:encoded>Page only</content:encoded></item><item><title>Second post</title><wp:post_type>post</wp:post_type><content:encoded>Second</content:encoded></item></channel></rss>`;
		const body = { xml, prefix: 'bulk-api', mediaMap: { 'https://source.example/a.png': `media://uploads/${asset.name}` }, confirmCreate: true };
		const call = (role: string, payload: unknown) => importPostBatch({ locals: { cmsUser: { role } }, request: new Request('http://local/cms/api/builder/imports/wordpress-posts', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) }) } as never);
		assert.equal(requiredCmsPermission({ pathname: '/cms/api/builder/imports/wordpress-posts', method: 'POST' }), 'cms.posts:write');
		assert.equal((await call('subscriber', body)).status, 403);
		assert.equal((await call('contributor', { ...body, confirmCreate: false })).status, 400);
		assert.equal((await call('contributor', { ...body, prefix: 'missing', mediaMap: { 'id:1': 'media://uploads/missing.png' } })).status, 409);
		const response = await call('contributor', body);
		assert.equal(response.status, 201);
		assert.deepEqual((await response.json()).posts, [{ id: 'bulk-api-1.md' }, { id: 'bulk-api-2.md' }]);
		const first = await getPostDraft('bulk-api-1.md');
		assert.equal(first.title, longTitle);
		assert.equal(first.draft, true);
		assert.match(first.body, new RegExp(`/media/uploads/${asset.name}`));
		assert.doesNotMatch(first.body, /source\.example/);
		assert.equal((await getPostDraft('bulk-api-2.md')).title, 'Second post');
		assert.ok(!(await readdir(blogDir)).includes('bulk-api-3.md'));
		assert.ok((await call('contributor', body)).status >= 400);
		await noJournal();
	});

	it('rejects oversized or malformed import requests and excessive post counts', async () => {
		const call = (payload: unknown) => importPostBatch({ locals: { cmsUser: { role: 'editor' } }, request: new Request('http://local/cms/api/builder/imports/wordpress-posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }) } as never);
		assert.equal((await call({ xml: 'x'.repeat(3_000_001), prefix: 'large', confirmCreate: true })).status, 413);
		assert.equal((await call({ xml: '<rss/>', prefix: 'bad', confirmCreate: true })).status, 422);
		const item = '<item><title>Post</title><wp:post_type>post</wp:post_type></item>';
		const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version>${item.repeat(21)}</channel></rss>`;
		assert.equal((await call({ xml, prefix: 'too-many', confirmCreate: true })).status, 422);
		assert.ok(!(await readdir(blogDir)).some((name) => name.startsWith('too-many-')));
	});

});
