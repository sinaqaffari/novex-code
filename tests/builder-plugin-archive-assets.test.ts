import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ZipFile } from 'yazl';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { inspectDeclarativePluginArchive } from '../src/lib/builder/declarative-plugin-archive.ts';
import { changeDeclarativePluginPackage, listBuilderAssetUsages, listDeclarativePluginPackages } from '../src/lib/builder/store.ts';
import { deleteUpload, UPLOAD_DIR } from '../src/lib/cms/media.ts';

const multiply = Buffer.from('AGFzbQEAAAABCQFgBH9/f38BfwMCAQAHBwEDcnVuAAAKCQEHACAAIAFsCw==', 'base64');
async function image(): Promise<Buffer> { return sharp(randomBytes(10 * 10 * 3), { raw: { width: 10, height: 10, channels: 3 } }).png().toBuffer(); }
function manifest(version = '1.0.0') {
	let document = addNode(createEmptyPageDocument('plugin-archive'), 'Heading', { id: 'node_archiveheading' });
	document = addNode(document, 'Image', { id: 'node_archiveimage1' });
	document = updateNodeProps(document, 'node_archiveimage1', { src: 'media://uploads/cover.png', alt: 'جلد' });
	return {
		schemaVersion: 3, id: 'data-archive-assets', name: 'بستهٔ تصویری', version, description: '', components: [],
		presets: [{ id: 'data-archive-assets-cover', label: 'جلد', description: '', document, parameters: [{ key: 'result', label: 'نتیجه', nodeId: 'node_archiveheading', property: 'text', defaultValue: '', maxLength: 100 }] }],
		processors: [{ id: 'data-archive-assets-calc', label: 'محاسبه', description: '', presetId: 'data-archive-assets-cover', outputParameter: 'result', prefix: '', suffix: '', inputs: [{ key: 'a', label: 'عدد', min: 0, max: 100, defaultValue: 4 }], modulePath: 'modules/calc.wasm' }],
	};
}
async function zip(entries: { name: string; data: Buffer; mode?: number }[]): Promise<Buffer> {
	const file = new ZipFile(); const chunks: Buffer[] = [];
	const result = new Promise<Buffer>((resolve, reject) => { file.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); file.outputStream.on('end', () => resolve(Buffer.concat(chunks))); file.outputStream.on('error', reject); });
	for (const entry of entries) file.addBuffer(entry.data, entry.name, entry.mode === undefined ? {} : { mode: entry.mode });
	file.end(); return result;
}
function request(bytes: Buffer, action: 'inspect' | 'install' | 'update', expectedRevision?: number, confirm = true): Request {
	const form = new FormData(); form.set('archive', new File([new Uint8Array(bytes)], 'plugin.zip', { type: 'application/zip' })); form.set('action', action);
	if (confirm && action !== 'inspect') form.set('confirm', 'true');
	if (expectedRevision !== undefined) form.set('expectedRevision', String(expectedRevision));
	return new Request('http://local/cms/api/builder/plugin-archive', { method: 'POST', body: form });
}
async function isolated(run: (created: Set<string>) => Promise<void>) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-plugin-zip-assets-')); const old = process.env.BUILDER_DATA_FILE; const created = new Set<string>();
	process.env.BUILDER_DATA_FILE = path.join(dir, 'builder.json');
	try { await run(created); } finally {
		if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
		await rm(dir, { recursive: true, force: true });
		for (const name of created) await deleteUpload(name).catch(() => undefined);
	}
}

