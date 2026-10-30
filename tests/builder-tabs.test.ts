import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diagnosePageDocument } from '../src/lib/builder/diagnostics.ts';
import { createEmptyPageDocument, exportPageDocument, importPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { executeDocumentCommand } from '../src/lib/builder/commands.ts';
import { commitDocument, createDocumentHistory, redoDocument, undoDocument } from '../src/lib/builder/history.ts';
import { compilePageDocument } from '../src/lib/builder/publishing.ts';
import { COMPONENT_REGISTRY } from '../src/lib/builder/registry.ts';

describe('native accessible tabs', () => {
	it('validates and round-trips bounded tab collections, and rejects v4-only nodes in v3', () => {
		let page = addNode(createEmptyPageDocument('tabs'), 'Tabs', { id: 'node_tabstest1' });
		page = updateNodeProps(page, 'node_tabstest1', { items: [{ id: 'item_tabfirst', title: 'One', body: 'First' }, { id: 'item_tabsecond', title: 'Two', body: '<script>not executed</script>' }] });
		assert.equal(COMPONENT_REGISTRY.Tabs.previewRenderer, 'tabs');
		assert.deepEqual(importPageDocument(exportPageDocument(page)), page);
		assert.equal(compilePageDocument(page).ok, true);
		assert.throws(() => validatePageDocument({ ...page, schemaVersion: 3 }), /not part of schema v3/);
		for (const items of [
			[{ id: 'item_tabfirst', title: 'x', body: 'y', html: '<script>' }],
			[{ id: 'item_tabfirst', title: 'x', body: 'y' }, { id: 'item_tabfirst', title: 'z', body: 'y' }],
			Array.from({ length: 25 }, (_, i) => ({ id: `item_${String(i).padStart(4, '0')}`, title: 'x', body: 'y' })),
		]) assert.throws(() => updateNodeProps(page, 'node_tabstest1', { items }));
	});
	it('retains edits through history and reports missing tab labels', async () => {
		const page = addNode(createEmptyPageDocument('tabs-history'), 'Tabs', { id: 'node_tabstest1' });
		const result = executeDocumentCommand(page, { type: 'props', id: 'node_tabstest1', patch: { items: [{ id: 'item_first1', title: '', body: 'Body' }] } });
		assert.equal(result.ok, true); if (!result.ok) return;
		const history = commitDocument(createDocumentHistory(page), result.document);
		assert.deepEqual(undoDocument(history).present, page);
		assert.deepEqual(redoDocument(undoDocument(history)).present, result.document);
		assert.ok((await diagnosePageDocument(result.document, page.slug, async () => true)).some((item) => item.code === 'empty-tabs'));
	});
});
