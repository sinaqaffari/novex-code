import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEmptyPageDocument, exportPageDocument, importPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { addNode, insertDocumentFragment, updateNodeProps } from '../src/lib/builder/operations.ts';
import { createSharedSection, getDraftPage, getPublishedPage, getSharedSection, listBuilderAssetUsages, publishPage, saveDraftPage, synchronizeSharedSection, updateSharedSection } from '../src/lib/builder/store.ts';
import { sectionFragment, sectionHash } from '../src/lib/builder/shared-sections.ts';
import { deleteUpload, saveUpload, UPLOAD_DIR } from '../src/lib/cms/media.ts';
import type { ContainerNode, PageDocument } from '../src/lib/builder/types.ts';

function sectionNode(): ContainerNode {
	let doc = addNode(createEmptyPageDocument('source'), 'Container', { id: 'node_section01' });
	doc = addNode(doc, 'Heading', { parentId: 'node_section01', id: 'node_heading01' });
	doc = updateNodeProps(doc, 'node_heading01', { text: 'Original' });
	const root = doc.nodes[0];
	if (root.type !== 'Container') throw new Error('expected container');
	return root;
}
function inserted(section: Awaited<ReturnType<typeof createSharedSection>>, slug: string): PageDocument {
	return insertDocumentFragment(createEmptyPageDocument(slug), sectionFragment(section), null).document;
}
async function isolated(run: () => Promise<void>) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-sections-'));
	const old = process.env.BUILDER_DATA_FILE;
	process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
	try { await run(); }
	finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
}

describe('shared section source and snapshot synchronization', () => {
	it('inserts independent linked snapshots, atomically updates drafts, and leaves publication unchanged', async () => isolated(async () => {
		const original = sectionNode();
		const section = await createSharedSection('Header', original);
		const a = inserted(section, 'shared-a');
		const b = inserted(section, 'shared-b');
		assert.notEqual(a.nodes[0].id, b.nodes[0].id);
		assert.deepEqual(importPageDocument(exportPageDocument(a)), a);
		await saveDraftPage({ slug: a.slug, expectedRevision: 0, document: a });
		await saveDraftPage({ slug: b.slug, expectedRevision: 0, document: b });
		await publishPage({ slug: b.slug, expectedRevision: 1, document: b });
		const source = updateNodeProps({ ...createEmptyPageDocument('source'), nodes: [original] }, 'node_heading01', { text: 'Updated' }).nodes[0] as ContainerNode;
		const updated = await updateSharedSection(section.id, 1, source);
		assert.equal(updated.revision, 2);
		const changed = await synchronizeSharedSection(section.id, 2);
		assert.deepEqual(new Set(changed.map((page) => page.slug)), new Set(['shared-a', 'shared-b']));
		for (const slug of ['shared-a', 'shared-b']) {
			const record = await getDraftPage(slug);
			const root = record.draft.nodes[0];
			assert.equal(root.type, 'Container');
			if (root.type !== 'Container') throw new Error('root');
			assert.equal(root.sharedSection?.revision, 2);
			assert.equal(root.children[0].type === 'Heading' && root.children[0].props.text, 'Updated');
		}
		const published = (await getPublishedPage('shared-b'))!.document.nodes[0];
		assert.equal(published.type === 'Container' && published.children[0].type === 'Heading' && published.children[0].props.text, 'Original');
		assert.equal((await synchronizeSharedSection(section.id, 2)).length, 0);
	}));
	it('rejects local edits or forged baselines without changing any page', async () => isolated(async () => {
		const section = await createSharedSection('Footer', sectionNode());
		const a = inserted(section, 'conflict-a');
		const b = inserted(section, 'conflict-b');
		await saveDraftPage({ slug: a.slug, expectedRevision: 0, document: a });
		const rootB = b.nodes[0] as ContainerNode;
		const local = updateNodeProps(b, rootB.children[0].id, { text: 'Local edit' });
		await saveDraftPage({ slug: b.slug, expectedRevision: 0, document: local });
		const changed = updateNodeProps({ ...createEmptyPageDocument('source'), nodes: [section.node] }, 'node_heading01', { text: 'Source edit' }).nodes[0];
		await updateSharedSection(section.id, 1, changed);
		await assert.rejects(synchronizeSharedSection(section.id, 2), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'section_update_conflict');
		assert.equal((await getDraftPage('conflict-a')).revision, 1);
		assert.deepEqual((await getDraftPage('conflict-b')).draft, local);
		const locallyEdited = local.nodes[0] as ContainerNode;
		const forged = validatePageDocument({ ...local, nodes: [{ ...locallyEdited, sharedSection: { ...locallyEdited.sharedSection!, baselineHash: sectionHash(locallyEdited) } }] });
		await saveDraftPage({ slug: b.slug, expectedRevision: 1, document: forged });
		await assert.rejects(synchronizeSharedSection(section.id, 2), /تغییر کرده/);
		assert.equal((await getDraftPage('conflict-a')).revision, 1);
		await assert.rejects(updateSharedSection(section.id, 1, changed), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'revision_conflict');
	}));
	it('rejects nested links and version-two fields rather than silently interpreting them', async () => isolated(async () => {
		const section = await createSharedSection('Nested', sectionNode());
		const instance = sectionFragment(section).nodes[0] as ContainerNode;
		assert.throws(() => validatePageDocument({ ...createEmptyPageDocument('legacy'), schemaVersion: 2, nodes: [instance] }), /Unsupported property/);
		const nested = { ...instance, id: 'node_parent01', children: [instance] };
		assert.throws(() => validatePageDocument({ ...createEmptyPageDocument('nested'), nodes: [nested] }), /Shared sections must be non-nested/);
		assert.throws(() => sectionFragment({ ...section, node: nested }), /تو‌در‌تو|nested/i);
	}));
	it('protects assets used by the central section even when no page links it', async () => isolated(async () => {
		const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64');
		const uploaded = await saveUpload(new File([png], 'shared-test.png', { type: 'image/png' }));
		try {
			let doc = addNode(createEmptyPageDocument('source'), 'Container', { id: 'node_section01' });
			doc = addNode(doc, 'Image', { parentId: 'node_section01', id: 'node_image0001' });
			doc = updateNodeProps(doc, 'node_image0001', { src: `media://uploads/${uploaded.name}` });
			const section = await createSharedSection('Image section', doc.nodes[0]);
			assert.equal((await getSharedSection(section.id))?.id, section.id);
			assert.ok((await listBuilderAssetUsages(`uploads/${uploaded.name}`)).some((item) => item.scope === 'section' && item.sectionId === section.id));
			await assert.rejects(deleteUpload(uploaded.name), (error: unknown) => error instanceof Error && 'status' in error && error.status === 409);
			assert.ok((await stat(path.join(UPLOAD_DIR, uploaded.name))).isFile());
		} finally { await rm(path.join(UPLOAD_DIR, uploaded.name), { force: true }); }
	}));
});

