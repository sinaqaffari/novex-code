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
import { inspectSiteKitArchive } from '../src/lib/builder/site-kit-archive.ts';
import { listSiteKits } from '../src/lib/builder/site-kits.ts';
import { deleteUpload, UPLOAD_DIR } from '../src/lib/cms/media.ts';
import { getDraftPage, getPublishedPage, publishPage, saveDraftPage, type KitUpdateReview } from '../src/lib/builder/store.ts';

interface Entry { name: string; data: Buffer; mode?: number; compress?: boolean }
async function archive(entries: Entry[]): Promise<Buffer> {
	const zip = new ZipFile();
	const chunks: Buffer[] = [];
	const done = new Promise<Buffer>((resolve, reject) => {
		zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
		zip.outputStream.on('error', reject);
		zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
	});
	for (const entry of entries) zip.addBuffer(entry.data, entry.name, { ...(entry.mode === undefined ? {} : { mode: entry.mode }), ...(entry.compress === undefined ? {} : { compress: entry.compress }) });
	zip.end();
	return done;
}
async function uniquePng(): Promise<Buffer> {
	return sharp(randomBytes(16 * 16 * 3), { raw: { width: 16, height: 16, channels: 3 } }).png().toBuffer();
}
function kit(version: string, alt: string) {
	const base = listSiteKits()[0];
	let document = addNode(createEmptyPageDocument('archive-source'), 'Image', { id: 'node_archiveimg1' });
	document = updateNodeProps(document, 'node_archiveimg1', { src: 'media://uploads/hero.png', alt });
	return { ...base, id: 'archive-test', version, requiredComponents: ['Image'], assets: ['media://uploads/hero.png'], pages: [{ suffix: 'home', title: 'Archive home', document }] };
}
function request(bytes: Buffer, action: 'inspect' | 'install' | 'update' | 'review', prefix = 'archive', confirm = true, decision?: unknown): Request {
	const form = new FormData();
	form.set('action', action); form.set('archive', new File([new Uint8Array(bytes)], 'kit.zip', { type: 'application/zip' }));
	if (action !== 'inspect') { form.set('prefix', prefix); if (confirm) form.set('confirm', 'true'); }
	if (decision !== undefined) form.set('decision', JSON.stringify(decision));
	return new Request('http://local/cms/api/builder/kits/archive', { method: 'POST', body: form });
}
async function isolated(run: (created: Set<string>) => Promise<void>) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-kit-archive-'));
	const old = process.env.BUILDER_DATA_FILE;
	const created = new Set<string>();
	process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
	try { await run(created); }
	finally {
		if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
		await rm(dir, { recursive: true, force: true });
		for (const name of created) await deleteUpload(name).catch(() => undefined);
	}
}

