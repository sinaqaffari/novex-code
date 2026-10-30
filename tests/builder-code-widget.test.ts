import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { createEmptyPageDocument, exportPageDocument, importPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { COMPONENT_REGISTRY, normalizeProps } from '../src/lib/builder/registry.ts';
import { sandboxedCodeDocument } from '../src/lib/builder/sandboxed-code.ts';
import { diagnosePageDocument } from '../src/lib/builder/diagnostics.ts';
import { validateSiteKit, listSiteKits } from '../src/lib/builder/site-kits.ts';
import { validateBuilderPresets } from '../src/lib/builder/plugin-presets.ts';
import { compilePageDocument } from '../src/lib/builder/publishing.ts';

describe('isolated page-author code widget', () => {
	it('validates bounded fields and round-trips through the canonical document', async () => {
		let doc = addNode(createEmptyPageDocument('code'), 'CodeWidget', { id: 'node_codewidget' });
		doc = updateNodeProps(doc, 'node_codewidget', { html: '<b>hi</b>', css: 'b{color:red}', javascript: "document.querySelector('b').textContent='ok'", height: 400 });
		assert.deepEqual(importPageDocument(exportPageDocument(doc)), doc);
		assert.throws(() => updateNodeProps(doc, 'node_codewidget', { height: 1201 }));
		assert.throws(() => updateNodeProps(doc, 'node_codewidget', { title: ' ' }));
		assert.throws(() => updateNodeProps(doc, 'node_codewidget', { javascript: 'x'.repeat(16001) }));
		assert.throws(() => validatePageDocument({ ...doc, schemaVersion: 2 }));
		assert.ok((await diagnosePageDocument(doc, 'code', async () => true)).some((item) => item.code === 'executable-widget'));
		const compiled = compilePageDocument(doc);
		assert.equal(compiled.ok, true);
		if (compiled.ok) assert.deepEqual(compiled.page.components, ['CodeWidget']);
	});
	it('escapes code and CSS in bootstrap scripts and requires an explicit sandbox boundary', () => {
		const props = normalizeProps('CodeWidget', { ...COMPONENT_REGISTRY.CodeWidget.defaultProps, html: '<p id="safe">text</p>', css: '</style><script>unsafe()</script>', javascript: "const value = '</script><script>unsafe()</script>'" });
		const src = sandboxedCodeDocument(props);
		assert.match(src, /Content-Security-Policy/);
		assert.match(src, /connect-src 'none'/);
		assert.doesNotMatch(src, /<script>unsafe\(\)<\/script>/);
		assert.match(src, /\\u003c\/script>/);
	});
	it('does not permit executable widgets in declarative kits or plugin presets', () => {
		const document = addNode(createEmptyPageDocument('snippet'), 'CodeWidget', { id: 'node_snippet01' });
		const kit = listSiteKits()[0];
		assert.throws(() => validateSiteKit({ ...kit, requiredComponents: ['CodeWidget'], pages: [{ suffix: 'home', title: 'Home', document }], assets: [] }), /کد اجرایی/);
		assert.throws(() => validateBuilderPresets([{ id: 'code', label: 'Code', description: '', document }]), /کد اجرایی/);
	});
});
