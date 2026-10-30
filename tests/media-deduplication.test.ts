import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { saveUpload, UPLOAD_DIR } from '../src/lib/cms/media.ts';

async function uniquePng(): Promise<Buffer> {
	// Unique pixels prevent a test from ever intentionally reusing a user's asset.
	return sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
}
function file(bytes: Buffer): File { return new File([new Uint8Array(bytes)], 'dedup-test.png', { type: 'image/png' }); }

describe('explicit byte-exact media deduplication', () => {
	it('does not reuse unless requested, reports reuse, and never removes either original', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-dedup-'));
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'builder.json');
		const created: string[] = [];
		try {
			const bytes = await uniquePng();
			const original = await saveUpload(file(bytes));
			assert.equal(original.reused, false); created.push(original.name);
			const duplicate = await saveUpload(file(bytes));
			assert.equal(duplicate.reused, false); created.push(duplicate.name);
			assert.notEqual(duplicate.name, original.name);
			const reused = await saveUpload(file(bytes), { deduplicate: true });
			assert.equal(reused.reused, true);
			assert.ok(created.includes(reused.name));
			for (const name of created) assert.ok((await stat(path.join(UPLOAD_DIR, name))).isFile());
		} finally {
			if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
			for (const name of created) await rm(path.join(UPLOAD_DIR, name), { force: true });
			await rm(dir, { recursive: true, force: true });
		}
	});
	it('reports opt-in reuse through the permission-checked multipart API', async () => {
		const { POST } = await import('../src/pages/cms/api/media/upload.ts');
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-dedup-api-'));
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'builder.json');
		let created: string | undefined;
		try {
			const bytes = await uniquePng();
			const makeRequest = (deduplicate: boolean) => {
				const form = new FormData(); form.append('files', file(bytes));
				if (deduplicate) form.set('deduplicate', '1');
				return new Request('http://local/cms/api/media/upload', { method: 'POST', headers: { accept: 'application/json' }, body: form });
			};
			const forbidden = await POST({ locals: { cmsUser: { role: 'contributor' } }, request: makeRequest(true) } as never);
			assert.equal(forbidden.status, 403);
			const first = await POST({ locals: { cmsUser: { role: 'editor' } }, request: makeRequest(false) } as never);
			assert.equal(first.status, 200);
			const original = (await first.json()).files[0] as { name: string; reused: boolean };
			assert.equal(original.reused, false); created = original.name;
			const second = await POST({ locals: { cmsUser: { role: 'editor' } }, request: makeRequest(true) } as never);
			assert.equal(second.status, 200);
			const reused = (await second.json()).files[0] as { name: string; reused: boolean };
			assert.deepEqual(reused, { ...reused, name: created, reused: true });
		} finally {
			if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
			if (created) await rm(path.join(UPLOAD_DIR, created), { force: true });
			await rm(dir, { recursive: true, force: true });
		}
	});
	it('deduplicates simultaneous opt-in uploads across cooperating processes', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-dedup-process-'));
		const target = path.join(dir, 'builder.json');
		const png = (await uniquePng()).toString('base64');
		const mediaUrl = pathToFileURL(path.resolve('src/lib/cms/media.ts')).href;
		const script = `import {saveUpload} from ${JSON.stringify(mediaUrl)}; const bytes=Buffer.from(${JSON.stringify(png)},'base64'); const result=await saveUpload(new File([bytes],'dedup-process.png',{type:'image/png'}),{deduplicate:true}); console.log(JSON.stringify({name:result.name,reused:result.reused}));`;
		const created = new Set<string>();
		const run = () => new Promise<{ name: string; reused: boolean }>((resolve, reject) => {
			const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { env: { ...process.env, BUILDER_DATA_FILE: target, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
			let out = ''; let err = '';
			child.stdout.on('data', (chunk) => { out += String(chunk); });
			child.stderr.on('data', (chunk) => { err += String(chunk); });
			child.on('error', reject);
			child.on('close', (code) => { if (code !== 0) reject(new Error(err)); else { try { const item = JSON.parse(out) as { name: string; reused: boolean }; if (!item.reused) created.add(item.name); resolve(item); } catch { reject(new Error(out)); } } });
		});
		try {
			const settled = await Promise.allSettled(Array.from({ length: 4 }, run));
			const failure = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
			if (failure) throw failure.reason;
			const results = settled.map((item) => (item as PromiseFulfilledResult<{ name: string; reused: boolean }>).value);
			assert.equal(created.size, 1);
			assert.equal(results.filter((item) => !item.reused).length, 1);
			assert.equal(new Set(results.map((item) => item.name)).size, 1);
		} finally {
			for (const name of created) await rm(path.join(UPLOAD_DIR, name), { force: true });
			await rm(dir, { recursive: true, force: true });
		}
	});
});
