import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { register } from '../plugins/announcement-preset/index.ts';
import { validatePluginManifest, validateHookRegistration } from '../src/lib/plugins/validation.ts';
import { validateBuilderPresets } from '../src/lib/builder/plugin-presets.ts';
import { createEmptyPageDocument, exportPageDocument, importPageDocument } from '../src/lib/builder/document.ts';
import { findNode, insertDocumentFragment, updateNodeProps } from '../src/lib/builder/operations.ts';
import type { PluginApi, PluginManifest } from '../src/lib/plugins/types.ts';

const manifest = JSON.parse(readFileSync(new URL('../plugins/announcement-preset/plugin.json', import.meta.url), 'utf8')) as PluginManifest;
describe('bundled builder preset extension', () => {
	it('uses a validated, capability-declared hook', () => {
		assert.deepEqual(validatePluginManifest(manifest, 'announcement-preset'), []);
		assert.equal(validateHookRegistration(manifest, 'builder.presets', 'filter'), 'builder:presets');
		assert.throws(() => validateHookRegistration({ ...manifest, capabilities: [] }, 'builder.presets', 'filter'));
	});
	it('registers a native, editable preset that survives serialization without a plugin runtime', () => {
		let callback: ((value: unknown) => unknown) | undefined;
		register({ addFilter: (_hook: string, fn: (value: unknown) => unknown) => { callback = fn; } } as unknown as PluginApi);
		assert.ok(callback);
		const presets = validateBuilderPresets(callback([]));
		assert.equal(presets.length, 1);
		const inserted = insertDocumentFragment(createEmptyPageDocument('plugin-page'), presets[0].document, null).document;
		const container = inserted.nodes[0];
		assert.equal(container.type, 'Container');
		if (container.type !== 'Container') throw new Error('container');
		const text = container.children[0];
		const edited = updateNodeProps(inserted, text.id, { text: 'اطلاعیهٔ جدید' });
		const restored = importPageDocument(exportPageDocument(edited), 'plugin-page');
		const restoredText = findNode(restored.nodes, text.id);
		assert.ok(restoredText && restoredText.type === 'Text');
		assert.equal(restoredText.props.text, 'اطلاعیهٔ جدید');
	});
	it('rejects duplicate and invalid preset declarations', () => {
		assert.throws(() => validateBuilderPresets([{ id: 'bad', label: 'A', description: '', document: {} }]));
		const valid = { id: 'example', label: 'A', description: '', document: createEmptyPageDocument('example') };
		assert.throws(() => validateBuilderPresets([valid, valid]));
	});
});

describe('parameterized declarative native compositions', () => {
	it('materializes typed values, inserts fresh IDs, supports editing and persists without plugin code', async () => {
		const { materializeBuilderPreset } = await import('../src/lib/builder/plugin-presets.ts');
		const { saveDraftPage, publishPage, getPublishedPage } = await import('../src/lib/builder/store.ts');
		const { mkdtemp, rm } = await import('node:fs/promises');
		const { default: os } = await import('node:os');
		const { default: path } = await import('node:path');
		let callback: ((value: unknown) => unknown) | undefined;
		register({ addFilter: (_hook: string, fn: (value: unknown) => unknown) => { callback = fn; } } as unknown as PluginApi);
		const preset = validateBuilderPresets(callback!([]))[0];
		assert.equal(preset.parameters?.[0].key, 'message');
		const fragment = materializeBuilderPreset(preset, { message: 'پیام تازه' });
		const inserted = insertDocumentFragment(createEmptyPageDocument('param-test'), fragment, null).document;
		const parent = inserted.nodes[0];
		assert.equal(parent.type, 'Container');
		if (parent.type !== 'Container') throw new Error('expected container');
		const text = parent.children[0];
		assert.notEqual(text.id, 'node_announcetext01');
		assert.equal(text.type === 'Text' && text.props.text, 'پیام تازه');
		const edited = updateNodeProps(inserted, text.id, { text: 'ویرایش پس از درج' });
		const directory = await mkdtemp(path.join(os.tmpdir(), 'novex-plugin-component-'));
		const previous = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(directory, 'pages.json');
		try {
			await saveDraftPage({ slug: 'param-test', expectedRevision: 0, document: edited });
			assert.equal(await getPublishedPage('param-test'), null);
			await publishPage({ slug: 'param-test', expectedRevision: 1, document: edited });
			const published = await getPublishedPage('param-test');
			const node = findNode(published!.document.nodes, text.id);
			assert.equal(node?.type === 'Text' && node.props.text, 'ویرایش پس از درج');
		} finally {
			if (previous === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = previous;
			await rm(directory, { recursive: true, force: true });
		}
	});
	it('rejects undeclared fields, invalid targets, duplicates and unsafe links', async () => {
		const { materializeBuilderPreset } = await import('../src/lib/builder/plugin-presets.ts');
		const { addNode } = await import('../src/lib/builder/operations.ts');
		const document = addNode(createEmptyPageDocument('plugin-input'), 'Button', { id: 'node_button01' });
		const parameter = { key: 'link', label: 'نشانی', nodeId: 'node_button01', property: 'href', defaultValue: '/', maxLength: 500 };
		const raw = { id: 'safe-component', label: 'دکمه', description: '', document, parameters: [parameter] };
		const preset = validateBuilderPresets([raw])[0];
		assert.throws(() => materializeBuilderPreset(preset, { link: 'javascript:alert(1)' }));
		assert.throws(() => materializeBuilderPreset(preset, { unexpected: 'x' }));
		assert.throws(() => validateBuilderPresets([{ ...raw, parameters: [{ ...parameter, property: '__proto__' }] }]));
		assert.throws(() => validateBuilderPresets([{ ...raw, parameters: [{ ...parameter, nodeId: 'node_missing1' }] }]));
		assert.throws(() => validateBuilderPresets([{ ...raw, parameters: [parameter, { ...parameter, key: 'other' }] }]));
		assert.throws(() => validateBuilderPresets([{ ...raw, parameters: [{ ...parameter, defaultValue: 'javascript:alert(1)' }] }]));
		assert.throws(() => validateBuilderPresets([{ ...raw, parameters: [{ ...parameter, maxLength: 1000 }] }]));
		assert.throws(() => validateBuilderPresets([{ ...raw, code: 'alert(1)' }]));
	});
});

	describe('preset contribution isolation', () => {
		it('retains valid peers when declarations are invalid or duplicated', async () => {
			const { collectBuilderPresets } = await import('../src/lib/builder/plugin-presets.ts');
			const good = { id: 'example', label: 'نمونه', description: '', document: createEmptyPageDocument('example') };
			const result = collectBuilderPresets([good, { id: 'broken' }, good]);
			assert.equal(result.presets.length, 1);
			assert.equal(result.rejected, 2);
			assert.equal(collectBuilderPresets('bad').rejected, 1);
		});
	});