describe('data-only site-kit ZIP archives', () => {
	it('inspects validated assets without writing and rejects undeclared, traversal, executable and oversized entries', async () => {
		const image = await uniquePng();
		const manifest = Buffer.from(JSON.stringify(kit('1.0.0', 'Cover')));
		const valid = await archive([{ name: 'kit.json', data: manifest }, { name: 'assets/hero.png', data: image }]);
		const result = await inspectSiteKitArchive(valid);
		const hash = createHash('sha256').update(image).digest('hex');
		assert.equal(result.assets[0].destination, `media://uploads/kit-${hash}.png`);
		assert.equal(result.kit.pages[0].document.nodes[0].type === 'Image' && result.kit.pages[0].document.nodes[0].props.src, result.assets[0].destination);
		await assert.rejects(stat(path.join(UPLOAD_DIR, `kit-${hash}.png`)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		for (const extra of [
			{ name: 'script.js', data: Buffer.from('alert(1)') },
			{ name: 'assets/unused.png', data: image },
			{ name: 'assets/evil.png', data: image, mode: 0o120777 },
			{ name: 'assets/huge.png', data: Buffer.alloc(8 * 1024 * 1024 + 1, 1) },
		]) await assert.rejects(inspectSiteKitArchive(await archive([{ name: 'kit.json', data: manifest }, { name: 'assets/hero.png', data: image }, extra])));
		await assert.rejects(inspectSiteKitArchive(await archive([{ name: 'kit.json', data: manifest }, { name: 'assets/hero.png', data: Buffer.from('not an image') }])));
		await assert.rejects(inspectSiteKitArchive(await archive([{ name: 'kit.json', data: manifest }, { name: 'assets/hero.png', data: image }, { name: 'assets/hero.png', data: image }])));
		const traversal = await archive([{ name: 'kit.json', data: manifest }, { name: 'assets/hero.png', data: image }, { name: 'xx/evil', data: Buffer.from('bad') }]);
		const traversed = Buffer.from(traversal.toString('binary').replaceAll('xx/evil', '../evil'), 'binary');
		await assert.rejects(inspectSiteKitArchive(traversed));
		const corrupt = await archive([{ name: 'kit.json', data: manifest, compress: false }, { name: 'assets/hero.png', data: image, compress: false }]);
		const index = corrupt.indexOf(image);
		assert.notEqual(index, -1);
		corrupt[index + image.length - 1] ^= 1;
		await assert.rejects(inspectSiteKitArchive(corrupt), /checksum|اندازه/i);
	});
	it('checks permissions and confirmation, installs stable media, merges an update, and retains publication', async () => isolated(async (created) => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/archive.ts');
		const image = await uniquePng();
		const first = await archive([{ name: 'kit.json', data: Buffer.from(JSON.stringify(kit('1.0.0', 'Initial'))) }, { name: 'assets/hero.png', data: image }]);
		const call = (role: string, bytes: Buffer, action: 'inspect' | 'install' | 'update', confirm = true) => POST({ locals: { cmsUser: { role } }, request: request(bytes, action, 'archived', confirm) } as never);
		assert.equal((await call('subscriber', first, 'inspect')).status, 403);
		assert.equal((await call('contributor', first, 'inspect')).status, 200);
		assert.equal((await call('contributor', first, 'install')).status, 403);
		assert.equal((await call('editor', first, 'install', false)).status, 400);
		const response = await call('editor', first, 'install');
		assert.equal(response.status, 201);
		const installed = await response.json();
		for (const name of installed.createdUploads as string[]) created.add(name);
		assert.equal(installed.uploaded, 1);
		const slug = 'archived-home';
		const record = await getDraftPage(slug);
		const imageNode = record.draft.nodes[0];
		assert.equal(imageNode.type, 'Image');
		if (imageNode.type !== 'Image') throw new Error('expected image');
		assert.equal(imageNode.props.src, `media://uploads/${installed.createdUploads[0]}`);
		await publishPage({ slug, expectedRevision: record.revision, document: record.draft });
		await saveDraftPage({ slug, expectedRevision: 2, document: { ...record.draft, title: 'Locally changed title' } });
		const second = await archive([{ name: 'kit.json', data: Buffer.from(JSON.stringify(kit('1.1.0', 'Updated upstream'))) }, { name: 'assets/hero.png', data: image }]);
		const update = await call('editor', second, 'update');
		assert.equal(update.status, 200);
		const updated = await update.json();
		for (const name of updated.createdUploads as string[]) created.add(name);
		assert.equal(updated.uploaded, 0);
		assert.equal(updated.reused, 1);
		const draft = (await getDraftPage(slug)).draft;
		assert.equal(draft.title, 'Locally changed title');
		assert.equal(draft.nodes[0].type === 'Image' && draft.nodes[0].props.alt, 'Updated upstream');
		const publishedNode = (await getPublishedPage(slug))?.document.nodes[0];
		assert.equal(publishedNode?.type === 'Image' && publishedNode.props.alt, 'Initial');
	}));
	it('reviews ZIP updates without uploads and rolls back new assets if approval becomes stale', async () => isolated(async (created) => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/archive.ts');
		const firstImage = await uniquePng();
		const nextImage = await uniquePng();
		const nextName = `kit-${createHash('sha256').update(nextImage).digest('hex')}.png`;
		await assert.rejects(stat(path.join(UPLOAD_DIR, nextName)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		const first = await archive([{ name: 'kit.json', data: Buffer.from(JSON.stringify(kit('1.0.0', 'Original'))) }, { name: 'assets/hero.png', data: firstImage }]);
		const next = await archive([{ name: 'kit.json', data: Buffer.from(JSON.stringify(kit('1.1.0', 'Upstream'))) }, { name: 'assets/hero.png', data: nextImage }]);
		const invoke = (bytes: Buffer, action: 'inspect' | 'install' | 'update' | 'review', decision?: unknown) => POST({ locals: { cmsUser: { role: 'editor' } }, request: request(bytes, action, 'zipreview', true, decision) } as never);
		const install = await invoke(first, 'install');
		assert.equal(install.status, 201);
		for (const name of (await install.json()).createdUploads as string[]) created.add(name);
		const current = await getDraftPage('zipreview-home');
		await publishPage({ slug: current.slug, expectedRevision: current.revision, document: current.draft });
		const published = await getPublishedPage(current.slug);
		const publishedDraft = await getDraftPage(current.slug);
		await saveDraftPage({ slug: current.slug, expectedRevision: publishedDraft.revision, document: updateNodeProps(publishedDraft.draft, 'node_archiveimg1', { alt: 'Local' }) });
		const preview = await invoke(next, 'review');
		assert.equal(preview.status, 200);
		const { review } = await preview.json() as { review: KitUpdateReview };
		assert.equal(review.fields.length, 1);
		await assert.rejects(stat(path.join(UPLOAD_DIR, nextName)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		const choices = review.fields.map(({ slug, path }) => ({ slug, path, choice: 'incoming' }));
		const changed = await getDraftPage(current.slug);
		await saveDraftPage({ slug: current.slug, expectedRevision: changed.revision, document: { ...changed.draft, description: 'Changed after review' } });
		const stale = await invoke(next, 'update', { token: review.token, choices });
		assert.equal(stale.status, 409);
		assert.equal((await stale.json()).code, 'kit_review_stale');
		await assert.rejects(stat(path.join(UPLOAD_DIR, nextName)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		assert.deepEqual(await getPublishedPage(current.slug), published);
		const fresh = (await (await invoke(next, 'review')).json() as { review: KitUpdateReview }).review;
		const accepted = await invoke(next, 'update', { token: fresh.token, choices: fresh.fields.map(({ slug, path }) => ({ slug, path, choice: 'incoming' })) });
		assert.equal(accepted.status, 200);
		for (const name of (await accepted.json()).createdUploads as string[]) created.add(name);
		const merged = (await getDraftPage(current.slug)).draft;
		assert.equal(merged.description, 'Changed after review');
		assert.equal(merged.nodes[0].type === 'Image' && merged.nodes[0].props.alt, 'Upstream');
		assert.deepEqual(await getPublishedPage(current.slug), published);
	}));
	it('rolls back newly created assets if installation conflicts', async () => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/archive.ts');
		const image = await uniquePng();
		const bytes = await archive([{ name: 'kit.json', data: Buffer.from(JSON.stringify(kit('1.0.0', 'Cover'))) }, { name: 'assets/hero.png', data: image }]);
		const existing = addNode(createEmptyPageDocument('conflict-home'), 'Text', { id: 'node_existing01' });
		await saveDraftPage({ slug: existing.slug, expectedRevision: 0, document: existing });
		const hash = createHash('sha256').update(image).digest('hex');
		const file = path.join(UPLOAD_DIR, `kit-${hash}.png`);
		const response = await POST({ locals: { cmsUser: { role: 'editor' } }, request: request(bytes, 'install', 'conflict') } as never);
		assert.equal(response.status, 409);
		assert.equal((await getDraftPage(existing.slug)).revision, 1);
		await assert.rejects(stat(file), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
	}));
});
