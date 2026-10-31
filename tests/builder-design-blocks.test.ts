import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { register } from '../plugins/design-blocks/index.ts';
import { validatePluginManifest, validateHookRegistration } from '../src/lib/plugins/validation.ts';
import { materializeBuilderPreset, validateBuilderPresets } from '../src/lib/builder/plugin-presets.ts';
import { createEmptyPageDocument, exportPageDocument, importPageDocument } from '../src/lib/builder/document.ts';
import { findNode, insertDocumentFragment, traversePageNodes, updateNodeProps } from '../src/lib/builder/operations.ts';
import type { PluginApi, PluginManifest } from '../src/lib/plugins/types.ts';

const manifest = JSON.parse(readFileSync(new URL('../plugins/design-blocks/plugin.json', import.meta.url), 'utf8')) as PluginManifest;

describe('bundled native design-blocks plugin', () => {
	it('declares the supported capability and contributes four validated, independent presets', () => {
		assert.deepEqual(validatePluginManifest(manifest, 'design-blocks'), []);
		assert.equal(validateHookRegistration(manifest, 'builder.presets', 'filter'), 'builder:presets');
		let filter: ((value: unknown) => unknown) | undefined;
		register({ addFilter: (_hook: string, callback: (value: unknown) => unknown) => { filter = callback; } } as unknown as PluginApi);
		assert.ok(filter);
		const presets = validateBuilderPresets(filter([]));
		assert.deepEqual(presets.map((preset) => preset.id), ['design-blocks-intro', 'design-blocks-services', 'design-blocks-cta', 'design-blocks-faq']);
		assert.throws(() => filter!('invalid'));
		const cta = presets.find((preset) => preset.id === 'design-blocks-cta')!;
		assert.throws(() => materializeBuilderPreset(cta, { 'button-url': 'javascript:alert(1)' }));
		const fragment = materializeBuilderPreset(cta, { headline: 'گفت‌وگو را شروع کنیم', 'button-url': '/contact' });
		const inserted = insertDocumentFragment(createEmptyPageDocument('blocks-test'), fragment, null).document;
		let targetId = '';
		traversePageNodes(inserted, (node) => { if (node.type === 'Heading') targetId = node.id; });
		assert.ok(targetId && targetId !== 'node_blocks_cta_h');
		const changed = updateNodeProps(inserted, targetId, { text: 'تیتر ویرایش‌شده' });
		const restored = importPageDocument(exportPageDocument(changed), 'blocks-test');
		const target = findNode(restored.nodes, targetId);
		assert.equal(target?.type === 'Heading' && target.props.text, 'تیتر ویرایش‌شده');
		const faq = presets.find((preset) => preset.id === 'design-blocks-faq')!;
		let accordions = 0;
		traversePageNodes(faq.document, (node) => { if (node.type === 'Accordion') accordions += 1; });
		assert.equal(accordions, 1);
		presets[0].document.nodes.length = 0;
		assert.ok(validateBuilderPresets(filter!([]))[0].document.nodes.length > 0);
	});
});
