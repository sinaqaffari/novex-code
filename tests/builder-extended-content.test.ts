import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectDocumentAssets } from '../src/lib/builder/assets.ts';
import { executeDocumentCommand } from '../src/lib/builder/commands.ts';
import { diagnosePageDocument } from '../src/lib/builder/diagnostics.ts';
import { createEmptyPageDocument, exportPageDocument, importPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { videoEmbedUrl } from '../src/lib/builder/extended-content.ts';
import { commitDocument, createDocumentHistory, redoDocument, undoDocument } from '../src/lib/builder/history.ts';
import { addNode, findNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { compilePageDocument, preparePagePublication } from '../src/lib/builder/publishing.ts';
import { COMPONENT_REGISTRY, normalizeProps } from '../src/lib/builder/registry.ts';
import { listSiteKits, validateSiteKit } from '../src/lib/builder/site-kits.ts';
import { listBuilderAssetUsages, publishPage, saveBuilderTemplate, saveDraftPage } from '../src/lib/builder/store.ts';
import { deleteUpload, saveUpload, UPLOAD_DIR } from '../src/lib/cms/media.ts';
import type { AccordionItem, BuilderComponentType, GalleryItem, VideoEmbedProps } from '../src/lib/builder/types.ts';

const galleryItem = (id: string, src = '', alt = '', caption = ''): GalleryItem => ({ id, src, alt, caption });
const accordionItem = (id: string, title = '', body = ''): AccordionItem => ({ id, title, body });
const newTypes = ['Blockquote', 'Accordion', 'ImageGallery', 'VideoEmbed'] as const;

function pageWithExtendedNodes() {
	let document = addNode(createEmptyPageDocument('extended', 'Extended'), 'Container', { id: 'node_container1' });
	for (const [index, type] of newTypes.entries()) document = addNode(document, type, { id: `node_extended${index}`, parentId: 'node_container1' });
	return document;
}

describe('native extended content registry and document compatibility', () => {
	it('registers complete versioned definitions, supports nesting and preserves round-trip content', () => {
		let document = pageWithExtendedNodes();
		for (const [index, type] of newTypes.entries()) {
			const definition = COMPONENT_REGISTRY[type];
			assert.equal(definition.version, 1);
			assert.ok(definition.label && definition.documentation && definition.previewRenderer && definition.productionRenderer);
			assert.ok(COMPONENT_REGISTRY.Container.allowedChildren.includes(type));
			assert.equal(findNode(document.nodes, `node_extended${index}`)?.componentVersion, 1);
		}
		document = updateNodeProps(document, 'node_extended0', { text: '«متن» <script>alert(1)</script>', author: 'مشتری', role: 'مدیر' });
		document = updateNodeProps(document, 'node_extended1', { items: [accordionItem('item_first1', 'پرسش', 'پاسخ')] });
		document = updateNodeProps(document, 'node_extended2', { columns: 4, items: [galleryItem('item_first1', 'media://assets/blog-placeholder-about.jpg', 'شرح', 'نمونه')] });
		document = updateNodeProps(document, 'node_extended3', { provider: 'vimeo', youtubeId: 'dQw4w9WgXcQ', vimeoId: '123456789', title: 'معرفی' });
		assert.deepEqual(importPageDocument(exportPageDocument(document), document.slug), document);
		assert.deepEqual(validatePageDocument(document), document);
		const compiled = compilePageDocument(document);
		assert.equal(compiled.ok, true);
		if (compiled.ok) assert.deepEqual(compiled.page.components, ['Container', ...newTypes]);
		const wrongVersion = structuredClone(document);
		const bad = findNode(wrongVersion.nodes, 'node_extended1')!;
		bad.componentVersion = 99;
		assert.throws(() => validatePageDocument(wrongVersion), /version/i);
	});
	it('keeps collection defaults isolated between newly-created nodes', () => {
		let document = addNode(createEmptyPageDocument('isolation'), 'Accordion', { id: 'node_accordion1' });
		document = addNode(document, 'Accordion', { id: 'node_accordion2' });
		const changed = updateNodeProps(document, 'node_accordion1', { items: [accordionItem('item_custom1', 'تغییر', 'پاسخ')] });
		const other = findNode(changed.nodes, 'node_accordion2');
		assert.equal(other?.type, 'Accordion');
		if (other?.type === 'Accordion') assert.equal(other.props.items[0].id, 'item_default1');
		assert.equal(COMPONENT_REGISTRY.Accordion.defaultProps.items[0].id, 'item_default1');
	});
});

describe('extended content validation and security', () => {
	it('rejects malformed, oversized, duplicate and unknown collection data', () => {
		const malformed: Array<[BuilderComponentType, Record<string, unknown>]> = [
			['Accordion', { items: 'bad' }],
			['Accordion', { items: [accordionItem('bad', 'x', 'y')] }],
			['Accordion', { items: [accordionItem('item_dupe1'), accordionItem('item_dupe1')] }],
			['Accordion', { items: Array.from({ length: 25 }, (_, i) => accordionItem(`item_${i.toString().padStart(4, '0')}`)) }],
			['Accordion', { items: [{ ...accordionItem('item_valid1'), html: '<script>' }] }],
			['Accordion', { items: [accordionItem('item_valid1', 'x'.repeat(241))] }],
			['ImageGallery', { items: [{ ...galleryItem('item_valid1'), onerror: 'evil()' }] }],
			['ImageGallery', { items: [galleryItem('item_valid1', '', 'a'.repeat(241))] }],
			['ImageGallery', { items: [galleryItem('item_valid1', 'data:image/png;base64,AA')] }],
			['ImageGallery', { items: [galleryItem('item_valid1', '//evil.example/a.png')] }],
			['ImageGallery', { items: [galleryItem('item_valid1', 'javascript:alert(1)')] }],
			['ImageGallery', { items: [galleryItem('item_valid1', 'https://user:pass@example.com/a.png')] }],
			['ImageGallery', { columns: 99 }],
			['Blockquote', { author: 'a'.repeat(161) }],
		];
		for (const [type, props] of malformed) assert.throws(() => normalizeProps(type, props), `${type}: ${JSON.stringify(props).slice(0, 120)}`);
		assert.equal(normalizeProps('Accordion', { items: [] }).items.length, 0);
		assert.equal(normalizeProps('ImageGallery', { items: [] }).items.length, 0);
	});
	it('only constructs fixed-host embed URLs from valid provider IDs', () => {
		const props: VideoEmbedProps = { provider: 'youtube', youtubeId: 'dQw4w9WgXcQ', vimeoId: '123456789', title: 'Video' };
		assert.equal(videoEmbedUrl(props), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
		assert.equal(videoEmbedUrl({ ...props, provider: 'vimeo' }), 'https://player.vimeo.com/video/123456789');
		assert.equal(videoEmbedUrl({ ...props, youtubeId: 'evil/?x=1' }), null);
		for (const patch of [
			{ youtubeId: 'https://youtube.com/watch?v=dQw4w9WgXcQ' },
			{ youtubeId: 'short' }, { vimeoId: '123456/../evil' }, { vimeoId: '012345' },
			{ provider: 'https://evil.example' }, { title: 'x'.repeat(161) },
		]) assert.throws(() => normalizeProps('VideoEmbed', { ...props, ...patch }));
		assert.equal(videoEmbedUrl({ ...props, youtubeId: '' }), null);
	});
	it('fails atomically through commands on unsafe updates', () => {
		const document = pageWithExtendedNodes();
		const before = JSON.stringify(document);
		const result = executeDocumentCommand(document, { type: 'props', id: 'node_extended2', patch: { items: [galleryItem('item_valid1', 'javascript:alert(1)')] } });
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error.code, 'invalid_document');
		assert.equal(JSON.stringify(document), before);
	});
});

describe('collection operations and history', () => {
	it('keeps stable IDs through edits, independent coalescing groups, reorder, undo and redo', () => {
		const original = addNode(createEmptyPageDocument('collection-history'), 'Accordion', { id: 'node_accordion1' });
		const firstItems = [accordionItem('item_aaaa1', 'A'), accordionItem('item_bbbb2', 'B')];
		const first = executeDocumentCommand(original, { type: 'props', id: 'node_accordion1', patch: { items: firstItems } });
		assert.ok(first.ok); if (!first.ok) return;
		let history = commitDocument(createDocumentHistory(original), first.document, 60, { selectionAfter: 'node_accordion1' });
		const edit1 = executeDocumentCommand(first.document, { type: 'props', id: 'node_accordion1', patch: { items: [accordionItem('item_aaaa1', 'Ax'), firstItems[1]] } });
		assert.ok(edit1.ok); if (!edit1.ok) return;
		history = commitDocument(history, edit1.document, 60, { group: 'item_aaaa1:title', now: 100 });
		const edit2 = executeDocumentCommand(edit1.document, { type: 'props', id: 'node_accordion1', patch: { items: [accordionItem('item_aaaa1', 'Axy'), firstItems[1]] } });
		assert.ok(edit2.ok); if (!edit2.ok) return;
		history = commitDocument(history, edit2.document, 60, { group: 'item_aaaa1:title', now: 200 });
		assert.equal(history.past.length, 2);
		const reorder = executeDocumentCommand(edit2.document, { type: 'props', id: 'node_accordion1', patch: { items: [firstItems[1], accordionItem('item_aaaa1', 'Axy')] } });
		assert.ok(reorder.ok); if (!reorder.ok) return;
		history = commitDocument(history, reorder.document, 60);
		assert.deepEqual(undoDocument(history).present, edit2.document);
		const undone = undoDocument(undoDocument(history));
		assert.deepEqual(undone.present, first.document);
		assert.deepEqual(redoDocument(redoDocument(undone)).present, reorder.document);
	});
});

describe('gallery assets across publication, diagnostics and kits', () => {
	it('scans every gallery item, checks missing files once and reports useful item paths', async () => {
		let document = addNode(createEmptyPageDocument('gallery-assets'), 'ImageGallery', { id: 'node_gallery01' });
		document = updateNodeProps(document, 'node_gallery01', { items: [
			galleryItem('item_aaaa1', 'media://uploads/missing.png', ''),
			galleryItem('item_bbbb2', '/media/uploads/missing.png?width=800', 'alt'),
			galleryItem('item_cccc3', 'https://example.com/external.png', 'alt'),
			galleryItem('item_dddd4'),
		] });
		const refs = collectDocumentAssets(document);
		assert.deepEqual(refs.map((ref) => ref.identity), ['uploads/missing.png', 'uploads/missing.png']);
		assert.deepEqual(refs.map((ref) => ref.property), ['props.items[0].src', 'props.items[1].src']);
		const checked: string[] = [];
		const compiled = await preparePagePublication(document, document.slug, async (file) => { checked.push(file); return false; });
		assert.deepEqual(checked, ['uploads/missing.png']);
		assert.equal(compiled.ok, false);
		if (!compiled.ok) assert.deepEqual(compiled.diagnostics.map((issue) => issue.path), ['node:node_gallery01.props.items[0].src', 'node:node_gallery01.props.items[1].src']);
		const diagnostics = await diagnosePageDocument(document, document.slug, async () => false);
		for (const code of ['empty-image', 'missing-alt', 'missing-media', 'external-image']) assert.ok(diagnostics.some((issue) => issue.code === code && issue.nodeId === 'node_gallery01'), code);
	});
	it('requires every gallery kit image to be a declared local asset', () => {
		const kit = listSiteKits()[0];
		let document = addNode(kit.pages[0].document, 'ImageGallery', { id: 'node_gallerykit' });
		document = updateNodeProps(document, 'node_gallerykit', { items: [galleryItem('item_aaaa1', 'media://assets/blog-placeholder-about.jpg', 'عکس')] });
		const candidate = { ...kit, requiredComponents: [...kit.requiredComponents, 'ImageGallery' as const], pages: [{ ...kit.pages[0], document }, ...kit.pages.slice(1)] };
		assert.doesNotThrow(() => validateSiteKit(candidate));
		const other = updateNodeProps(document, 'node_gallerykit', { items: [galleryItem('item_aaaa1', 'https://example.com/a.png')] });
		assert.throws(() => validateSiteKit({ ...candidate, pages: [{ ...kit.pages[0], document: other }, ...kit.pages.slice(1)] }), /دارایی/);
	});
	it('protects a gallery upload in drafts, publications, history and templates from deletion', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-gallery-assets-'));
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64');
		const uploaded = await saveUpload(new File([png], 'gallery-test.png', { type: 'image/png' }));
		try {
			let document = addNode(createEmptyPageDocument('gallery-usage'), 'ImageGallery', { id: 'node_gallery01' });
			document = updateNodeProps(document, 'node_gallery01', { items: [galleryItem('item_aaaa1', `media://uploads/${uploaded.name}`, 'عکس')] });
			await saveDraftPage({ slug: document.slug, expectedRevision: 0, document });
			await publishPage({ slug: document.slug, expectedRevision: 1, document });
			await saveBuilderTemplate({ name: 'Gallery template', document });
			const uses = await listBuilderAssetUsages(`uploads/${uploaded.name}`);
			assert.deepEqual(new Set(uses.map((usage) => usage.scope)), new Set(['draft', 'published', 'revision', 'template']));
			await assert.rejects(deleteUpload(uploaded.name), (error: unknown) => error instanceof Error && 'status' in error && error.status === 409);
			assert.ok((await stat(path.join(UPLOAD_DIR, uploaded.name))).isFile());
		} finally {
			if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
			await rm(path.join(UPLOAD_DIR, uploaded.name), { force: true });
			await rm(dir, { recursive: true, force: true });
		}
	});
});
