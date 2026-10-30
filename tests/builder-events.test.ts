import assert from 'node:assert/strict';
import { it } from 'node:test';
import { EditorEvents } from '../src/lib/builder/events.ts';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';

it('dispatches editor-scoped typed events, isolates failures and unsubscribes', () => {
	const first = new EditorEvents();
	const other = new EditorEvents();
	const seen: string[] = [];
	const off = first.on('document.changed', ({ document, reason }) => { seen.push(`${document.slug}:${reason}`); });
	first.on('document.changed', () => { throw new Error('listener failed'); });
	first.on('document.changed', () => { seen.push('second listener'); });
	other.emit('document.changed', { document: createEmptyPageDocument('other'), reason: 'edit' });
	const errors = first.emit('document.changed', { document: createEmptyPageDocument('events'), reason: 'undo' });
	assert.deepEqual(seen, ['events:undo', 'second listener']);
	assert.equal(errors[0].message, 'listener failed');
	off();
	first.emit('document.changed', { document: createEmptyPageDocument('events'), reason: 'redo' });
	assert.deepEqual(seen, ['events:undo', 'second listener', 'second listener']);
});
