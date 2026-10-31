import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { executeDocumentCommand, type DocumentCommand } from '../src/lib/builder/commands.ts';
import { commitValidatedDocument, createDocumentHistory, redoDocument, undoDocument } from '../src/lib/builder/history.ts';
import { addNode, insertDocumentFragment, traversePageNodes } from '../src/lib/builder/operations.ts';

function documents() {
	let page = createEmptyPageDocument('placement-page', 'صفحهٔ اصلی');
	page = addNode(page, 'Container', { id: 'node_original_one' });
	page = addNode(page, 'Heading', { id: 'node_original_child', parentId: 'node_original_one' });
	page = addNode(page, 'Container', { id: 'node_original_two' });
	let fragment = createEmptyPageDocument('placement-fragment', 'بخش');
	fragment = addNode(fragment, 'Container', { id: 'node_fragment_root' });
	fragment = addNode(fragment, 'Heading', { id: 'node_fragment_child', parentId: 'node_fragment_root' });
	return { page, fragment };
}
const ids = (document: ReturnType<typeof createEmptyPageDocument>) => {
	const all: string[] = [];
	traversePageNodes(document, (node) => all.push(node.id));
	return all;
};

describe('placing reusable sections', () => {
	it('inserts before and after a root section as one independent undoable command', () => {
		const { page, fragment } = documents();
		const initial = structuredClone(page);
		const result = executeDocumentCommand(page, { type: 'insert-fragment', fragment, targetId: 'node_original_one', placement: 'after' });
		assert.ok(result.ok);
		assert.deepEqual(page, initial);
		assert.deepEqual(result.document.nodes.map((node) => node.id === result.selectedId ? 'inserted' : node.id), ['node_original_one', 'inserted', 'node_original_two']);
		assert.ok(ids(result.document).filter((id) => !ids(page).includes(id)).every((id) => !ids(fragment).includes(id)));
		assert.equal(result.document.themeId, page.themeId);
		assert.equal(result.document.title, page.title);
		let history = createDocumentHistory(page);
		history = commitValidatedDocument(history, result.document);
		assert.deepEqual(undoDocument(history).present, page);
		assert.deepEqual(redoDocument(undoDocument(history)).present, result.document);
		const before = executeDocumentCommand(page, { type: 'insert-fragment', fragment, targetId: 'node_original_one', placement: 'before' });
		assert.ok(before.ok);
		assert.equal(before.document.nodes[0].id, before.selectedId);
		assert.equal(before.document.nodes[1].id, 'node_original_one');
	});

	it('supports explicit nested and legacy placements without changing existing behavior', () => {
		const { page, fragment } = documents();
		const nested = executeDocumentCommand(page, { type: 'insert-fragment', fragment, targetId: 'node_original_child', placement: 'before' });
		assert.ok(nested.ok);
		const first = nested.document.nodes[0];
		assert.equal(first.type, 'Container');
		if (first.type === 'Container') assert.deepEqual(first.children.map((node) => node.id === nested.selectedId ? 'inserted' : node.id), ['inserted', 'node_original_child']);
		const inside = executeDocumentCommand(page, { type: 'insert-fragment', fragment, targetId: 'node_original_one', placement: 'inside' });
		const legacy = executeDocumentCommand(page, { type: 'insert-fragment', fragment, targetId: 'node_original_one' });
		assert.ok(inside.ok && legacy.ok);
		assert.equal(inside.document.nodes.length, 2);
		assert.equal(legacy.document.nodes.length, 2);
		const root = executeDocumentCommand(page, { type: 'insert-fragment', fragment, targetId: null });
		assert.ok(root.ok);
		assert.equal(root.document.nodes.at(-1)?.id, root.selectedId);
	});

	it('fails closed for stale targets, invalid placements, leaf containers and repeated IDs', () => {
		const { page, fragment } = documents();
		for (const command of [
			{ type: 'insert-fragment', fragment, targetId: 'node_missing_target', placement: 'after' },
			{ type: 'insert-fragment', fragment, targetId: '' },
			{ type: 'insert-fragment', fragment, targetId: null, placement: 'before' },
			{ type: 'insert-fragment', fragment, targetId: 'node_original_child', placement: 'inside' },
			{ type: 'insert-fragment', fragment, targetId: 'node_original_one', placement: 'somewhere' },
		] as unknown as DocumentCommand[]) {
			const result = executeDocumentCommand(page, command);
			assert.equal(result.ok, false);
		}
		assert.throws(() => insertDocumentFragment(page, fragment, null, () => 'node_original_one'), /unique component ID/);
		assert.deepEqual(ids(page), ['node_original_one', 'node_original_child', 'node_original_two']);
	});
});
