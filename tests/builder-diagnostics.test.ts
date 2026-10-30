import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { diagnosePageDocument } from '../src/lib/builder/diagnostics.ts';
import { getDraftPage, getPublishedPage } from '../src/lib/builder/store.ts';
import { POST } from '../src/pages/cms/api/builder/pages/[slug]/diagnostics.ts';

function request(document: unknown, slug = 'diagnostics', role = 'editor') {
	return { params: { slug }, locals: { cmsUser: { role } }, request: new Request(`http://localhost/cms/api/builder/pages/${slug}/diagnostics`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document }) }) } as never;
}

describe('builder pre-publication diagnostics', () => {
	it('reports nested actionable issues and inspects only deduplicated local media, never external URLs', async () => {
		let doc = addNode(createEmptyPageDocument('diagnostics'), 'Container', { id: 'node_container1' });
		doc = addNode(doc, 'Heading', { id: 'node_heading01', parentId: 'node_container1' });
		doc = updateNodeProps(doc, 'node_heading01', { text: '', level: 1 });
		doc = addNode(doc, 'Image', { id: 'node_image0001' });
		doc = updateNodeProps(doc, 'node_image0001', { src: 'media://uploads/missing.png', alt: '' });
		doc = addNode(doc, 'Image', { id: 'node_image0002' });
		doc = updateNodeProps(doc, 'node_image0002', { src: '/media/uploads/missing.png', alt: 'تصویر' });
		doc = addNode(doc, 'Image', { id: 'node_image0003' });
		doc = updateNodeProps(doc, 'node_image0003', { src: 'https://example.com/a.png', alt: 'تصویر' });
		doc = addNode(doc, 'Button', { id: 'node_button001' });
		const inspected: string[] = [];
		const issues = await diagnosePageDocument(doc, 'diagnostics', async (file) => { inspected.push(file); return false; });
		assert.deepEqual(inspected, ['uploads/missing.png']);
		assert.ok(issues.some((issue) => issue.code === 'missing-description'));
		assert.ok(issues.some((issue) => issue.code === 'empty-heading' && issue.nodeId === 'node_heading01'));
		assert.ok(issues.some((issue) => issue.code === 'extra-h1'));
		assert.equal(issues.filter((issue) => issue.code === 'missing-media').length, 2);
		assert.ok(issues.some((issue) => issue.code === 'missing-alt'));
		assert.ok(issues.some((issue) => issue.code === 'external-image'));
		assert.ok(issues.some((issue) => issue.code === 'placeholder-link'));
	});
	it('uses role and document validation, and never writes or publishes the inspected snapshot', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-diagnostics-'));
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		try {
			const doc = createEmptyPageDocument('diagnostics');
			assert.equal((await POST(request(doc, 'diagnostics', 'subscriber'))).status, 403);
			assert.equal((await POST(request(doc, 'different'))).status, 422);
			const invalid = { ...doc, nodes: [{ type: 'Script', id: 'node_script000', props: {} }] };
			assert.equal((await POST(request(invalid))).status, 422);
			const response = await POST(request(doc, 'diagnostics', 'contributor'));
			assert.equal(response.status, 200);
			assert.ok((await response.json()).diagnostics.some((issue: { code: string }) => issue.code === 'empty-page'));
			assert.equal((await getDraftPage('diagnostics')).revision, 0);
			assert.equal(await getPublishedPage('diagnostics'), null);
		} finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
	});
	it('bounds streaming input even without a content-length header', async () => {
		const response = await POST({ params: { slug: 'diagnostics' }, locals: { cmsUser: { role: 'editor' } }, request: new Request('http://localhost/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(1_200_001) }) } as never);
		assert.equal(response.status, 413);
	});
});
