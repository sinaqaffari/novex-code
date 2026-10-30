import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fieldVisibleInMode } from '../src/lib/builder/editor-mode.ts';
import { COMPONENT_LIST } from '../src/lib/builder/registry.ts';
import { createEmptyPageDocument, serializePageDocument } from '../src/lib/builder/document.ts';

describe('editor shell isolation', () => {
	it('offers fewer controls in simple mode without changing the document', () => {
		const document = createEmptyPageDocument('mode-test');
		const before = serializePageDocument(document);
		const fields = COMPONENT_LIST.flatMap((definition) => definition.fields);
		assert.ok(fields.some((field) => !fieldVisibleInMode(field, 'simple')));
		assert.ok(fields.every((field) => fieldVisibleInMode(field, 'pro')));
		assert.ok(fields.some((field) => field.group === 'content' && fieldVisibleInMode(field, 'simple')));
		assert.equal(serializePageDocument(document), before);
	});

	it('scopes editor tokens and theme selectors to the builder shell', () => {
		const css = readFileSync(new URL('../src/styles/design-system.css', import.meta.url), 'utf8');
		assert.doesNotMatch(css, /:root\s*[{:]|^\[data-theme=/m);
		assert.match(css, /\.builder-shell\[data-theme='dark'\]/);
		assert.match(css, /\.builder-shell\[data-theme='light'\]/);
	});
});
