import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AutosaveConflictError, AutosaveController, type AutosaveStatus } from '../src/lib/builder/autosave.ts';
import { createEmptyPageDocument, serializePageDocument } from '../src/lib/builder/document.ts';
import { addNode, findNode, setNodeHiddenAtBreakpoint, updateNodeStyles } from '../src/lib/builder/operations.ts';
import { BREAKPOINT_MAX_WIDTH, explicitNodeStyle, resolveNodeStyle, resolveNodeStyles } from '../src/lib/builder/responsive.ts';
import { buildResponsiveCss, controlledNodeStyle } from '../src/lib/builder/render.ts';

describe('responsive document and rendering integration', () => {
	it('resolves desktop, tablet and mobile without materializing inherited values', () => {
		let doc = addNode(createEmptyPageDocument('responsive'), 'Heading', { id: 'node_heading01' });
		doc = updateNodeStyles(doc, 'node_heading01', { width: 'wide', marginBlockStart: 16 });
		doc = updateNodeStyles(doc, 'node_heading01', { width: 'narrow' }, 'tablet');
		doc = updateNodeStyles(doc, 'node_heading01', { marginBlockStart: 4 }, 'mobile');
		const node = findNode(doc.nodes, 'node_heading01')!;
		assert.equal(resolveNodeStyle(node, 'desktop', 'width'), 'wide');
		assert.equal(resolveNodeStyle(node, 'mobile', 'width'), 'narrow');
		assert.equal(explicitNodeStyle(node, 'mobile', 'width'), undefined);
		assert.equal(resolveNodeStyles(node, 'mobile').marginBlockStart, 4);
		doc = updateNodeStyles(doc, node.id, { marginBlockStart: undefined }, 'mobile');
		assert.equal(resolveNodeStyle(findNode(doc.nodes, node.id)!, 'mobile', 'marginBlockStart'), 16);
		assert.equal(findNode(doc.nodes, node.id)!.styles?.marginBlockStart, 16);
		assert.doesNotMatch(serializePageDocument(doc), /"marginBlockStart":4/);
	});
	it('generates responsive overrides that beat inline desktop styles', () => {
		let doc = addNode(createEmptyPageDocument('responsive'), 'Container', { id: 'node_container1' });
		doc = updateNodeStyles(doc, 'node_container1', { width: 'full', paddingBlockStart: 32 });
		doc = updateNodeStyles(doc, 'node_container1', { width: 'narrow', paddingBlockStart: 8 }, 'mobile');
		doc = setNodeHiddenAtBreakpoint(doc, 'node_container1', 'desktop', true);
		const node = findNode(doc.nodes, 'node_container1')!;
		assert.match(controlledNodeStyle(node.styles)!, /width:100%/);
		const css = buildResponsiveCss(doc);
		assert.match(css, /width:min\(100%,40rem\)!important/);
		assert.match(css, /padding-block-start:8px!important/);
		assert.match(css, /display:flex!important/);
		assert.match(css, new RegExp(`max-width:${BREAKPOINT_MAX_WIDTH.mobile}px`));
	});
	it('restores grid display for visible grid containers', () => {
		let doc = addNode(createEmptyPageDocument('grid'), 'Container', { id: 'node_container1' });
		const node = findNode(doc.nodes, 'node_container1')!;
		if (node.type !== 'Container') throw new Error('container');
		const grid = { ...node, props: { ...node.props, layout: 'grid' as const } };
		doc = { ...doc, nodes: [grid] };
		doc = setNodeHiddenAtBreakpoint(doc, node.id, 'desktop', true);
		assert.match(buildResponsiveCss(doc), /display:grid!important/);
	});
});

describe('in-flight autosave ordering', () => {
	it('does not clear a server conflict when undo returns to the old local baseline', async () => {
		const initial = createEmptyPageDocument('conflict-test');
		const modified = addNode(initial, 'Heading', { id: 'node_heading01' });
		const statuses: AutosaveStatus[] = [];
		const autosave = new AutosaveController(async () => { throw new AutosaveConflictError(); }, (status) => statuses.push(status), 60_000);
		autosave.initialize(initial);
		autosave.schedule(modified);
		await assert.rejects(autosave.flush(), AutosaveConflictError);
		autosave.schedule(initial);
		assert.equal(statuses.at(-1), 'conflict');
		assert.equal(autosave.isDirty(), true);
		await assert.rejects(autosave.flush(), AutosaveConflictError);
		autosave.cancel();
	});
	it('does not claim saved when undo returns to the baseline during a save', async () => {
		const initial = createEmptyPageDocument('save-test');
		const modified = addNode(initial, 'Heading', { id: 'node_heading01' });
		const statuses: AutosaveStatus[] = [];
		const persisted: string[] = [];
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const autosave = new AutosaveController(async (document) => {
			if (!persisted.length) { persisted.push(serializePageDocument(document)); await gate; }
			else persisted.push(serializePageDocument(document));
		}, (status) => statuses.push(status), 60_000);
		autosave.initialize(initial);
		autosave.schedule(modified);
		const first = autosave.flush();
		autosave.schedule(initial);
		assert.equal(autosave.isDirty(), true);
		assert.notEqual(statuses.at(-1), 'saved');
		const second = autosave.flush();
		release!();
		await Promise.all([first, second]);
		assert.deepEqual(persisted, [serializePageDocument(modified), serializePageDocument(initial)]);
		assert.equal(statuses.at(-1), 'saved');
		assert.equal(autosave.isDirty(), false);
		autosave.cancel();
	});
});
