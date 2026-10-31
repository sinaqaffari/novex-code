import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AutosaveController } from '../src/lib/builder/autosave.ts';
import { executeDocumentCommand } from '../src/lib/builder/commands.ts';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { commitDocument, commitValidatedDocument, createDocumentHistory, redoDocument, undoDocument } from '../src/lib/builder/history.ts';
import type { PageDocument } from '../src/lib/builder/types.ts';

describe('validated editor hot path', () => {
	it('matches the checked history path, including no-op, grouped edits and undo/redo selection', () => {
		let checked = createDocumentHistory(createEmptyPageDocument('fast-history'));
		let fast = createDocumentHistory(createEmptyPageDocument('fast-history'));
		const first = executeDocumentCommand(checked.present, { type: 'insert', component: 'Text', id: 'node_fast_text01' });
		assert.ok(first.ok);
		checked = commitDocument(checked, first.document, 60, { selectionAfter: 'node_fast_text01', now: 0 });
		fast = commitValidatedDocument(fast, first.document, 60, { selectionAfter: 'node_fast_text01', now: 0 });
		for (let index = 0; index < 6; index++) {
			const changed = executeDocumentCommand(checked.present, { type: 'props', id: 'node_fast_text01', patch: { text: `تغییر ${index}` } });
			assert.ok(changed.ok);
			const options = { group: 'text', selectionBefore: 'node_fast_text01', now: 100 + index };
			checked = commitDocument(checked, changed.document, 60, options);
			fast = commitValidatedDocument(fast, changed.document, 60, options);
			assert.deepEqual(fast, checked);
		}
		assert.equal(commitValidatedDocument(fast, fast.present), fast);
		checked = undoDocument(checked); fast = undoDocument(fast); assert.deepEqual(fast, checked);
		checked = redoDocument(checked); fast = redoDocument(fast); assert.deepEqual(fast, checked);
		const invalid = { ...checked.present, extra: 'unsupported' } as PageDocument;
		assert.throws(() => commitDocument(checked, invalid));
		assert.equal(executeDocumentCommand(checked.present, { type: 'replace-document', document: invalid }).ok, false);
	});

	it('owns scheduled canonical snapshots and preserves dirty and in-flight ordering', async () => {
		const saved: PageDocument[] = [];
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const initial = createEmptyPageDocument('snapshot-test');
		const controller = new AutosaveController(async (document) => { saved.push(structuredClone(document)); if (saved.length === 1) await gate; }, () => {}, 60_000);
		controller.initialize(initial);
		const changed = { ...initial, title: 'نخست' };
		controller.schedule(changed);
		changed.title = 'تغییر خارج از فرمان';
		const first = controller.flush();
		assert.equal(saved[0].title, 'نخست');
		controller.schedule({ ...initial, title: 'دوم' });
		assert.equal(controller.isDirty(), true);
		release!();
		await first;
		await controller.flush();
		assert.deepEqual(saved.map((item) => item.title), ['نخست', 'دوم']);
		assert.equal(controller.isDirty(), false);
		controller.schedule(initial);
		assert.equal(controller.isDirty(), true);
		controller.cancel();
	});
});
