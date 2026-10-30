import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmptyPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { addNode, findNode, insertDocumentFragment, updateNodeStyles } from '../src/lib/builder/operations.ts';
import { listStarterTemplates } from '../src/lib/builder/templates.ts';
import { commitDocument, createDocumentHistory, undoDocument, redoDocument } from '../src/lib/builder/history.ts';

describe('Copied section insertion', () => {
	it('inserts independently inside the selected container and preserves responsive styles', () => {
		let target = addNode(createEmptyPageDocument('target', 'عنوان'), 'Container', { id: 'node_target01' });
		target = addNode(target, 'Text', { id: 'node_existing01', parentId: 'node_target01' });
		let fragment = addNode(createEmptyPageDocument('source', 'بخش'), 'Heading', { id: 'node_source01' });
		fragment = updateNodeStyles(fragment, 'node_source01', { marginBlockStart: 16 }, 'mobile');
		const result = insertDocumentFragment(target, fragment, 'node_target01');
		const parent = findNode(result.document.nodes, 'node_target01');
		assert.ok(parent && parent.type === 'Container');
		assert.equal(parent.children.length, 2);
		const copy = parent.children[1];
		assert.notEqual(copy.id, 'node_source01');
		assert.equal(copy.responsiveStyles?.mobile?.marginBlockStart, 16);
		assert.equal(result.document.themeId, target.themeId);
		assert.equal(target.nodes[0].type === 'Container' && target.nodes[0].children.length, 1);
		assert.deepEqual(validatePageDocument(result.document), result.document);
		const history = commitDocument(createDocumentHistory(target), result.document);
		assert.deepEqual(undoDocument(history).present, target);
		assert.deepEqual(redoDocument(undoDocument(history)).present, result.document);
	});
	it('inserts after a selected leaf, or at the root when nothing is selected', () => {
		const target = addNode(createEmptyPageDocument('target', 'هدف'), 'Text', { id: 'node_target01' });
		const fragment = listStarterTemplates().find((item) => item.id === 'hero-intro')!.document;
		const result = insertDocumentFragment(target, fragment, 'node_target01');
		assert.equal(result.document.nodes[0].id, 'node_target01');
		assert.equal(result.document.nodes[1].id, result.firstId);
		assert.equal(insertDocumentFragment(target, fragment, null).document.nodes.length, 2);
	});
	it('rejects stale selection and ID collisions without changing the input', () => {
		const target = addNode(createEmptyPageDocument('target', 'هدف'), 'Text', { id: 'node_target01' });
		const fragment = listStarterTemplates()[0].document;
		const before = JSON.stringify(target);
		assert.throws(() => insertDocumentFragment(target, fragment, 'node_missing01'), /not found/);
		assert.throws(() => insertDocumentFragment(target, fragment, null, () => 'node_target01'));
		assert.equal(JSON.stringify(target), before);
	});
});
