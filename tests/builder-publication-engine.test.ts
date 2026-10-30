import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps, updateNodeStyles } from '../src/lib/builder/operations.ts';
import { compilePageDocument, preparePagePublication } from '../src/lib/builder/publishing.ts';
import { BuilderStoreError, getDraftPage, getPublishedPage, publishPage, saveDraftPage } from '../src/lib/builder/store.ts';

describe('publication compiler', () => {
	it('validates registration and produces deterministic responsive and theme output', () => {
		let document = addNode(createEmptyPageDocument('compile', 'عنوان SEO'), 'Container', { id: 'node_container1' });
		document = updateNodeStyles(document, 'node_container1', { layout: 'grid', columns: 2 }, 'mobile');
		const first = compilePageDocument(document, document.slug);
		const second = compilePageDocument(document, document.slug);
		assert.deepEqual(first, second);
		if (!first.ok) throw new Error('compile failed');
		assert.equal(first.page.document.title, 'عنوان SEO');
		assert.deepEqual(first.page.components, ['Container']);
		assert.match(first.page.responsiveCss, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
		assert.doesNotMatch(first.page.responsiveCss, /builder-preview|selected|outline/);
		const invalid = compilePageDocument({ ...document, nodes: [{ id: 'node_unknown01', type: 'Bad', props: {}, componentVersion: 1 }] });
		assert.equal(invalid.ok, false);
		if (!invalid.ok) assert.equal(invalid.diagnostics[0].code, 'unknown_component');
	});
	it('deduplicates local asset checks and never fetches external images', async () => {
		let doc = addNode(createEmptyPageDocument('assets'), 'Image', { id: 'node_image0001' });
		doc = updateNodeProps(doc, 'node_image0001', { src: 'media://uploads/nope.png' });
		doc = addNode(doc, 'Image', { id: 'node_image0002' });
		doc = updateNodeProps(doc, 'node_image0002', { src: '/media/uploads/nope.png?x=1' });
		doc = addNode(doc, 'Image', { id: 'node_image0003' });
		doc = updateNodeProps(doc, 'node_image0003', { src: 'https://example.com/image.png' });
		const checks: string[] = [];
		const result = await preparePagePublication(doc, doc.slug, async (name) => { checks.push(name); return false; });
		assert.deepEqual(checks, ['uploads/nope.png']);
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.diagnostics.filter((issue) => issue.code === 'missing_asset').length, 2);
	});
	it('rejects missing managed assets without updating an existing published snapshot', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-publish-'));
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		try {
			let doc = addNode(createEmptyPageDocument('publish-check'), 'Heading', { id: 'node_heading01' });
			await saveDraftPage({ slug: doc.slug, expectedRevision: 0, document: doc });
			await publishPage({ slug: doc.slug, expectedRevision: 1, document: doc });
			doc = addNode(doc, 'Image', { id: 'node_image0001' });
			doc = updateNodeProps(doc, 'node_image0001', { src: 'media://uploads/definitely-missing.png' });
			await assert.rejects(saveDraftPage({ slug: doc.slug, expectedRevision: 2, document: doc }), (error: unknown) => error instanceof BuilderStoreError && error.code === 'missing_asset' && error.status === 409);
			await assert.rejects(publishPage({ slug: doc.slug, expectedRevision: 2, document: doc }), (error: unknown) => error instanceof BuilderStoreError && error.code === 'missing_asset' && error.diagnostics?.[0].severity === 'error');
			assert.equal((await getDraftPage(doc.slug)).revision, 2);
			assert.equal((await getPublishedPage(doc.slug))?.revision, 2);
		} finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
	});
});
