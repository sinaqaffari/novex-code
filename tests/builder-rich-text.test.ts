import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmptyPageDocument, exportPageDocument, importPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { addNode, findNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { executeDocumentCommand } from '../src/lib/builder/commands.ts';
import { commitDocument, createDocumentHistory, redoDocument, undoDocument } from '../src/lib/builder/history.ts';
import { adjustTextMarks, clearTextMark, normalizeTextMarks, setTextMark, splitMarkedText, textRuns } from '../src/lib/builder/rich-text.ts';
import type { TextMark } from '../src/lib/builder/types.ts';

const marks: TextMark[] = [
	{ kind: 'bold', start: 0, end: 5 },
	{ kind: 'italic', start: 3, end: 8 },
	{ kind: 'link', start: 6, end: 11, href: '/about' },
];

describe('validated editable text formatting', () => {
	it('migrates old documents without changing their content and rejects v5 fields disguised as v4', () => {
		const base = addNode(createEmptyPageDocument('rich-migration'), 'Text', { id: 'node_richtext01' });
		const legacy = { ...base, schemaVersion: 4 };
		const migrated = validatePageDocument(legacy);
		assert.equal(migrated.schemaVersion, 5);
		assert.deepEqual(migrated.nodes, base.nodes);
		assert.equal(legacy.schemaVersion, 4);
		assert.throws(() => validatePageDocument({ ...legacy, nodes: [{ ...legacy.nodes[0], props: { ...legacy.nodes[0].props, marks: [] } }] }), /not part of schema v4/);
		assert.throws(() => validatePageDocument({ ...base, schemaVersion: 6 }), /Unsupported page schema/);
	});
	it('normalizes ranges, rejects unsafe links, unknown attributes, overlaps and broken Unicode boundaries', () => {
		assert.deepEqual(normalizeTextMarks('hello world', [{ kind: 'bold', start: 3, end: 5 }, { kind: 'bold', start: 0, end: 3 }]), [{ kind: 'bold', start: 0, end: 5 }]);
		for (const value of [
			[{ kind: 'link', start: 0, end: 1, href: 'javascript:alert(1)' }],
			[{ kind: 'link', start: 0, end: 1, href: '//example.com' }],
			[{ kind: 'bold', start: 0, end: 1, onclick: 'alert(1)' }],
			[{ kind: 'bold', start: 0, end: 100 }],
			[{ kind: 'bold', start: 1, end: 1 }],
			[{ kind: 'link', start: 0, end: 4, href: '/one' }, { kind: 'link', start: 3, end: 5, href: '/two' }],
			Array.from({ length: 101 }, () => ({ kind: 'bold', start: 0, end: 1 })),
		]) assert.throws(() => normalizeTextMarks('hello', value));
		assert.throws(() => normalizeTextMarks('a😀b', [{ kind: 'bold', start: 1, end: 2 }]), /Unicode/);
		assert.deepEqual(normalizeTextMarks('a😀b', [{ kind: 'bold', start: 1, end: 3 }]), [{ kind: 'bold', start: 1, end: 3 }]);
	});
	it('creates deterministic semantic text runs without interpreting source HTML', () => {
		assert.deepEqual(textRuns('hello world', marks), [
			{ text: 'hel', bold: true, italic: false },
			{ text: 'lo', bold: true, italic: true },
			{ text: ' ', bold: false, italic: true },
			{ text: 'wo', bold: false, italic: true, href: '/about' },
			{ text: 'rld', bold: false, italic: false, href: '/about' },
		]);
		assert.equal(textRuns('<script>alert(1)</script>')[0].text, '<script>alert(1)</script>');
	});
	it('toggles selected emphasis, changes link destinations and removes only selected portions', () => {
		let value = setTextMark('hello world', [], 0, 5, 'bold');
		value = setTextMark('hello world', value, 1, 4, 'bold');
		assert.deepEqual(value, [{ kind: 'bold', start: 0, end: 1 }, { kind: 'bold', start: 4, end: 5 }]);
		value = setTextMark('hello world', value, 0, 11, 'link', '/old');
		value = setTextMark('hello world', value, 3, 8, 'link', 'https://example.com');
		assert.deepEqual(value.filter((mark) => mark.kind === 'link'), [
			{ kind: 'link', start: 0, end: 3, href: '/old' },
			{ kind: 'link', start: 3, end: 8, href: 'https://example.com' },
			{ kind: 'link', start: 8, end: 11, href: '/old' },
		]);
		assert.equal(clearTextMark('hello world', value, 0, 11, 'link').some((mark) => mark.kind === 'link'), false);
		assert.throws(() => setTextMark('hello', [], 1, 1, 'bold'));
		assert.throws(() => setTextMark('hello', [], 0, 1, 'link', 'javascript:alert(1)'));
	});
	it('adjusts formatting through insertions, deletions, Unicode replacement and selections crossing links', () => {
		const link: TextMark[] = [{ kind: 'link', start: 2, end: 5, href: '/a' }];
		assert.deepEqual(adjustTextMarks('abcdef', 'aXbcdef', link), [{ kind: 'link', start: 3, end: 6, href: '/a' }]);
		assert.deepEqual(adjustTextMarks('abcdef', 'abcXdef', link), [{ kind: 'link', start: 2, end: 6, href: '/a' }]);
		assert.deepEqual(adjustTextMarks('abcdef', 'abef', link), [{ kind: 'link', start: 2, end: 3, href: '/a' }]);
		assert.deepEqual(adjustTextMarks('a😀z', 'a😃z', [{ kind: 'bold', start: 1, end: 3 }]), [{ kind: 'bold', start: 1, end: 3 }]);
		const adjacent: TextMark[] = [{ kind: 'link', start: 0, end: 3, href: '/one' }, { kind: 'link', start: 3, end: 6, href: '/two' }];
		assert.deepEqual(adjustTextMarks('abcdef', 'aXf', adjacent), [{ kind: 'link', start: 0, end: 1, href: '/one' }, { kind: 'link', start: 2, end: 3, href: '/two' }]);
	});
	it('uses shared atomic commands for edits, validation, undo, redo and export', () => {
		const initial = updateNodeProps(addNode(createEmptyPageDocument('rich-edit'), 'Text', { id: 'node_richtext01' }), 'node_richtext01', { text: 'hello world', marks });
		const result = executeDocumentCommand(initial, { type: 'props', id: 'node_richtext01', patch: { text: 'hello new world' } });
		assert.equal(result.ok, true);
		if (!result.ok) throw new Error('command failed');
		const node = findNode(result.document.nodes, 'node_richtext01');
		assert.equal(node?.type, 'Text');
		if (node?.type !== 'Text') throw new Error('wrong type');
		assert.deepEqual(node.props.marks?.find((mark) => mark.kind === 'link'), { kind: 'link', start: 10, end: 15, href: '/about' });
		const invalid = executeDocumentCommand(result.document, { type: 'props', id: node.id, patch: { marks: [{ kind: 'link', start: 0, end: 1, href: 'javascript:alert(1)' }] } });
		assert.equal(invalid.ok, false);
		let history = createDocumentHistory(initial);
		history = commitDocument(history, result.document, 60, { selectionBefore: node.id });
		history = undoDocument(history, node.id); assert.deepEqual(history.present, initial);
		history = redoDocument(history, node.id); assert.deepEqual(history.present, result.document);
		assert.deepEqual(importPageDocument(exportPageDocument(result.document)), result.document);
	});
	it('splits long content and crossing marks without dropping text or splitting Unicode', () => {
		const content = 'a'.repeat(4999) + '😀' + 'b'.repeat(5000);
		const chunks = splitMarkedText(content, [{ kind: 'link', start: 4998, end: 5003, href: '/long' }]);
		assert.equal(chunks.map((chunk) => chunk.text).join(''), content);
		assert.equal(chunks[0].text.length, 4999);
		assert.deepEqual(chunks[0].marks, [{ kind: 'link', start: 4998, end: 4999, href: '/long' }]);
		assert.deepEqual(chunks[1].marks, [{ kind: 'link', start: 0, end: 4, href: '/long' }]);
	});
	it('validates interactive collection marks, forbids nested title links and rejects disguised v4 formatting', () => {
		for (const type of ['Accordion', 'Tabs'] as const) {
			let page = addNode(createEmptyPageDocument(`rich-${type.toLowerCase()}`), type, { id: 'node_rich_collection' });
			const item = { id: 'item_rich01', title: 'A title', body: 'A linked body', titleMarks: [{ kind: 'bold', start: 2, end: 7 }], bodyMarks: [{ kind: 'link', start: 2, end: 8, href: '/inside' }] };
			page = updateNodeProps(page, 'node_rich_collection', { items: [item] });
			assert.deepEqual(importPageDocument(exportPageDocument(page)), page);
			assert.throws(() => updateNodeProps(page, 'node_rich_collection', { items: [{ ...item, titleMarks: [{ kind: 'link', start: 0, end: 1, href: '/bad' }] }] }), /titles cannot contain links/);
			assert.throws(() => validatePageDocument({ ...page, schemaVersion: 4 }), /not part of schema v4/);
		}
	});

});
