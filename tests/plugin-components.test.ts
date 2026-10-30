import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { register } from '../plugins/notice-component/index.ts';
import { validateHookRegistration, validatePluginManifest } from '../src/lib/plugins/validation.ts';
import type { PluginApi, PluginManifest } from '../src/lib/plugins/types.ts';
import { collectPluginComponents, resolvePluginParts } from '../src/lib/builder/plugin-components.ts';
import { createEmptyPageDocument, exportPageDocument, importPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { createBuilderNode, findNode, insertDocumentFragment, updateNodeProps, duplicateNode, updateNodeStyles } from '../src/lib/builder/operations.ts';
import { createDocumentHistory, commitDocument, undoDocument, redoDocument } from '../src/lib/builder/history.ts';
import { buildResponsiveCss } from '../src/lib/builder/render.ts';
import { normalizeProps } from '../src/lib/builder/registry.ts';

const manifest = JSON.parse(readFileSync(new URL('../plugins/notice-component/plugin.json', import.meta.url), 'utf8')) as PluginManifest;
function example() {
	let filter: ((value: unknown) => unknown) | undefined;
	register({ id: manifest.id, manifest, addFilter: (_hook: string, callback: (value: unknown) => unknown) => { filter = callback; } } as unknown as PluginApi);
	return collectPluginComponents(filter!([])).components[0];
}

describe('declarative plugin component runtime', () => {
	it('authorizes a declared bundled extension and isolates invalid contributions', () => {
		assert.deepEqual(validatePluginManifest(manifest, 'notice-component'), []);
		assert.equal(validateHookRegistration(manifest, 'builder.components', 'filter'), 'builder:components');
		assert.throws(() => validateHookRegistration({ ...manifest, capabilities: [] }, 'builder.components', 'filter'));
		const good = example();
		const result = collectPluginComponents([good, { ...good, parts: [{ type: 'html', textKey: 'message' }] }, good]);
		assert.equal(result.components.length, 1);
		assert.equal(result.rejected, 2);
	});
	it('validates fields, bindings, versions and unsafe links with no executable markup', () => {
		const props = example();
		assert.throws(() => normalizeProps('PluginBlock', { ...props, code: 'alert(1)' }));
		assert.throws(() => normalizeProps('PluginBlock', { ...props, pluginVersion: '1.0.0;evil' }));
		assert.throws(() => normalizeProps('PluginBlock', { ...props, fields: props.fields.map((field) => field.kind === 'url' ? { ...field, value: 'javascript:alert(1)' } : field) }));
		assert.throws(() => normalizeProps('PluginBlock', { ...props, parts: [{ type: 'button', textKey: 'title', hrefKey: 'title' }] }));
		assert.throws(() => normalizeProps('PluginBlock', { ...props, parts: [{ type: 'heading', textKey: 'message' }] }));
		assert.throws(() => normalizeProps('PluginBlock', { ...props, fields: [...props.fields, props.fields[0]] }));
		const parts = resolvePluginParts(props);
		assert.equal(parts[0].type, 'heading');
		assert.equal(parts[2].type === 'button' && parts[2].href, '/about');
	});
	it('inserts, edits, undoes, duplicates and restores a self-contained snapshot', () => {
		const original = createEmptyPageDocument('plugin-block-page');
		const source = validatePageDocument({ ...createEmptyPageDocument('plugin-source'), nodes: [{ ...createBuilderNode('PluginBlock', 'node_pluginblock1'), props: example() }] });
		const inserted = insertDocumentFragment(original, source, null, () => 'node_pluginblock2').document;
		const node = findNode(inserted.nodes, 'node_pluginblock2');
		assert.equal(node?.type, 'PluginBlock');
		if (node?.type !== 'PluginBlock') throw new Error('plugin block missing');
		const fields = node.props.fields.map((field) => field.key === 'message' ? { ...field, value: 'پیام ویرایش‌شده' } : field);
		const edited = updateNodeProps(inserted, node.id, { fields });
		const history = commitDocument(createDocumentHistory(inserted), edited);
		assert.deepEqual(undoDocument(history).present, inserted);
		assert.deepEqual(redoDocument(undoDocument(history)).present, edited);
		const duplicate = duplicateNode(edited, node.id, () => 'node_pluginblock3');
		const restored = importPageDocument(exportPageDocument(duplicate.document), original.slug);
		const copy = findNode(restored.nodes, 'node_pluginblock3');
		assert.equal(copy?.type, 'PluginBlock');
		if (copy?.type !== 'PluginBlock') throw new Error('plugin copy missing');
		assert.equal(resolvePluginParts(copy.props)[1].text, 'پیام ویرایش‌شده');
		const independent = updateNodeProps(restored, copy.id, { fields: copy.props.fields.map((field) => field.key === 'message' ? { ...field, value: 'نسخهٔ مستقل' } : field) });
		const originalAfterCopyEdit = findNode(independent.nodes, node.id);
		assert.equal(originalAfterCopyEdit?.type === 'PluginBlock' && resolvePluginParts(originalAfterCopyEdit.props)[1].text, 'پیام ویرایش‌شده');
		const styled = updateNodeStyles(restored, copy.id, { width: 'narrow' }, 'mobile');
		assert.match(buildResponsiveCss(styled), /width:min\(100%,40rem\)!important/);
	});
	it('migrates v1 without mutating source and rejects unknown future versions', () => {
		const current = createEmptyPageDocument('legacy-v1');
		const legacy = { ...current, schemaVersion: 1 };
		assert.equal(validatePageDocument(legacy).schemaVersion, 5);
		assert.equal(legacy.schemaVersion, 1);
		assert.throws(() => validatePageDocument({ ...current, schemaVersion: 999 }));
	});
});

describe('plugin snapshot persistence and migration', () => {
	it('loads v1 persisted records without rewriting them, and publishes v2 plugin content', async () => {
		const { mkdtemp, rm, writeFile, readFile } = await import('node:fs/promises');
		const { default: path } = await import('node:path');
		const { default: os } = await import('node:os');
		const { getDraftPage, getPublishedPage, saveDraftPage, publishPage } = await import('../src/lib/builder/store.ts');
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-plugin-runtime-'));
		const prior = process.env.BUILDER_DATA_FILE;
		const file = path.join(dir, 'pages.json');
		process.env.BUILDER_DATA_FILE = file;
		try {
			const initial = createEmptyPageDocument('v1-existing');
			const v1 = { ...initial, schemaVersion: 1 };
			const storage = JSON.stringify({ schemaVersion: 1, pages: { 'v1-existing': { slug: 'v1-existing', revision: 1, updatedAt: '2024-01-01', draft: v1, revisions: [{ revision: 1, savedAt: '2024-01-01', document: v1 }] } }, templates: {} });
			await writeFile(file, storage);
			assert.equal((await getDraftPage('v1-existing')).draft.schemaVersion, 5);
			assert.equal(await readFile(file, 'utf8'), storage);
			const node = { ...createBuilderNode('PluginBlock', 'node_pluginblock1'), props: example() };
			const document = validatePageDocument({ ...initial, nodes: [node] });
			await saveDraftPage({ slug: initial.slug, expectedRevision: 1, document });
			assert.equal(await getPublishedPage(initial.slug), null);
			await publishPage({ slug: initial.slug, expectedRevision: 2, document });
			const publicNode = (await getPublishedPage(initial.slug))!.document.nodes[0];
			assert.equal(publicNode.type, 'PluginBlock');
			if (publicNode.type !== 'PluginBlock') throw new Error('plugin component missing');
			assert.equal(resolvePluginParts(publicNode.props)[0].text, 'اطلاعیه');
		} finally { if (prior === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = prior; await rm(dir, { recursive: true, force: true }); }
	});
});

describe('plugin contribution ownership and isolation', () => {
	it('does not allow a plugin to claim another owner or version', async () => {
		const { collectOwnedPluginComponents } = await import('../src/lib/builder/plugin-components.ts');
		const good = example();
		const contributions = [
			{ owner: 'other-plugin', value: good },
			{ owner: manifest.id, value: { ...good, pluginVersion: '99.0.0' } },
			{ owner: manifest.id, value: good },
		];
		const result = collectOwnedPluginComponents(contributions, (owner) => owner === manifest.id ? manifest.version : '1.0.0');
		assert.equal(result.rejected, 2);
		assert.equal(result.components.length, 1);
		assert.equal(result.components[0].pluginId, manifest.id);
		assert.equal(collectOwnedPluginComponents([{ owner: manifest.id, value: good }], () => undefined).components.length, 0);
	});
	it('isolates failing and malformed callbacks and preserves other owners', async () => {
		const { addFilter, collectOwnedBuilderComponents, removePluginHooks } = await import('../src/lib/plugins/hooks.ts');
		const { collectOwnedPluginComponents } = await import('../src/lib/builder/plugin-components.ts');
		const good = example();
		try {
			addFilter('builder.components', () => null, 1, 'bad-null');
			addFilter('builder.components', () => { throw new Error('test failure'); }, 2, 'bad-throw');
			addFilter('builder.components', () => [{ ...good, pluginId: 'someone-else' }], 3, 'spoof');
			addFilter('builder.components', (input) => [...(input as unknown[]), good], 4, manifest.id);
			const raw = await collectOwnedBuilderComponents();
			assert.equal(raw.rejected, 2);
			const result = collectOwnedPluginComponents(raw.contributions, (owner) => owner === manifest.id ? manifest.version : '1.0.0');
			assert.equal(result.rejected, 1);
			assert.equal(result.components.length, 1);
		} finally {
			for (const owner of ['bad-null', 'bad-throw', 'spoof', manifest.id]) removePluginHooks(owner);
		}
	});
	it('accepts valid semver versions and rejects malformed versions', () => {
		const props = example();
		assert.equal(normalizeProps('PluginBlock', { ...props, pluginVersion: '1.2.3-beta.1+build' }).pluginVersion, '1.2.3-beta.1+build');
		assert.throws(() => normalizeProps('PluginBlock', { ...props, pluginVersion: '01.2.3' }));
	});
});
