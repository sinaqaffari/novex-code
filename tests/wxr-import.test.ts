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

describe('WXR structural limits', () => {
	it('rejects excessive XML nesting and tag count before object parsing', () => {
		const deep = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version>${'<a>'.repeat(64)}x${'</a>'.repeat(64)}</channel></rss>`;
		assert.throws(() => inspectWxr(deep), /عمق/);
		const many = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version>${'<x/>'.repeat(20_001)}</channel></rss>`;
		assert.throws(() => inspectWxr(many), /برچسب/);
	});
	it('does not count markup-like text in CDATA, comments or quoted attributes', () => {
		const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><!-- <a><b> --><item title="> <x>"><wp:post_type>page</wp:post_type><content:encoded><![CDATA[<p>سلام</p>]]></content:encoded></item></channel></rss>`;
		const inspection = inspectWxr(xml);
		assert.equal(inspection.items.length, 1);
		assert.match(inspection.items[0].content, /سلام/);
	});
});

describe('WXR bulk draft import', () => {
	it('generates distinct validated page drafts from all inspected items, without source mutation', async () => {
		const { wxrToDraftPages } = await import('../src/lib/migrations/wordpress/wxr.ts');
		const inspection = inspectWxr(xml);
		const before = JSON.stringify(inspection);
		const docs = wxrToDraftPages(inspection, 'wp-sample');
		assert.deepEqual(docs.map((doc) => doc.slug), ['wp-sample-1', 'wp-sample-2']);
		assert.deepEqual(docs.map((doc) => doc.title), inspection.items.map((item) => item.title));
		assert.equal(JSON.stringify(inspection), before);
		assert.throws(() => wxrToDraftPages(inspection, '../unsafe'));
		assert.throws(() => wxrToDraftPages({ ...inspection, items: Array(21).fill(inspection.items[0]) }, 'bulk'));
		assert.throws(() => wxrToDraftPages({ ...inspection, items: [] }, 'bulk'));
	});
	it('requires writer permission and confirmation, creates only drafts, and rejects collisions atomically', async () => {
		const { wxrToDraftPages } = await import('../src/lib/migrations/wordpress/wxr.ts');
		const { POST } = await import('../src/pages/cms/api/builder/imports/wordpress.ts');
		const { getDraftPage, getPublishedPage } = await import('../src/lib/builder/store.ts');
		const { mkdtemp, rm } = await import('node:fs/promises');
		const { default: os } = await import('node:os');
		const { default: path } = await import('node:path');
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-wxr-bulk-'));
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		const docs = wxrToDraftPages(inspectWxr(xml), 'wp-import');
		const call = (body: unknown, role = 'editor') => POST({ locals: { cmsUser: { role } }, request: new Request('http://local/cms/api/builder/imports/wordpress', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) } as never);
		try {
			assert.equal((await call({ confirmCreate: true, documents: docs }, 'subscriber')).status, 403);
			assert.equal((await call({ documents: docs })).status, 400);
			assert.equal((await call({ confirmCreate: true, documents: [docs[0], { ...docs[1], nodes: [{ type: 'Script' }] }] })).status, 422);
			assert.equal((await getDraftPage(docs[0].slug)).revision, 0);
			assert.equal((await call({ confirmCreate: true, documents: docs })).status, 201);
			assert.deepEqual((await getDraftPage(docs[0].slug)).draft, docs[0]);
			assert.equal(await getPublishedPage(docs[0].slug), null);
			const extra = wxrToDraftPages({ ...inspectWxr(xml), items: [inspectWxr(xml).items[0]] }, 'different')[0];
			assert.equal((await call({ confirmCreate: true, documents: [extra, docs[0]] })).status, 409);
			assert.equal((await getDraftPage(extra.slug)).revision, 0);
		} finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
	});
});

describe('WXR safe structured conversion', () => {
	it('preserves headings, paragraphs, standalone safe links and image placeholders without remote URLs or scripts', () => {
		const source = inspectWxr(xml).items[0];
		const html = '<h2>تیتر <em>فارسی</em></h2><p>پاراگراف &amp; متن</p><p><a href="/contact">تماس</a></p><p>متن <a href="https://example.com/path">پیوند</a> ادامه</p><img src="https://example.com/secret.jpg" alt="نمونه"><script>alert(1)</script><iframe src="https://example.com/x">BAD</iframe>';
		const doc = wxrItemToDocument({ ...source, content: html }, createEmptyPageDocument('structured'));
		assert.equal(doc.nodes[0].type === 'Heading' && doc.nodes[0].props.level, 2);
		assert.equal(doc.nodes[0].type === 'Heading' && doc.nodes[0].props.text, 'تیتر فارسی');
		assert.equal(doc.nodes[1].type === 'Text' && doc.nodes[1].props.text, 'پاراگراف & متن');
		assert.equal(doc.nodes[2].type === 'Button' && doc.nodes[2].props.href, '/contact');
		assert.equal(doc.nodes[3].type === 'Text' && doc.nodes[3].props.text, 'متن پیوند ادامه');
		assert.equal(doc.nodes[4].type === 'Image' && doc.nodes[4].props.alt, 'نمونه');
		assert.equal(doc.nodes[4].type === 'Image' && doc.nodes[4].props.src, '');
		assert.deepEqual(doc.nodes[3].type === 'Text' && doc.nodes[3].props.marks, [{ kind: 'link', start: 4, end: 9, href: 'https://example.com/path' }]);
		assert.deepEqual(doc.nodes[0].type === 'Heading' && doc.nodes[0].props.marks, [{ kind: 'italic', start: 5, end: 10 }]);
		assert.doesNotMatch(JSON.stringify(doc), /secret\.jpg|alert|BAD|<script/);
		assert.deepEqual(validatePageDocument(doc), doc);
	});
	it('preserves unsafe link text, long headings and unicode without retaining unsafe hrefs', () => {
		const source = inspectWxr(xml).items[0];
		const heading = 'الف😀'.repeat(100);
		const doc = wxrItemToDocument({ ...source, content: `<h5>${heading}</h5><p><a href="javascript:alert(1)">متن امن</a></p>` }, createEmptyPageDocument('links'));
		assert.equal(doc.nodes[0].type === 'Heading' && doc.nodes[0].props.level, 4);
		assert.equal(doc.nodes.map((node) => node.type === 'Heading' || node.type === 'Text' ? node.props.text : '').join(''), `${heading}متن امن`);
		assert.doesNotMatch(JSON.stringify(doc), /javascript:/);
	});
	it('rejects excessive HTML depth and output nodes', () => {
		const source = inspectWxr(xml).items[0];
		assert.throws(() => wxrItemToDocument({ ...source, content: '<section>'.repeat(65) + 'x' + '</section>'.repeat(65) }, createEmptyPageDocument('deep-html')), /HTML/);
		assert.throws(() => wxrItemToDocument({ ...source, content: '<p>x</p>'.repeat(201) }, createEmptyPageDocument('many-nodes')), /۲۰۰/);
	});
});

describe('Elementor metadata within WXR', () => {
	const source = [{ id: 'heading01', elType: 'widget', widgetType: 'heading', settings: { title: 'عنوان المنتور', header_size: 'h2' }, elements: [] }, { id: 'unknown01', elType: 'widget', widgetType: 'third-party', settings: { script: 'alert(1)' }, elements: [] }];
	const meta = (data: string) => `<wp:postmeta><wp:meta_key>_elementor_data</wp:meta_key><wp:meta_value><![CDATA[${data}]]></wp:meta_value></wp:postmeta>`;
	const item = (metadata: string) => `<item><title>صفحه</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[<p>متن وردپرس</p>]]></content:encoded>${metadata}</item>`;
	const wrap = (items: string) => `<rss><channel><wp:wxr_version>1.2</wp:wxr_version>${items}</channel></rss>`;
	it('offers a deliberate bounded conversion and reports unsupported widgets', async () => {
		const { convertWxrItem, wxrToDraftPages } = await import('../src/lib/migrations/wordpress/wxr.ts');
		const inspection = inspectWxr(wrap(item(meta(JSON.stringify(source))) + item('')));
		assert.ok(inspection.items[0].elementorData);
		const target = createEmptyPageDocument('target', 'عنوان مقصد');
		assert.equal(convertWxrItem(inspection.items[0], target).document.nodes[0].type, 'Text');
		const converted = convertWxrItem(inspection.items[0], target, true);
		assert.equal(converted.source, 'elementor');
		assert.equal(converted.document.title, target.title);
		assert.equal(converted.document.nodes[0].type, 'Heading');
		if (converted.document.nodes[0].type === 'Heading') assert.equal(converted.document.nodes[0].props.text, 'عنوان المنتور');
		assert.ok(converted.warnings.some((warning) => warning.sourceId === 'unknown01'));
		assert.doesNotMatch(JSON.stringify(converted.document), /alert\(1\)/);
		const bulk = wxrToDraftPages(inspection, 'elementor-wp', true);
		assert.deepEqual(bulk.map((page) => page.nodes[0].type), ['Heading', 'Text']);
	});
	it('warns and declines malformed or ambiguous Elementor metadata without changing HTML content', () => {
		const malformed = inspectWxr(wrap(item(meta('{broken')))).items[0];
		assert.equal(malformed.elementorData, undefined);
		assert.ok(malformed.warnings.some((warning) => warning.includes('معتبر نیست')));
		const duplicate = inspectWxr(wrap(item(meta(JSON.stringify(source)) + meta(JSON.stringify(source))))).items[0];
		assert.equal(duplicate.elementorData, undefined);
		assert.ok(duplicate.warnings.some((warning) => warning.includes('متعارض')));
	});
});

it('converts WXR blockquotes into editable native quotes without retaining source code or media URLs', () => {
	const source = inspectWxr(xml).items[0];
	const html = '<p>پیش</p><blockquote><p>بخش اول</p><p>بخش دوم <strong>متن</strong></p><script>alert(1)</script><img src="https://example.com/secret" alt="تصویر"></blockquote><p>پس</p>';
	const doc = wxrItemToDocument({ ...source, content: html }, createEmptyPageDocument('quote-import'));
	assert.deepEqual(doc.nodes.map((node) => node.type), ['Text', 'Blockquote', 'Image', 'Text']);
	const quote = doc.nodes[1];
	assert.equal(quote.type === 'Blockquote' && quote.props.text, 'بخش اول\nبخش دوم متن');
	assert.equal(doc.nodes[2].type === 'Image' && doc.nodes[2].props.alt, 'تصویر');
	assert.doesNotMatch(JSON.stringify(doc), /alert|example\.com/);
});
