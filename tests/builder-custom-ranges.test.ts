import { diagnosePageDocument } from '../src/lib/builder/diagnostics.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createEmptyPageDocument, exportPageDocument, importPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { executeDocumentCommand } from '../src/lib/builder/commands.ts';
import { createDocumentHistory, commitDocument, undoDocument, redoDocument } from '../src/lib/builder/history.ts';
import { addNode, findNode, insertDocumentFragment, setNodeHiddenAtBreakpoint, updateNodeProps, updateNodeStyles } from '../src/lib/builder/operations.ts';
import { breakpointRanges, resolveNodeStyles } from '../src/lib/builder/responsive.ts';
import { buildResponsiveCss } from '../src/lib/builder/render.ts';
import { createSharedSection, getDraftPage, installDraftPages, saveDraftPage, synchronizeSharedSection, updateInstalledKitDrafts, updateSharedSection } from '../src/lib/builder/store.ts';
import { sectionFragment } from '../src/lib/builder/shared-sections.ts';
import { listSiteKits, prepareSiteKit } from '../src/lib/builder/site-kits.ts';
import type { ContainerNode, PageDocument } from '../src/lib/builder/types.ts';

const ranges = { tablet: 1023, mobile: 767, custom: [
	{ id: 'bp_wide' as const, label: 'Wide', maxWidth: 1400 },
	{ id: 'bp_compact' as const, label: 'Compact', maxWidth: 850 },
	{ id: 'bp_small' as const, label: 'Small', maxWidth: 400 },
] };

function customPage(slug = 'range-test'): PageDocument {
	let doc = validatePageDocument({ ...createEmptyPageDocument(slug), breakpoints: ranges });
	doc = addNode(doc, 'Container', { id: 'node_container01' });
	doc = addNode(doc, 'Heading', { parentId: 'node_container01', id: 'node_heading001' });
	doc = updateNodeStyles(doc, 'node_heading001', { width: '80%' }, 'bp_wide');
	doc = updateNodeStyles(doc, 'node_heading001', { height: '30px' }, 'tablet');
	doc = updateNodeStyles(doc, 'node_heading001', { width: '70%' }, 'bp_compact');
	doc = updateNodeStyles(doc, 'node_heading001', { height: '40px' }, 'mobile');
	return setNodeHiddenAtBreakpoint(doc, 'node_heading001', 'bp_compact', true);
}

async function isolated(run: (file: string) => Promise<void>) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-custom-ranges-'));
	const old = process.env.BUILDER_DATA_FILE;
	const file = path.join(dir, 'pages.json');
	process.env.BUILDER_DATA_FILE = file;
	try { await run(file); } finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
}