it('enforces section API authorization, bounded JSON and explicit sync confirmation', async () => isolated(async () => {
	const { GET, POST } = await import('../src/pages/cms/api/builder/sections/index.ts');
	const { PUT } = await import('../src/pages/cms/api/builder/sections/[id].ts');
	const { POST: sync } = await import('../src/pages/cms/api/builder/sections/[id]/sync.ts');
	const request = (body: unknown) => new Request('http://local/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	const contributor = { cmsUser: { role: 'contributor' } };
	const subscriber = { cmsUser: { role: 'subscriber' } };
	assert.equal((await POST({ locals: subscriber, request: request({ name: 'x', node: sectionNode() }) } as never)).status, 403);
	const created = await POST({ locals: contributor, request: request({ name: 'Footer', node: sectionNode() }) } as never);
	assert.equal(created.status, 201);
	const { section } = await created.json();
	assert.equal((await GET({ locals: subscriber } as never)).status, 403);
	assert.equal((await sync({ locals: contributor, params: { id: section.id }, request: request({ expectedRevision: 1 }) } as never)).status, 400);
	assert.equal((await sync({ locals: subscriber, params: { id: section.id }, request: request({ expectedRevision: 1, confirm: true }) } as never)).status, 403);
	const tooLarge = await PUT({ locals: contributor, params: { id: section.id }, request: request({ expectedRevision: 1, node: 'x'.repeat(160_001) }) } as never);
	assert.equal(tooLarge.status, 413);
	assert.equal((await tooLarge.json()).code, 'payload_too_large');
}));
