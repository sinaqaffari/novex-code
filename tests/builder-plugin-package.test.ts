import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { validateDeclarativePluginPackage } from '../src/lib/builder/declarative-plugin-package.ts';
import { changeDeclarativePluginPackage, getPublishedPage, installDeclarativePluginPackage, listBuilderAssetUsages, listDeclarativePluginPackages, publishPage, saveDraftPage } from '../src/lib/builder/store.ts';
import { resolvePluginParts } from '../src/lib/builder/plugin-components.ts';
import { materializeBuilderPreset } from '../src/lib/builder/plugin-presets.ts';
import { deleteUpload, saveUpload } from '../src/lib/cms/media.ts';

function plugin(version = '1.0.0') {
	return { schemaVersion: 1, id: 'data-example', version, name: 'بستهٔ نمونه', description: 'فقط داده', components: [{ pluginId: 'data-example', pluginVersion: version, componentId: 'notice', label: 'پیام', fields: [{ key: 'message', label: 'متن', kind: 'text', value: 'سلام', maxLength: 240 }], parts: [{ type: 'text', textKey: 'message' }] }] };
}
async function isolated(run: (file: string, created: Set<string>) => Promise<void>) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-plugin-package-'));
	const old = process.env.BUILDER_DATA_FILE; const file = path.join(dir, 'builder.json'); const created = new Set<string>(); process.env.BUILDER_DATA_FILE = file;
	try { await run(file, created); } finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); for (const name of created) await deleteUpload(name).catch(() => undefined); }
}
const request = (method: string, value: unknown) => new Request('http://local/', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
const admin = { cmsUser: { role: 'admin' } };

describe('declarative plugin component package', () => {
	it('requires strict bounded data, identity ownership, safe links and no executable fields', () => {
		const input = plugin();
		assert.equal(validateDeclarativePluginPackage(input).id, 'data-example');
		assert.throws(() => validateDeclarativePluginPackage({ ...input, code: 'require("fs")' }));
		assert.throws(() => validateDeclarativePluginPackage({ ...input, id: 'builtin' }));
		assert.throws(() => validateDeclarativePluginPackage({ ...input, version: '1.1.0' }));
		assert.throws(() => validateDeclarativePluginPackage({ ...input, components: [...input.components, ...input.components] }));
		assert.throws(() => validateDeclarativePluginPackage({ ...input, components: [{ ...input.components[0], html: '<script>bad()</script>' }] }));
		assert.throws(() => validateDeclarativePluginPackage({ ...input, components: [{ ...input.components[0], fields: [{ key: 'link', label: 'Link', kind: 'url', value: 'javascript:alert(1)', maxLength: 500 }], parts: [{ type: 'button', textKey: 'link', hrefKey: 'link' }] }] }));
	});
	it('authorizes, installs, updates, toggles and removes packages without altering page snapshots', async () => isolated(async () => {
		const { GET, POST, PATCH, DELETE } = await import('../src/pages/cms/api/builder/plugin-packages.ts');
		const item = plugin();
		assert.equal((await POST({ locals: { cmsUser: { role: 'editor' } }, request: request('POST', { action: 'install', confirm: true, package: item }) } as never)).status, 403);
		assert.equal((await GET({ locals: { cmsUser: { role: 'contributor' } } } as never)).status, 403);
		assert.equal((await POST({ locals: admin, request: request('POST', { action: 'install', package: item }) } as never)).status, 400);
		assert.equal((await POST({ locals: admin, request: request('POST', { action: 'install', confirm: true, package: item }) } as never)).status, 201);
		assert.equal((await POST({ locals: admin, request: request('POST', { action: 'install', confirm: true, package: item }) } as never)).status, 409);
		assert.equal((await listDeclarativePluginPackages())[0].active, true);
		let document = addNode(createEmptyPageDocument('plugin-page'), 'PluginBlock', { id: 'node_plugin01' });
		document = updateNodeProps(document, 'node_plugin01', item.components[0]);
		await saveDraftPage({ slug: 'plugin-page', expectedRevision: 0, document });
		await publishPage({ slug: 'plugin-page', expectedRevision: 1, document });
		assert.equal((await PATCH({ locals: admin, request: request('PATCH', { id: item.id, expectedRevision: 99, active: false }) } as never)).status, 409);
		assert.equal((await PATCH({ locals: admin, request: request('PATCH', { id: item.id, expectedRevision: 1, active: false }) } as never)).status, 200);
		assert.equal((await listDeclarativePluginPackages())[0].active, false);
		const newer = plugin('1.1.0'); newer.components[0].fields[0].value = 'نسخهٔ تازه';
		assert.equal((await POST({ locals: admin, request: request('POST', { action: 'update', confirm: true, expectedRevision: 2, package: newer }) } as never)).status, 200);
		assert.equal((await listDeclarativePluginPackages())[0].active, false);
		assert.equal((await POST({ locals: admin, request: request('POST', { action: 'update', confirm: true, expectedRevision: 3, package: item }) } as never)).status, 409);
		assert.equal((await DELETE({ locals: admin, request: request('DELETE', { id: item.id, expectedRevision: 3, confirm: true }) } as never)).status, 200);
		assert.deepEqual(await listDeclarativePluginPackages(), []);
		const published = (await getPublishedPage('plugin-page'))!.document.nodes[0];
		assert.equal(published.type, 'PluginBlock');
		if (published.type === 'PluginBlock') assert.deepEqual(resolvePluginParts(published.props), [{ type: 'text', text: 'سلام' }]);
	}));
	it('installs parameterized native presets without code and protects their media', async () => isolated(async (_file, created) => {
		const bytes = await sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
		const uploaded = await saveUpload(new File([new Uint8Array(bytes)], 'plugin-v2-test.png', { type: 'image/png' }));
		assert.equal(uploaded.reused, false); created.add(uploaded.name);
		let document = addNode(createEmptyPageDocument('preset-source'), 'Image', { id: 'node_presetimg01' });
		document = updateNodeProps(document, 'node_presetimg01', { src: `media://uploads/${uploaded.name}`, alt: 'Initial' });
		const preset = { id: 'data-example-cover', label: 'تصویر آماده', description: '', document, parameters: [{ key: 'alt', label: 'شرح', nodeId: 'node_presetimg01', property: 'alt', defaultValue: 'Default', maxLength: 100 }] };
		const pkg = { ...plugin(), schemaVersion: 2, components: [], presets: [preset] };
		const validated = validateDeclarativePluginPackage(pkg);
		assert.equal(validated.presets?.length, 1);
		const materialized = materializeBuilderPreset(validated.presets![0], { alt: 'Edited' });
		assert.equal(materialized.nodes[0].type === 'Image' && materialized.nodes[0].props.alt, 'Edited');
		assert.throws(() => materializeBuilderPreset(validated.presets![0], { alt: 'x'.repeat(101) }));
		assert.throws(() => validateDeclarativePluginPackage({ ...pkg, schemaVersion: 1 }));
		assert.throws(() => validateDeclarativePluginPackage({ ...pkg, presets: [{ ...preset, id: 'other-cover' }] }));
		const remote = updateNodeProps(document, 'node_presetimg01', { src: 'https://example.org/image.png' });
		assert.throws(() => validateDeclarativePluginPackage({ ...pkg, presets: [{ ...preset, document: remote }] }));
		const code = addNode(document, 'GlobalCode', { id: 'node_globalcode01' });
		assert.throws(() => validateDeclarativePluginPackage({ ...pkg, presets: [{ ...preset, document: code }] }));
		await installDeclarativePluginPackage(pkg, 'install');
		assert.ok((await listBuilderAssetUsages(`uploads/${uploaded.name}`)).some((use) => use.scope === 'plugin-preset' && use.pluginId === pkg.id));
		await assert.rejects(deleteUpload(uploaded.name), (error: unknown) => (error as { status?: number }).status === 409);
		await changeDeclarativePluginPackage(pkg.id, 1, false);
		await assert.rejects(deleteUpload(uploaded.name), (error: unknown) => (error as { status?: number }).status === 409);
		await changeDeclarativePluginPackage(pkg.id, 2, null);
		await deleteUpload(uploaded.name); created.delete(uploaded.name);
	}));
	it('enforces streamed request bounds and fails closed on corrupted package state', async () => isolated(async (file) => {
		const { POST } = await import('../src/pages/cms/api/builder/plugin-packages.ts');
		const large = new Request('http://local/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(520_001) });
		assert.equal((await POST({ locals: admin, request: large } as never)).status, 413);
		await writeFile(file, JSON.stringify({ schemaVersion: 1, pages: {}, templates: {}, sections: {}, declarativePlugins: { 'data-example': { package: { code: 'bad' }, active: true, revision: 1, updatedAt: '' } } }));
		const before = await readFile(file, 'utf8');
		assert.equal((await POST({ locals: admin, request: request('POST', { action: 'install', confirm: true, package: plugin() }) } as never)).status, 500);
		assert.equal(await readFile(file, 'utf8'), before);
	}));
});
