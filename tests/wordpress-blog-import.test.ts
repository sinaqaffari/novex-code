import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { inspectWxr } from '../src/lib/migrations/wordpress/wxr.ts';
import { wxrPostToBlogDraft } from '../src/lib/migrations/wordpress/blog-post.ts';
import { renderMarkdown } from '../src/lib/cms/markdown.ts';

const temp = await mkdtemp(path.join(os.tmpdir(), 'novex-wxr-blog-test-'));
const oldBlogDir = process.env.CMS_BLOG_DIR;
const oldBuilderData = process.env.BUILDER_DATA_FILE;
process.env.CMS_BLOG_DIR = temp;
process.env.BUILDER_DATA_FILE = path.join(temp, 'builder-pages.json');
const { BLOG_DIR, createPost, getPostDraft, updatePost } = await import('../src/lib/cms/posts.ts');
const { POST: createPostRoute } = await import('../src/pages/cms/api/posts/index.ts');
const { PUT: updatePostRoute } = await import('../src/pages/cms/api/posts/[id].ts');
const { withBuilderAssetLock } = await import('../src/lib/builder/store.ts');
const { requiredCmsPermission } = await import('../src/lib/cms/access.ts');
after(async () => {
	if (oldBlogDir === undefined) delete process.env.CMS_BLOG_DIR; else process.env.CMS_BLOG_DIR = oldBlogDir;
	if (oldBuilderData === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = oldBuilderData;
	await rm(temp, { recursive: true, force: true });
});

function post() {
	const html = '<h2>Intro <em>heading</em></h2><p>Safe <strong>bold</strong> and <a href="/inside">link</a> ![external](https://example.com/a.png)</p><blockquote>Quote <em>emphasis</em></blockquote><ul><li>First</li><li><a href="/two">Second</a></li></ul><img src="http://127.0.0.1/secret.png" alt="Image"><script>window.evil=true</script><p><a href="javascript:alert(1)">unsafe</a> &lt;script&gt;literal&lt;/script&gt;</p>';
	const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Actual post</title><wp:post_type>post</wp:post_type><wp:post_name>actual-post</wp:post_name><wp:post_date_gmt>2024-06-13 12:34:56</wp:post_date_gmt><category>News</category><category>Persian</category><excerpt:encoded><![CDATA[Short <strong>summary</strong>]]></excerpt:encoded><content:encoded><![CDATA[${html}]]></content:encoded></item></channel></rss>`;
	return inspectWxr(xml).items[0];
}

describe('WordPress blog draft conversion', () => {
	it('converts safe structure and metadata into existing CMS Markdown without executing source or fetching media', async () => {
		const source = post();
		assert.deepEqual(source.categories, ['News', 'Persian']);
		const draft = wxrPostToBlogDraft(source);
		assert.equal(draft.draft, true);
		assert.equal(draft.pubDate, '2024-06-13T12:34:56.000Z');
		assert.equal(draft.description, 'Short summary');
		assert.deepEqual(draft.tags, ['News', 'Persian']);
		assert.ok(draft.warnings.some((warning) => warning.includes('تصاویر')));
		assert.doesNotMatch(draft.body, /window\.evil|127\.0\.0\.1|javascript:/);
		const html = await renderMarkdown(draft.body);
		assert.match(html, /<h2>Intro <em>heading<\/em><\/h2>/);
		assert.match(html, /<strong>bold<\/strong>/);
		assert.match(html, /href="\/inside"/);
		assert.match(html, /<blockquote>/);
		assert.match(html, /<ul>/);
		assert.match(html, /href="\/two"/);
		assert.doesNotMatch(html, /<script|<img|javascript:|window\.evil/);
		assert.match(html, /&lt;script&gt;literal&lt;\/script&gt;/);
		assert.throws(() => wxrPostToBlogDraft({ ...source, type: 'page' }), /فقط نوشته/);
	});
	it('uses only explicit managed image mappings in CMS Markdown and retains placeholders for others', async () => {
		const source = { ...post(), content: '<p>Pictures</p><img src="https://source.example/mapped.png" alt="Mapped image"><img src="https://source.example/missing.png" alt="Missing image">' };
		const mapping = new Map([['https://source.example/mapped.png', 'media://uploads/known.png']]);
		const draft = wxrPostToBlogDraft(source, mapping);
		assert.match(draft.body, /!\[Mapped image\]\(\/media\/uploads\/known\.png\)/);
		assert.match(draft.body, /Missing image/);
		assert.doesNotMatch(draft.body, /source\.example/);
		assert.ok(draft.warnings.some((warning) => warning.includes('نگاشت‌شده')));
		assert.ok(draft.warnings.some((warning) => warning.includes('جای‌نگهدار')));
		const html = await renderMarkdown(draft.body);
		assert.match(html, /<img src="\/media\/uploads\/known\.png" alt="Mapped image">/);
		assert.equal((html.match(/<img /g) ?? []).length, 1);
	});
	it('creates an isolated real CMS draft and prevents concurrent same-slug overwrites', async () => {
		assert.equal(BLOG_DIR, temp);
		const draft = wxrPostToBlogDraft(post());
		const attempts = await Promise.allSettled([createPost(draft), createPost(draft)]);
		assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
		assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1);
		const id = attempts.find((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')!.value;
		const stored = await getPostDraft(id);
		assert.equal(stored.draft, true);
		assert.equal(stored.body, draft.body);
		assert.deepEqual(stored.tags, ['News', 'Persian']);
		assert.match(await readFile(path.join(temp, id), 'utf8'), /draft: true/);
		assert.ok((await readdir(temp)).every((name) => !name.endsWith('.tmp')));
	});
	it('reports missing or ambiguous date, metadata limits and media omissions', () => {
		const draft = wxrPostToBlogDraft({ ...post(), sourceDate: '2024-01-01 10:00', excerpt: '', categories: ['x,y', 'tag'] });
		assert.deepEqual(draft.tags, ['tag']);
		assert.ok(draft.warnings.some((warning) => warning.includes('تاریخ')));
		assert.ok(draft.warnings.some((warning) => warning.includes('چکیده')));
		assert.ok(draft.warnings.some((warning) => warning.includes('دسته')));
	});
	it('uses the existing post authorization and prevents contributors from publishing imports', async () => {
		assert.equal(requiredCmsPermission({ pathname: '/cms/api/posts', method: 'POST' }), 'cms.posts:write');
		const draft = { ...wxrPostToBlogDraft(post()), slug: 'role-test' };
		const call = (published: boolean) => createPostRoute({ locals: { cmsUser: { role: 'contributor' } }, request: new Request('http://local/cms/api/posts', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...draft, draft: !published }) }) } as never);
		assert.equal((await call(true)).status, 403);
		const subscriber = await createPostRoute({ locals: { cmsUser: { role: 'subscriber' } }, request: new Request('http://local/cms/api/posts', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...draft, draft: true }) }) } as never);
		assert.equal(subscriber.status, 403);
		const response = await call(false); assert.equal(response.status, 200);
		const body = await response.json() as { id: string };
		assert.equal((await getPostDraft(body.id)).draft, true);
	});

	it('never overwrites an existing post when a rename races a new post', async () => {
		const draft = wxrPostToBlogDraft(post());
		const oldId = await createPost({ ...draft, title: 'Original', slug: 'rename-original' });
		const attempts = await Promise.allSettled([
			updatePost(oldId, { slug: 'raced-target' }),
			createPost({ ...draft, title: 'Other writer', slug: 'raced-target' }),
		]);
		assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
		const target = await getPostDraft('raced-target.md');
		if (target.title === 'Other writer') assert.equal((await getPostDraft(oldId)).title, 'Original');
		else assert.equal(target.title, 'Original');
		assert.ok((await readdir(temp)).every((name) => !name.endsWith('.tmp')));
	});

	it('serializes the same slug across Markdown and MDX and keeps encoded IDs canonical', async () => {
		const draft = wxrPostToBlogDraft(post());
		const sourceId = await createPost({ ...draft, title: 'MDX original', slug: 'original-mdx' });
		await rename(path.join(temp, sourceId), path.join(temp, 'original-mdx.mdx'));
		const attempts = await Promise.allSettled([
			updatePost('original-mdx%2Emdx', { slug: 'cross-format-target' }),
			createPost({ ...draft, title: 'Markdown writer', slug: 'cross-format-target' }),
		]);
		assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
		const files = await readdir(temp);
		assert.equal(files.filter((file) => /^cross-format-target\.mdx?$/.test(file)).length, 1);
		const existing = files.find((file) => /^cross-format-target\.mdx?$/.test(file))!;
		const updated = await getPostDraft(existing.replace('.', '%2E'));
		assert.equal(updated.id, existing);
		await updatePost(existing.replace('.', '%2E'), { body: 'Atomic update' });
		assert.equal((await getPostDraft(existing)).body, 'Atomic update');
		assert.ok((await readdir(temp)).every((name) => !name.endsWith('.tmp')));
	});

	it('rechecks contributor permissions under the lock after a concurrent publication', async () => {
		const draft = wxrPostToBlogDraft(post());
		const id = await createPost({ ...draft, slug: 'role-race' });
		let unlock!: () => void;
		let started!: () => void;
		const ready = new Promise<void>((resolve) => { started = resolve; });
		const hold = withBuilderAssetLock(async () => { started(); await new Promise<void>((resolve) => { unlock = resolve; }); });
		await ready;
		const publication = updatePost(id, { draft: false }, { role: 'editor' });
		await new Promise<void>((resolve) => setImmediate(resolve));
		const denial = assert.rejects(updatePost(id, { draft: true, body: 'not allowed' }, { role: 'contributor' }), (error: unknown) => error instanceof Error && 'status' in error && error.status === 403);
		await new Promise<void>((resolve) => setImmediate(resolve));
		unlock();
		await hold; await publication; await denial;
		const saved = await getPostDraft(id);
		assert.equal(saved.draft, false);
		assert.notEqual(saved.body, 'not allowed');
		const response = await updatePostRoute({ params: { id }, locals: { cmsUser: { role: 'contributor' } }, request: new Request('http://local/cms/api/posts/' + id, { method: 'PUT', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...draft, draft: true }) }) } as never);
		assert.equal(response.status, 403);
	});

});
