import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmptyPageDocument, migratePageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { executeDocumentCommand } from '../src/lib/builder/commands.ts';
import { validateDocumentWithDiagnostics } from '../src/lib/builder/diagnostics.ts';
import { addNode, clonePageDocument, duplicateNode, findNode, insertDocumentFragment, traversePageNodes } from '../src/lib/builder/operations.ts';
import { commitDocument, createDocumentHistory, redoDocument, undoDocument } from '../src/lib/builder/history.ts';

describe('document migrations and commands', () => {
	it('migrates sequentially, is idempotent and never discards unknown legacy data', () => {
		const legacy = { schemaVersion: 0, slug: 'legacy', title: 'Old', blocks: [{ id: 'node_heading01', type: 'heading', props: { text: 'old' } }] };
		const first = validatePageDocument(legacy);
		assert.equal(first.schemaVersion, 5);
		assert.deepEqual(migratePageDocument(first), first);
		assert.equal(legacy.schemaVersion, 0);
		assert.throws(() => validatePageDocument({ ...legacy, lostField: 'keep me' }), /Unsupported property/);
		assert.throws(() => validatePageDocument({ ...legacy, nodes: [] }), /both nodes and blocks/);
		assert.throws(() => validatePageDocument({ ...legacy, blocks: [{ ...legacy.blocks[0], legacyField: 'keep me' }] }), /Unsupported property/);
	});
	it('returns structured diagnostics for invalid types, versions and duplicate IDs', () => {
		const page = createEmptyPageDocument('diagnostics');
		const unknown = validateDocumentWithDiagnostics({ ...page, nodes: [{ id: 'node_unknown01', type: 'Missing', componentVersion: 1, props: {} }] });
		assert.equal(unknown.ok, false);
		if (unknown.ok) throw new Error('expected failure');
		assert.equal(unknown.diagnostics[0].code, 'unknown_component');
		assert.equal(unknown.diagnostics[0].severity, 'error');
		assert.equal(unknown.diagnostics[0].path, 'nodes[0].type');
		const version = validateDocumentWithDiagnostics({ ...page, schemaVersion: 999 });
		assert.equal(version.ok, false);
		if (!version.ok) assert.equal(version.diagnostics[0].code, 'unsupported_document_version');
	});
	it('executes atomic mutations and leaves the original untouched on failure', () => {
		const original = createEmptyPageDocument('commands');
		const insert = executeDocumentCommand(original, { type: 'insert', component: 'Heading', id: 'node_heading01', props: { text: 'Hello' } });
		assert.equal(insert.ok, true);
		if (!insert.ok) throw new Error('insert failed');
		assert.equal(insert.selectedId, 'node_heading01');
		assert.equal(original.nodes.length, 0);
		const invalid = executeDocumentCommand(insert.document, { type: 'props', id: 'node_heading01', patch: { level: 99 } });
		assert.equal(invalid.ok, false);
		if (!invalid.ok) assert.equal(invalid.error.code, 'invalid_document');
		assert.equal(findNode(insert.document.nodes, 'node_heading01')?.type, 'Heading');
		const copy = clonePageDocument(insert.document);
		assert.notEqual(copy.nodes[0], insert.document.nodes[0]);
		const visited: string[] = [];
		traversePageNodes(copy, (node) => visited.push(node.id));
		assert.deepEqual(visited, ['node_heading01']);
	});
	it('retries generated ID collisions and bounds broken ID generators', () => {
		const doc = addNode(createEmptyPageDocument('collision'), 'Heading', { id: 'node_heading01' });
		const values = ['node_heading01', 'node_heading02'];
		const duplicated = duplicateNode(doc, 'node_heading01', () => values.shift()!);
		assert.equal(duplicated.newId, 'node_heading02');
		assert.throws(() => duplicateNode(doc, 'node_heading01', () => 'node_heading01'), /unique component ID/);
		assert.throws(() => insertDocumentFragment(doc, doc, null, () => 'node_heading01'), /unique component ID/);
	});
});

describe('editor history boundaries', () => {
	it('coalesces consecutive control edits and restores selection on undo and redo', () => {
		const initial = createEmptyPageDocument('history');
		const first = addNode(initial, 'Heading', { id: 'node_heading01' });
		let history = createDocumentHistory(initial);
		history = commitDocument(history, first, 60, { selectionBefore: null, selectionAfter: 'node_heading01' });
		const one = executeDocumentCommand(first, { type: 'props', id: 'node_heading01', patch: { text: 'A' } });
		if (!one.ok) throw new Error('failed');
		history = commitDocument(history, one.document, 60, { group: 'text', now: 100, selectionBefore: 'node_heading01' });
		const two = executeDocumentCommand(one.document, { type: 'props', id: 'node_heading01', patch: { text: 'AB' } });
		if (!two.ok) throw new Error('failed');
		history = commitDocument(history, two.document, 60, { group: 'text', now: 200, selectionBefore: 'node_heading01' });
		assert.equal(history.past.length, 2);
		history = undoDocument(history, 'node_heading01');
		assert.equal(history.presentSelection, 'node_heading01');
		assert.deepEqual(history.present, first);
		history = undoDocument(history, history.presentSelection);
		assert.equal(history.presentSelection, null);
		history = redoDocument(history, null);
		assert.equal(history.presentSelection, 'node_heading01');
		history = redoDocument(history, history.presentSelection);
		assert.deepEqual(history.present, two.document);
	});
	it('does not coalesce across timeout, structural operations or an undo', () => {
		let history = createDocumentHistory(createEmptyPageDocument('history-two'));
		const a = addNode(history.present, 'Heading', { id: 'node_heading01' });
		history = commitDocument(history, a, 2, { group: 'x', now: 0 });
		const b = addNode(a, 'Text', { id: 'node_text00001' });
		history = commitDocument(history, b, 2, { group: 'x', now: 1001 });
		assert.equal(history.past.length, 2);
		history = undoDocument(history);
		history = commitDocument(history, b, 2, { group: 'x', now: 1002 });
		assert.equal(history.future.length, 0);
	});
});

it('routes fragment insertion and whole-document replacement through the validated command dispatcher', () => {
	const base = createEmptyPageDocument('replacement');
	const fragment = addNode(createEmptyPageDocument('fragment'), 'Text', { id: 'node_textsource' });
	const inserted = executeDocumentCommand(base, { type: 'insert-fragment', fragment, targetId: null });
	assert.equal(inserted.ok, true);
	if (!inserted.ok) return;
	assert.equal(inserted.document.nodes.length, 1);
	assert.notEqual(inserted.selectedId, 'node_textsource');
	const invalid = executeDocumentCommand(inserted.document, { type: 'replace-document', document: { ...inserted.document, id: 'another-page' } });
	assert.equal(invalid.ok, false);
	assert.equal(inserted.document.nodes.length, 1);
	const replaced = executeDocumentCommand(inserted.document, { type: 'replace-document', document: base });
	assert.equal(replaced.ok, true);
	if (replaced.ok) assert.equal(replaced.document.nodes.length, 0);
});
