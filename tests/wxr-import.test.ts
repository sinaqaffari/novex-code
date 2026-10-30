import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { inspectWxr, wxrItemToDocument } from '../src/lib/migrations/wordpress/wxr.ts';
import { createEmptyPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';

const xml = readFileSync(new URL('./fixtures/wordpress-sample.xml', import.meta.url), 'utf8');
describe('local WordPress WXR import', () => {
	it('inspects real WXR structures and builds safe native draft content', () => {
		const report = inspectWxr(xml);
		assert.equal(report.version, '1.2');
		assert.equal(report.items.length, 2);
		assert.equal(report.ignored, 1);
		assert.equal(report.items[0].title, 'درباره ما');
		assert.equal(report.items[0].id, '42');
		assert.ok(report.items[0].warnings.some((w) => w.includes('رسانه')));
		const target = createEmptyPageDocument('wxr-page', 'عنوان فعلی');
		const document = wxrItemToDocument(report.items[0], target);
		assert.equal(document.title, target.title);
		assert.equal(document.nodes[0].type, 'Text');
		if (document.nodes[0].type === 'Text') assert.equal(document.nodes[0].props.text, 'سلام Novex');
		assert.doesNotMatch(JSON.stringify(document), /alert|example\.com|<script/);
		assert.deepEqual(validatePageDocument(document), document);
	});
	it('rejects malformed, oversized, non-WXR and entity-bearing inputs', () => {
		assert.throws(() => inspectWxr('<rss>'));
		assert.throws(() => inspectWxr('<rss><channel/></rss>'));
		assert.throws(() => inspectWxr(' '.repeat(1024 * 1024 + 1)));
		assert.throws(() => inspectWxr('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>'));
	});
	it('limits item count and preserves valid long Unicode content in chunks', () => {
		const item = '<item><wp:post_type>page</wp:post_type></item>';
		assert.throws(() => inspectWxr(`<rss><channel><wp:wxr_version>1.2</wp:wxr_version>${item.repeat(201)}</channel></rss>`));
		const source = inspectWxr(xml).items[0];
		const text = 'الف😀'.repeat(1800);
		const document = wxrItemToDocument({ ...source, content: text }, createEmptyPageDocument('long'));
		assert.equal(document.nodes.map((node) => node.type === 'Text' ? node.props.text : '').join(''), text);
	});
});

describe('WXR draft persistence', () => {
	it('saves converted content only as a draft and supports undo', async () => {
		const { mkdtemp, rm } = await import('node:fs/promises');
		const os = await import('node:os');
		const path = await import('node:path');
		const { saveDraftPage, getDraftPage, getPublishedPage } = await import('../src/lib/builder/store.ts');
		const { createDocumentHistory, commitDocument, undoDocument } = await import('../src/lib/builder/history.ts');
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-wxr-'));
		const prior = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		try {
			const original = createEmptyPageDocument('wxr-draft', 'صفحه');
			const imported = wxrItemToDocument(inspectWxr(xml).items[0], original);
			assert.deepEqual(undoDocument(commitDocument(createDocumentHistory(original), imported)).present, original);
			await saveDraftPage({ slug: original.slug, expectedRevision: 0, document: imported });
			assert.deepEqual((await getDraftPage(original.slug)).draft, imported);
			assert.equal(await getPublishedPage(original.slug), null);
		} finally { if (prior === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = prior; await rm(dir, { recursive: true, force: true }); }
	});
});
