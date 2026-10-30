import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, deleteNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { mergeKitDocument } from '../src/lib/builder/kit-merge.ts';

function basePage() {
	let page = addNode(createEmptyPageDocument('structural-merge'), 'Heading', { id: 'node_heading_a' });
	page = addNode(page, 'Heading', { id: 'node_heading_b' });
	return addNode(page, 'Heading', { id: 'node_heading_c' });
}

describe('stable-ID structural kit merges', () => {
	it('preserves both independently inserted nodes and their order', () => {
		const base = basePage();
		const local = addNode(base, 'Text', { id: 'node_local_added', index: 1 });
		const incoming = addNode(base, 'Divider', { id: 'node_vendor_added', index: 1 });
		const result = mergeKitDocument(base, local, incoming);
		assert.equal(result.ok, true);
		if (result.ok) assert.deepEqual(result.document.nodes.map((node) => node.id), ['node_heading_a', 'node_local_added', 'node_vendor_added', 'node_heading_b', 'node_heading_c']);
	});
	it('merges a deletion with unrelated upstream edits, but rejects delete versus edit', () => {
		const base = basePage();
		const local = deleteNode(base, 'node_heading_a');
		const unrelated = updateNodeProps(base, 'node_heading_b', { text: 'upstream change' });
		const safe = mergeKitDocument(base, local, unrelated);
		assert.equal(safe.ok, true);
		if (safe.ok) {
			assert.deepEqual(safe.document.nodes.map((node) => node.id), ['node_heading_b', 'node_heading_c']);
			assert.equal(safe.document.nodes[0].type === 'Heading' && safe.document.nodes[0].props.text, 'upstream change');
		}
		const changedRemoved = updateNodeProps(base, 'node_heading_a', { text: 'do not lose me' });
		const conflicted = mergeKitDocument(base, local, changedRemoved);
		assert.equal(conflicted.ok, false);
		if (!conflicted.ok) assert.ok(conflicted.conflicts.some((path) => path.includes('node_heading_a')));
	});
	it('rejects incompatible concurrent reorders and insert anchors rather than dropping either change', () => {
		const base = basePage();
		const local = { ...base, nodes: [base.nodes[1], base.nodes[0], base.nodes[2]] };
		const incoming = { ...base, nodes: [base.nodes[0], base.nodes[2], base.nodes[1]] };
		const conflict = mergeKitDocument(base, local, incoming);
		assert.equal(conflict.ok, false);
		if (!conflict.ok) assert.ok(conflict.conflicts.includes('nodes.order'));
		const anchoredInsert = addNode(base, 'Text', { id: 'node_incoming_new', index: 1 });
		const conflictWithAnchor = mergeKitDocument(base, local, anchoredInsert);
		assert.equal(conflictWithAnchor.ok, false);
		if (!conflictWithAnchor.ok) assert.ok(conflictWithAnchor.conflicts.includes('nodes.order'));
	});
	it('rejects unrelated new nodes that collide on the same stable ID', () => {
		const base = basePage();
		const local = addNode(base, 'Text', { id: 'node_colliding_new' });
		const incoming = addNode(base, 'Divider', { id: 'node_colliding_new' });
		const result = mergeKitDocument(base, local, incoming);
		assert.equal(result.ok, false);
		if (!result.ok) assert.ok(result.conflicts.some((path) => path.includes('node_colliding_new')));
	});
	it('merges independent changes and additions to collection entries by item ID', () => {
		let base = addNode(createEmptyPageDocument('merge-list'), 'List', { id: 'node_list_merge' });
		base = updateNodeProps(base, 'node_list_merge', { items: [{ id: 'item_alfa', text: 'الف', href: '' }, { id: 'item_bravo', text: 'ب', href: '' }] });
		const local = updateNodeProps(base, 'node_list_merge', { items: [{ id: 'item_alfa', text: 'ویرایش محلی', href: '' }, { id: 'item_local', text: 'جدید محلی', href: '' }, { id: 'item_bravo', text: 'ب', href: '' }] });
		const incoming = updateNodeProps(base, 'node_list_merge', { items: [{ id: 'item_alfa', text: 'الف', href: '' }, { id: 'item_vendor', text: 'جدید بسته', href: '' }, { id: 'item_bravo', text: 'ب', href: '/about' }] });
		const result = mergeKitDocument(base, local, incoming);
		assert.equal(result.ok, true);
		if (result.ok && result.document.nodes[0].type === 'List') {
			assert.deepEqual(result.document.nodes[0].props.items.map((item) => item.id), ['item_alfa', 'item_local', 'item_vendor', 'item_bravo']);
			assert.equal(result.document.nodes[0].props.items[0].text, 'ویرایش محلی');
			assert.equal(result.document.nodes[0].props.items[3].href, '/about');
		}
	});
	it('resolves reviewed order conflicts without dropping independent inserts or edits', () => {
		const base = basePage();
		let local = addNode(base, 'Text', { id: 'node_local_added', index: 1 });
		local = updateNodeProps(local, 'node_heading_c', { text: 'local C' });
		local = { ...local, nodes: [local.nodes[2], local.nodes[1], local.nodes[0], local.nodes[3]] };
		let incoming = addNode(base, 'Divider', { id: 'node_vendor_added', index: 1 });
		incoming = updateNodeProps(incoming, 'node_heading_a', { text: 'incoming A' });
		incoming = { ...incoming, nodes: [incoming.nodes[0], incoming.nodes[1], incoming.nodes[3], incoming.nodes[2]] };
		const review = mergeKitDocument(base, local, incoming);
		assert.equal(review.ok, false); if (review.ok) return;
		assert.equal(review.fields.find((field) => field.path === 'nodes.order')?.kind, 'order');
		for (const choice of ['local', 'incoming'] as const) {
			const result = mergeKitDocument(base, local, incoming, new Map([['nodes.order', choice]]));
			assert.equal(result.ok, true); if (!result.ok) continue;
			const ids = result.document.nodes.map((node) => node.id);
			assert.deepEqual(new Set(ids), new Set(['node_heading_a', 'node_heading_b', 'node_heading_c', 'node_local_added', 'node_vendor_added']));
			const baseOrder = ids.filter((id) => id.startsWith('node_heading_'));
			assert.deepEqual(baseOrder, choice === 'local' ? ['node_heading_b', 'node_heading_a', 'node_heading_c'] : ['node_heading_a', 'node_heading_c', 'node_heading_b']);
			const a = result.document.nodes.find((node) => node.id === 'node_heading_a');
			const c = result.document.nodes.find((node) => node.id === 'node_heading_c');
			assert.equal(a?.type === 'Heading' && a.props.text, 'incoming A');
			assert.equal(c?.type === 'Heading' && c.props.text, 'local C');
		}
	});
	it('treats text and formatting as one reviewed value instead of misapplying ranges', () => {
		let base = addNode(createEmptyPageDocument('rich-merge'), 'Text', { id: 'node_rich_merge' });
		base = updateNodeProps(base, 'node_rich_merge', { text: 'hello' });
		const local = updateNodeProps(base, 'node_rich_merge', { text: 'new hello' });
		const incoming = updateNodeProps(base, 'node_rich_merge', { marks: [{ kind: 'bold', start: 0, end: 5 }] });
		const review = mergeKitDocument(base, local, incoming);
		assert.equal(review.ok, false); if (review.ok) return;
		const field = review.fields.find((item) => item.kind === 'formatted'); assert.ok(field);
		for (const choice of ['local', 'incoming'] as const) {
			const result = mergeKitDocument(base, local, incoming, new Map([[field.path, choice]]));
			assert.equal(result.ok, true); if (!result.ok) continue;
			const node = result.document.nodes[0]; assert.equal(node.type, 'Text'); if (node.type !== 'Text') continue;
			assert.equal(node.props.text, choice === 'local' ? 'new hello' : 'hello');
			assert.deepEqual(node.props.marks ?? [], choice === 'local' ? [] : [{ kind: 'bold', start: 0, end: 5 }]);
		}
	});
	it('keeps oversized structural conflicts unreviewable instead of truncating their preview', () => {
		let base = addNode(createEmptyPageDocument('oversize-merge'), 'Text', { id: 'node_large_text' });
		base = updateNodeProps(base, 'node_large_text', { text: 'x'.repeat(3000) });
		const local = deleteNode(base, 'node_large_text');
		const incoming = updateNodeProps(base, 'node_large_text', { text: 'y'.repeat(3000) });
		const result = mergeKitDocument(base, local, incoming);
		assert.equal(result.ok, false); if (result.ok) return;
		assert.ok(result.conflicts.some((path) => path.includes('node_large_text')));
		assert.equal(result.fields.length, 0);
	});

	it('merges independent collection fields but reviews concurrent body text and mark changes together', () => {
		for (const type of ['Accordion', 'Tabs'] as const) {
			let base = addNode(createEmptyPageDocument(`merge-rich-${type.toLowerCase()}`), type, { id: 'node_collection01' });
			const item = { id: 'item_rich01', title: 'Title', body: 'Body' };
			base = updateNodeProps(base, 'node_collection01', { items: [item] });
			const local = updateNodeProps(base, 'node_collection01', { items: [{ ...item, body: 'New Body', title: 'Local title' }] });
			const incoming = updateNodeProps(base, 'node_collection01', { items: [{ ...item, bodyMarks: [{ kind: 'italic', start: 0, end: 4 }] }] });
			const review = mergeKitDocument(base, local, incoming);
			assert.equal(review.ok, false); if (review.ok) continue;
			const field = review.fields.find((entry) => entry.path.endsWith('.formattedBody')); assert.ok(field);
			const resolved = mergeKitDocument(base, local, incoming, new Map([[field.path, 'incoming']]));
			assert.equal(resolved.ok, true); if (!resolved.ok) continue;
			const node = resolved.document.nodes[0]; assert.ok(node.type === 'Accordion' || node.type === 'Tabs');
			if (node.type !== 'Accordion' && node.type !== 'Tabs') continue;
			assert.equal(node.props.items[0].title, 'Local title');
			assert.equal(node.props.items[0].body, 'Body');
			assert.deepEqual(node.props.items[0].bodyMarks, [{ kind: 'italic', start: 0, end: 4 }]);
		}
	});

});