describe('named responsive breakpoints', () => {
	it('migrates v3 without changing the input and rejects v4 fields disguised as v3', () => {
		const legacy = { ...createEmptyPageDocument('legacy-three'), schemaVersion: 3, breakpoints: { tablet: 900, mobile: 500 } };
		const migrated = validatePageDocument(legacy);
		assert.equal(migrated.schemaVersion, 5);
		assert.equal(legacy.schemaVersion, 3);
		assert.deepEqual(migrated.breakpoints, legacy.breakpoints);
		assert.throws(() => validatePageDocument({ ...legacy, breakpoints: ranges }), /Unsupported property/);
		assert.throws(() => validatePageDocument({ ...customPage(), schemaVersion: 3 }), /Unsupported property/);
	});
	it('validates unique bounded IDs and widths, allowed keys and declared overrides', () => {
		const doc = createEmptyPageDocument('validate-ranges');
		const bad = [
			[{ id: '__proto__', label: 'Bad', maxWidth: 1200 }],
			[{ id: 'bp_x', label: '', maxWidth: 1200 }],
			[{ id: 'bp_x', label: 'X', maxWidth: 1023 }],
			[{ id: 'bp_x', label: 'X', maxWidth: 1200 }, { id: 'bp_x', label: 'Y', maxWidth: 1300 }],
			[{ id: 'bp_x', label: 'X', maxWidth: 1200, extra: true }],
			Array.from({ length: 9 }, (_, i) => ({ id: `bp_${i}`, label: 'X', maxWidth: 1100 + i })),
		];
		for (const custom of bad) assert.throws(() => validatePageDocument({ ...doc, breakpoints: { tablet: 1023, mobile: 767, custom } }));
		const withNode = addNode(doc, 'Heading', { id: 'node_heading001' });
		assert.throws(() => updateNodeStyles(withNode, 'node_heading001', { width: '50%' }, 'bp_undeclared'));
	});
	it('round-trips and cascades custom ranges in descending order with independent visibility', () => {
		const doc = customPage();
		assert.deepEqual(importPageDocument(exportPageDocument(doc)), doc);
		assert.deepEqual(breakpointRanges(doc).map((entry) => entry.id), ['desktop', 'bp_wide', 'tablet', 'bp_compact', 'mobile', 'bp_small']);
		const node = findNode(doc.nodes, 'node_heading001')!;
		assert.deepEqual(resolveNodeStyles(node, 'bp_wide', doc), { width: '80%' });
		assert.deepEqual(resolveNodeStyles(node, 'bp_compact', doc), { width: '70%', height: '30px' });
		assert.deepEqual(resolveNodeStyles(node, 'bp_small', doc), { width: '70%', height: '40px' });
		const css = buildResponsiveCss(doc);
		assert.match(css, /max-width:1400px.*width:80%/);
		assert.match(css, /max-width:850px.*width:70%.*display:none/);
		assert.match(css, /max-width:767px.*display:block/);
		assert.match(css, /max-width:400px.*display:block/);
		assert.ok(css.indexOf('max-width:1400px') < css.indexOf('max-width:850px'));
	});
	it('does not report a node hidden everywhere when a named range shows it', async () => {
		let doc = addNode(createEmptyPageDocument('range-diagnostics'), 'Heading', { id: 'node_heading001' });
		doc = validatePageDocument({ ...doc, breakpoints: { tablet: 1023, mobile: 767, custom: [{ id: 'bp_custom', label: 'Custom', maxWidth: 850 }] } });
		for (const range of ['desktop', 'tablet', 'mobile'] as const) doc = setNodeHiddenAtBreakpoint(doc, 'node_heading001', range, true);
		assert.equal((await diagnosePageDocument(doc, doc.slug, async () => true)).some((item) => item.code === 'hidden-everywhere'), false);
		doc = setNodeHiddenAtBreakpoint(doc, 'node_heading001', 'bp_custom', true);
		assert.equal((await diagnosePageDocument(doc, doc.slug, async () => true)).some((item) => item.code === 'hidden-everywhere'), true);
	});
	it('does not silently discard overrides, and explicit deletion is undoable', () => {
		const doc = customPage();
		const without = { ...ranges, custom: ranges.custom.filter((entry) => entry.id !== 'bp_compact') };
		assert.throws(() => validatePageDocument({ ...doc, breakpoints: without }), /unsupported property/i);
		const removed = executeDocumentCommand(doc, { type: 'remove-breakpoint', id: 'bp_compact' });
		assert.equal(removed.ok, true);
		if (!removed.ok) return;
		assert.equal(findNode(removed.document.nodes, 'node_heading001')?.responsiveStyles?.bp_compact, undefined);
		const history = commitDocument(createDocumentHistory(doc), removed.document);
		assert.deepEqual(undoDocument(history).present, doc);
		assert.deepEqual(redoDocument(undoDocument(history)).present, removed.document);
	});
	it('merges used fragment definitions and refuses conflicting semantics without changing the target', () => {
		const fragment = customPage('fragment');
		const target = createEmptyPageDocument('target');
		const merged = insertDocumentFragment(target, fragment, null).document;
		assert.deepEqual(merged.breakpoints?.custom?.map((item) => item.id), ['bp_wide', 'bp_compact']);
		assert.equal(target.breakpoints, undefined);
		const conflicting = validatePageDocument({ ...target, breakpoints: { tablet: 1023, mobile: 767, custom: [{ id: 'bp_wide', label: 'Other', maxWidth: 1300 }] } });
		assert.throws(() => insertDocumentFragment(conflicting, fragment, null), /conflicting width/);
		const anchored = addNode(target, 'Container', { id: 'node_anchor_range' });
		const positioned = executeDocumentCommand(anchored, { type: 'insert-fragment', fragment, targetId: 'node_anchor_range', placement: 'before' });
		assert.ok(positioned.ok);
		assert.deepEqual(positioned.document.breakpoints?.custom?.map((item) => item.id), ['bp_wide', 'bp_compact']);
		assert.equal(positioned.document.nodes[1].id, 'node_anchor_range');
		const anchoredConflict = addNode(conflicting, 'Container', { id: 'node_anchor_range' });
		const rejected = executeDocumentCommand(anchoredConflict, { type: 'insert-fragment', fragment, targetId: 'node_anchor_range', placement: 'after' });
		assert.equal(rejected.ok, false);
		assert.equal(anchoredConflict.nodes.length, 1);
	});
	it('retains custom-range semantics in shared sections and syncs safely', async () => isolated(async () => {
		const source = customPage('source');
		const node = source.nodes[0] as ContainerNode;
		const section = await createSharedSection('With ranges', node, source.breakpoints);
		const page = insertDocumentFragment(createEmptyPageDocument('destination'), sectionFragment(section), null).document;
		assert.deepEqual(page.breakpoints?.custom?.map((entry) => entry.id), ['bp_wide', 'bp_compact']);
		await saveDraftPage({ slug: page.slug, expectedRevision: 0, document: page });
		const edited = updateNodeProps(source, 'node_heading001', { text: 'Updated' });
		await updateSharedSection(section.id, 1, edited.nodes[0], edited.breakpoints);
		await synchronizeSharedSection(section.id, 2);
		const saved = (await getDraftPage(page.slug)).draft;
		const root = saved.nodes[0] as ContainerNode;
		assert.equal(root.sharedSection?.revision, 2);
		assert.equal(root.children[0].type === 'Heading' && root.children[0].props.text, 'Updated');
	}));
	it('recognizes pristine schema-v4 kit hashes and preserves named ranges after migration', async () => isolated(async (file) => {
		const kit = listSiteKits()[0];
		const source = { id: kit.id, version: kit.version, prefix: 'v4kit' };
		const docs = prepareSiteKit(kit, source.prefix).map((doc) => validatePageDocument({ ...doc, breakpoints: ranges }));
		await installDraftPages(docs, source);
		const db = JSON.parse(await readFile(file, 'utf8'));
		for (const page of Object.values(db.pages) as Array<{ draft: { schemaVersion: number }; revisions: Array<{ document: { schemaVersion: number } }>; installation: { baselineHash: string; baselineDocument?: unknown } }>) {
			page.draft.schemaVersion = 4;
			for (const revision of page.revisions) revision.document.schemaVersion = 4;
			page.installation.baselineHash = createHash('sha256').update(JSON.stringify(page.draft)).digest('hex');
			delete page.installation.baselineDocument;
		}
		await writeFile(file, JSON.stringify(db));
		const next = prepareSiteKit({ ...kit, version: '1.2.0' }, source.prefix);
		await updateInstalledKitDrafts(next, { ...source, version: '1.2.0' });
		assert.equal((await getDraftPage(docs[0].slug)).installation?.version, '1.2.0');
	}));
	it('recognizes pristine schema-v3 kit hashes after migration', async () => isolated(async (file) => {
		const kit = listSiteKits()[0];
		const source = { id: kit.id, version: kit.version, prefix: 'v3kit' };
		const docs = prepareSiteKit(kit, source.prefix);
		await installDraftPages(docs, source);
		const db = JSON.parse(await readFile(file, 'utf8'));
		for (const page of Object.values(db.pages) as Array<{ draft: { schemaVersion: number }; revisions: Array<{ document: { schemaVersion: number } }>; installation: { baselineHash: string; baselineDocument?: unknown } }>) {
			page.draft.schemaVersion = 3;
			for (const revision of page.revisions) revision.document.schemaVersion = 3;
			page.installation.baselineHash = createHash('sha256').update(JSON.stringify(page.draft)).digest('hex');
			delete page.installation.baselineDocument;
		}
		await writeFile(file, JSON.stringify(db));
		const next = prepareSiteKit({ ...kit, version: '1.2.0' }, source.prefix);
		await updateInstalledKitDrafts(next, { ...source, version: '1.2.0' });
		assert.equal((await getDraftPage(docs[0].slug)).installation?.version, '1.2.0');
	}));
});
