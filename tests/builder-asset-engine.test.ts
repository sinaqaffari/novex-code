import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { collectDocumentAssets, localBuilderAssetIdentity } from '../src/lib/builder/assets.ts';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { getDraftPage, listBuilderAssetUsages, publishPage, saveBuilderTemplate, saveDraftPage, withUnusedBuilderUpload } from '../src/lib/builder/store.ts';
import { deleteUpload, listMedia, saveUpload, UPLOAD_DIR } from '../src/lib/cms/media.ts';

describe('builder asset usage and safe deletion', () => {
	it('canonicalizes managed references and legacy URLs without resolving remote URLs', () => {
		assert.equal(localBuilderAssetIdentity('media://UPLOADS/photo.png'), 'uploads/photo.png');
		assert.equal(localBuilderAssetIdentity('/media/uploads/photo%2Epng?width=800'), 'uploads/photo.png');
		assert.equal(localBuilderAssetIdentity('https://example.com/media/uploads/photo.png'), null);
		assert.equal(localBuilderAssetIdentity('/media/uploads/../secret.png'), 'assets/secret.png');
	});
	it('protects drafts, published snapshots, revisions and templates, failing closed on corrupt storage', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-assets-'));
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64');
		const uploaded = await saveUpload(new File([png], 'asset-test.png', { type: 'image/png' }));
		try {
			assert.deepEqual({ mime: uploaded.mimeType, width: uploaded.width, height: uploaded.height }, { mime: 'image/png', width: 1, height: 1 });
			const listed = (await listMedia()).find((item) => item.name === uploaded.name);
			assert.deepEqual({ mime: listed?.mimeType, width: listed?.width, height: listed?.height }, { mime: 'image/png', width: 1, height: 1 });
			const src = `media://uploads/${uploaded.name}`;
			let doc = addNode(createEmptyPageDocument('asset-usage'), 'Image', { id: 'node_image0001' });
			doc = updateNodeProps(doc, 'node_image0001', { src });
			assert.equal(collectDocumentAssets(doc)[0].identity, `uploads/${uploaded.name}`);
			await saveDraftPage({ slug: doc.slug, expectedRevision: 0, document: doc });
			await publishPage({ slug: doc.slug, expectedRevision: 1, document: doc });
			await saveBuilderTemplate({ name: 'Asset template', document: doc });
			const usages = await listBuilderAssetUsages(`uploads/${uploaded.name}`);
			assert.deepEqual(new Set(usages.map((usage) => usage.scope)), new Set(['draft', 'published', 'revision', 'template']));
			await assert.rejects(deleteUpload(uploaded.name), (error: unknown) => error instanceof Error && 'status' in error && error.status === 409);
			assert.ok((await stat(path.join(UPLOAD_DIR, uploaded.name))).isFile());
			const noImage = updateNodeProps((await getDraftPage(doc.slug)).draft, 'node_image0001', { src: '' });
			await saveDraftPage({ slug: doc.slug, expectedRevision: 2, document: noImage });
			await assert.rejects(deleteUpload(uploaded.name)); // published/history/template still reference it
			let removed = false;
			await withUnusedBuilderUpload('unused.png', async () => { removed = true; });
			assert.equal(removed, true);
			const { writeFile } = await import('node:fs/promises');
			await writeFile(process.env.BUILDER_DATA_FILE!, '{corrupt');
			await assert.rejects(deleteUpload(uploaded.name));
			assert.ok((await stat(path.join(UPLOAD_DIR, uploaded.name))).isFile());
		} finally {
			if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
			// This test created the file; remove only that test artifact.
			await rm(path.join(UPLOAD_DIR, uploaded.name), { force: true });
			await rm(dir, { recursive: true, force: true });
		}
	});
});