describe('plugin ZIP modules and media', () => {
	it('inspects without writing and rejects undeclared, duplicate, invalid and executable entries', async () => {
		const pixels = await image();
		const entries = [{ name: 'plugin.json', data: Buffer.from(JSON.stringify(manifest())) }, { name: 'modules/calc.wasm', data: multiply }, { name: 'assets/cover.png', data: pixels }];
		const inspected = await inspectDeclarativePluginArchive(await zip(entries));
		const hash = createHash('sha256').update(pixels).digest('hex');
		assert.equal(inspected.assets[0].destination, `media://uploads/kit-${hash}.png`);
		assert.equal(inspected.package.processors?.[0].moduleBase64, multiply.toString('base64'));
		assert.equal(inspected.package.presets?.[0].document.nodes[1].type === 'Image' && inspected.package.presets?.[0].document.nodes[1].props.src, inspected.assets[0].destination);
		await assert.rejects(stat(path.join(UPLOAD_DIR, `kit-${hash}.png`)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		for (const extra of [{ name: 'untrusted.js', data: Buffer.from('require("fs")') }, { name: 'assets/unreferenced.png', data: pixels }, { name: 'modules/unreferenced.wasm', data: multiply }, { name: 'assets/evil.png', data: pixels, mode: 0o120777 }, { name: 'assets/cover.png', data: pixels }]) await assert.rejects(inspectDeclarativePluginArchive(await zip([...entries, extra])));
		await assert.rejects(inspectDeclarativePluginArchive(await zip([entries[0], entries[1], { name: 'assets/cover.png', data: Buffer.from('not an image') }])));
		await assert.rejects(inspectDeclarativePluginArchive(await zip([entries[0], { name: 'modules/calc.wasm', data: Buffer.from('JavaScript') }, entries[2]])));
		const both = manifest(); (both.processors[0] as Record<string, unknown>).moduleBase64 = multiply.toString('base64');
		await assert.rejects(inspectDeclarativePluginArchive(await zip([{ name: 'plugin.json', data: Buffer.from(JSON.stringify(both)) }, entries[1], entries[2]])));
	});
	it('installs and updates images with lifecycle and usage protection', async () => isolated(async (created) => {
		const { POST } = await import('../src/pages/cms/api/builder/plugin-archive.ts');
		const pixels = await image();
		const build = (version: string) => zip([{ name: 'plugin.json', data: Buffer.from(JSON.stringify(manifest(version))) }, { name: 'modules/calc.wasm', data: multiply }, { name: 'assets/cover.png', data: pixels }]);
		const first = await build('1.0.0');
		const call = (role: string, archive: Buffer, action: 'inspect' | 'install' | 'update', revision?: number, confirm = true) => POST({ locals: { cmsUser: { role } }, request: request(archive, action, revision, confirm) } as never);
		assert.equal((await call('editor', first, 'inspect')).status, 403);
		const review = await call('admin', first, 'inspect'); assert.equal(review.status, 200); assert.equal((await review.json()).assetCount, 1);
		assert.deepEqual(await listDeclarativePluginPackages(), []);
		assert.equal((await call('admin', first, 'install', undefined, false)).status, 400);
		const response = await call('admin', first, 'install'); assert.equal(response.status, 201);
		const body = await response.json(); for (const name of body.createdUploads as string[]) created.add(name);
		assert.equal(body.uploaded, 1); assert.equal(body.reused, 0);
		const name = body.createdUploads[0] as string;
		assert.ok((await listBuilderAssetUsages(`uploads/${name}`)).some((use) => use.scope === 'plugin-preset' && use.pluginId === 'data-archive-assets'));
		await assert.rejects(deleteUpload(name), (error: unknown) => (error as { status?: number }).status === 409);
		const update = await call('admin', await build('1.1.0'), 'update', 1); assert.equal(update.status, 200);
		const next = await update.json(); assert.equal(next.uploaded, 0); assert.equal(next.reused, 1); assert.equal(next.record.revision, 2);
		await changeDeclarativePluginPackage('data-archive-assets', 2, null);
		await deleteUpload(name); created.delete(name);
	}));
	it('rolls back only newly created uploads on package conflicts', async () => isolated(async (created) => {
		const { POST } = await import('../src/pages/cms/api/builder/plugin-archive.ts');
		const build = async (pixels: Buffer) => zip([{ name: 'plugin.json', data: Buffer.from(JSON.stringify(manifest())) }, { name: 'modules/calc.wasm', data: multiply }, { name: 'assets/cover.png', data: pixels }]);
		const call = (bytes: Buffer) => POST({ locals: { cmsUser: { role: 'admin' } }, request: request(bytes, 'install') } as never);
		const first = await call(await build(await image())); assert.equal(first.status, 201);
		for (const name of (await first.json()).createdUploads as string[]) created.add(name);
		const newPixels = await image(); const hash = createHash('sha256').update(newPixels).digest('hex');
		const failed = await call(await build(newPixels)); assert.equal(failed.status, 409);
		await assert.rejects(stat(path.join(UPLOAD_DIR, `kit-${hash}.png`)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		assert.equal((await listDeclarativePluginPackages())[0].revision, 1);
	}));
});
