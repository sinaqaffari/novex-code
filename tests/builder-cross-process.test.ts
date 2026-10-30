import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { getDraftPage, saveDraftPage } from '../src/lib/builder/store.ts';

const storeUrl = pathToFileURL(path.resolve('src/lib/builder/store.ts')).href;
const documentUrl = pathToFileURL(path.resolve('src/lib/builder/document.ts')).href;
function childSave(file: string, slug: string): Promise<{ ok: boolean; code?: string }> {
	const source = `
		import { saveDraftPage } from ${JSON.stringify(storeUrl)};
		import { createEmptyPageDocument } from ${JSON.stringify(documentUrl)};
		try {
			await saveDraftPage({ slug: ${JSON.stringify(slug)}, expectedRevision: 0, document: createEmptyPageDocument(${JSON.stringify(slug)}) });
			console.log(JSON.stringify({ ok: true }));
		} catch (error) { console.log(JSON.stringify({ ok: false, code: error.code })); }
	`;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', source], {
			env: { ...process.env, BUILDER_DATA_FILE: file, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = ''; let errors = '';
		child.stdout.on('data', (chunk) => { output += String(chunk); });
		child.stderr.on('data', (chunk) => { errors += String(chunk); });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) reject(new Error(`Child exited ${code}: ${errors}`));
			else { try { resolve(JSON.parse(output)); } catch { reject(new Error(`Invalid child output: ${output} ${errors}`)); } }
		});
	});
}

describe('cross-process Builder storage coordination', () => {
	it('serializes independent writers and allows only one optimistic write to the same revision', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-lock-'));
		const file = path.join(dir, 'pages.json');
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = file;
		try {
			const distinct = await Promise.all(Array.from({ length: 6 }, (_, index) => childSave(file, `process-${index}`)));
			assert.ok(distinct.every((item) => item.ok));
			for (let index = 0; index < distinct.length; index++) assert.equal((await getDraftPage(`process-${index}`)).revision, 1);
			const competing = await Promise.all(Array.from({ length: 5 }, () => childSave(file, 'same-page')));
			assert.equal(competing.filter((item) => item.ok).length, 1);
			assert.equal(competing.filter((item) => item.code === 'revision_conflict').length, 4);
			assert.equal((await getDraftPage('same-page')).revision, 1);
			await assert.rejects(readFile(`${file}.lock`), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
		} finally {
			if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
			await rm(dir, { recursive: true, force: true });
		}
	});
	it('fails closed on a persistent lock and never steals it or rewrites data', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-stale-lock-'));
		const file = path.join(dir, 'pages.json');
		const old = process.env.BUILDER_DATA_FILE;
		const oldTimeout = process.env.BUILDER_LOCK_TIMEOUT_MS;
		process.env.BUILDER_DATA_FILE = file;
		process.env.BUILDER_LOCK_TIMEOUT_MS = '50';
		try {
			await writeFile(`${file}.lock`, 'unverified owner');
			await assert.rejects(saveDraftPage({ slug: 'locked', expectedRevision: 0, document: createEmptyPageDocument('locked') }),
				(error: unknown) => error instanceof Error && 'code' in error && error.code === 'storage_locked');
			assert.equal(await readFile(`${file}.lock`, 'utf8'), 'unverified owner');
			assert.equal((await getDraftPage('locked')).revision, 0);
		} finally {
			if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
			if (oldTimeout === undefined) delete process.env.BUILDER_LOCK_TIMEOUT_MS; else process.env.BUILDER_LOCK_TIMEOUT_MS = oldTimeout;
			await rm(dir, { recursive: true, force: true });
		}
	});
});
