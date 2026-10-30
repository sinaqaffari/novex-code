import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ZipFile } from 'yazl';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode } from '../src/lib/builder/operations.ts';
import { inspectDeclarativePluginArchive } from '../src/lib/builder/declarative-plugin-archive.ts';
import { listDeclarativePluginPackages } from '../src/lib/builder/store.ts';

async function zip(entries: Array<{ name: string; data: Buffer; mode?: number; compress?: boolean }>): Promise<Buffer> {
	const archive = new ZipFile();
	const chunks: Buffer[] = [];
	const done = new Promise<Buffer>((resolve, reject) => { archive.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); archive.outputStream.on('end', () => resolve(Buffer.concat(chunks))); archive.outputStream.on('error', reject); });
	for (const item of entries) archive.addBuffer(item.data, item.name, { ...(item.mode === undefined ? {} : { mode: item.mode }), ...(item.compress === undefined ? {} : { compress: item.compress }) });
	archive.end(); return done;
}
function packageData() {
	const document = addNode(createEmptyPageDocument('plugin-source'), 'Heading', { id: 'node_pluginheading' });
	return { schemaVersion: 2, id: 'data-zip-example', version: '1.0.0', name: 'بستهٔ ZIP', description: '', components: [], presets: [{ id: 'data-zip-example-title', label: 'عنوان آماده', description: '', document, parameters: [{ key: 'title', label: 'عنوان', nodeId: 'node_pluginheading', property: 'text', defaultValue: 'متن', maxLength: 100 }] }] };
}
function request(bytes: Buffer) {
	const form = new FormData(); form.set('archive', new File([new Uint8Array(bytes)], 'plugin.zip', { type: 'application/zip' }));
	return new Request('http://local/', { method: 'POST', body: form });
}

describe('declarative plugin ZIP inspection', () => {
	it('accepts only checked JSON and optional plain readme, rejecting code and archive attacks', async () => {
		const manifest = Buffer.from(JSON.stringify(packageData()));
		const good = await zip([{ name: 'plugin.json', data: manifest }, { name: 'README.txt', data: Buffer.from('Review this package.') }]);
		const inspected = await inspectDeclarativePluginArchive(good);
		assert.equal(inspected.package.presets?.[0].id, 'data-zip-example-title');
		assert.equal(inspected.readme, 'Review this package.');
		await assert.rejects(inspectDeclarativePluginArchive(await zip([{ name: 'plugin.json', data: manifest }, { name: 'index.js', data: Buffer.from('evil()') }])));
		await assert.rejects(inspectDeclarativePluginArchive(await zip([{ name: 'plugin.json', data: manifest }, { name: 'plugin.json', data: manifest }])));
		const encrypted = await zip([{ name: 'plugin.json', data: manifest }]);
		const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); assert.notEqual(central, -1);
		encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
		await assert.rejects(inspectDeclarativePluginArchive(encrypted));
		await assert.rejects(inspectDeclarativePluginArchive(await zip([{ name: 'plugin.json', data: manifest, mode: 0o120777 }])));
		await assert.rejects(inspectDeclarativePluginArchive(await zip([{ name: 'plugin.json', data: Buffer.alloc(500_001, 1) }])));
		await assert.rejects(inspectDeclarativePluginArchive(await zip([{ name: 'plugin.json', data: manifest }, { name: 'README.txt', data: Buffer.from('\u202e') }])));
		await assert.rejects(inspectDeclarativePluginArchive(await zip([{ name: 'plugin.json', data: Buffer.from(JSON.stringify({ ...packageData(), hooks: ['bad'] })) }])));
		const broken = await zip([{ name: 'plugin.json', data: manifest, compress: false }]);
		const offset = broken.indexOf(manifest); assert.notEqual(offset, -1); broken[offset + 5] ^= 1;
		await assert.rejects(inspectDeclarativePluginArchive(broken), /checksum|اندازه/i);
	});
	it('requires plugin administration and inspects without installing or writing files', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-plugin-archive-'));
		const old = process.env.BUILDER_DATA_FILE; process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		try {
			const { POST } = await import('../src/pages/cms/api/builder/plugin-archive.ts');
			const bytes = await zip([{ name: 'plugin.json', data: Buffer.from(JSON.stringify(packageData())) }]);
			assert.equal((await POST({ locals: { cmsUser: { role: 'editor' } }, request: request(bytes) } as never)).status, 403);
			const response = await POST({ locals: { cmsUser: { role: 'admin' } }, request: request(bytes) } as never);
			assert.equal(response.status, 200);
			assert.equal((await response.json()).package.id, 'data-zip-example');
			assert.deepEqual(await listDeclarativePluginPackages(), []);
		} finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
	});
});
