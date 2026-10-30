import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, symlink, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import sharp from 'sharp';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, insertDocumentFragment, updateNodeProps } from '../src/lib/builder/operations.ts';
import { sectionFragment } from '../src/lib/builder/shared-sections.ts';
import { localBuilderAssetIdentity } from '../src/lib/builder/assets.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'novex-builder-asset-atomic-'));
const previous = { blog: process.env.CMS_BLOG_DIR, assets: process.env.CMS_ASSETS_DIR, builder: process.env.BUILDER_DATA_FILE, commerce: process.env.COMMERCE_DB_FILE };
process.env.CMS_BLOG_DIR = path.join(root, 'blog');
process.env.CMS_ASSETS_DIR = path.join(root, 'assets');
process.env.BUILDER_DATA_FILE = path.join(root, 'builder.json');
process.env.COMMERCE_DB_FILE = path.join(root, 'commerce.json');
await mkdir(process.env.CMS_BLOG_DIR, { recursive: true });
const { saveUpload, deleteUpload, UPLOAD_DIR } = await import('../src/lib/cms/media.ts');
const { saveDraftPage, publishPage, getDraftPage, installDraftPages, saveBuilderTemplate, createSharedSection, updateSharedSection, synchronizeSharedSection, listBuilderAssetUsages } = await import('../src/lib/builder/store.ts');
const { PUT: saveRoute } = await import('../src/pages/cms/api/builder/pages/[slug].ts');
after(async () => {
	for (const [key, value] of [['CMS_BLOG_DIR', previous.blog], ['CMS_ASSETS_DIR', previous.assets], ['BUILDER_DATA_FILE', previous.builder], ['COMMERCE_DB_FILE', previous.commerce]] as const) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	await rm(root, { recursive: true, force: true });
});

async function upload() {
	const png = await sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
	return saveUpload(new File([new Uint8Array(png)], 'builder-asset.png', { type: 'image/png' }));
}
function imagePage(slug: string, src: string) {
	let doc = addNode(createEmptyPageDocument(slug), 'Image', { id: 'node_picture01' });
	return updateNodeProps(doc, 'node_picture01', { src, alt: 'Picture' });
}
const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'missing_asset';
const conflict = (error: unknown) => error instanceof Error && 'status' in error && error.status === 409;
const origins = ['https://site.example'];

describe('atomic Builder asset coordination', () => {
	it('classifies only known same-origin image URLs for saves and publication', () => {
		assert.equal(localBuilderAssetIdentity('https://site.example/media/uploads/one%2Epng', { origins }), 'uploads/one.png');
		assert.equal(localBuilderAssetIdentity('https://remote.example/media/uploads/one.png', { origins }), null);
		assert.equal(localBuilderAssetIdentity('https://remote.example/media/uploads/one.png', { anyAbsolute: true }), 'uploads/one.png');
		assert.equal(localBuilderAssetIdentity('https://user@site.example/media/uploads/one.png', { origins }), null);
	});
	it('serializes draft saves with deletion in both orderings for relative and absolute local URLs', async () => {
		for (const absolute of [false, true]) for (const deleteFirst of [false, true]) {
			const image = await upload();
			const slug = `race-${absolute ? 'absolute' : 'relative'}-${deleteFirst ? 'delete' : 'save'}`;
			const source = absolute ? `https://site.example${image.publicUrl}` : image.publicUrl;
			const doc = imagePage(slug, source);
			const save = () => saveDraftPage({ slug, expectedRevision: 0, document: doc, origins });
			const remove = () => deleteUpload(image.name);
			const results = await Promise.allSettled(deleteFirst ? [remove(), save()] : [save(), remove()]);
			assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
			const saved = await getDraftPage(slug);
			if (saved.revision) {
				assert.ok((await stat(path.join(UPLOAD_DIR, image.name))).isFile());
				assert.ok((await listBuilderAssetUsages(`uploads/${image.name}`)).some((use) => use.scope === 'draft'));
			} else await assert.rejects(stat(path.join(UPLOAD_DIR, image.name)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		}
	});
	it('leaves legacy missing references editable but rejects new missing or symlinked files', async () => {
		const image = await upload(); const doc = imagePage('legacy-image', image.publicUrl);
		await saveDraftPage({ slug: doc.slug, expectedRevision: 0, document: doc });
		// Simulate an external operator removing an already referenced legacy file.
		await unlink(path.join(UPLOAD_DIR, image.name));
		await saveDraftPage({ slug: doc.slug, expectedRevision: 1, document: { ...doc, title: 'Still editable' } });
		const changed = updateNodeProps(doc, 'node_picture01', { src: '/media/uploads/another-missing.png' });
		await assert.rejects(saveDraftPage({ slug: doc.slug, expectedRevision: 2, document: changed }), missing);
		assert.equal((await getDraftPage(doc.slug)).revision, 2);
		await symlink(path.join(root, 'outside.png'), path.join(UPLOAD_DIR, 'symlink.png'));
		await assert.rejects(saveDraftPage({ slug: 'symlink-page', expectedRevision: 0, document: imagePage('symlink-page', '/media/uploads/symlink.png') }), missing);
	});
	it('does not fetch or reject genuine remote images, but checks same-origin images on publication', async () => {
		const remote = imagePage('external-image', 'https://remote.example/media/uploads/missing.png');
		await saveDraftPage({ slug: remote.slug, expectedRevision: 0, document: remote, origins });
		await publishPage({ slug: remote.slug, expectedRevision: 1, document: remote, origins });
		const local = imagePage('missing-absolute', 'https://site.example/media/uploads/missing.png');
		await assert.rejects(saveDraftPage({ slug: local.slug, expectedRevision: 0, document: local, origins }), missing);
		await assert.rejects(publishPage({ slug: local.slug, expectedRevision: 0, document: local, origins }), missing);
	});
	it('fails whole batch, template and section changes before saving missing media', async () => {
		const good = imagePage('batch-good', '');
		const bad = imagePage('batch-bad', '/media/uploads/not-there.png');
		await assert.rejects(installDraftPages([good, bad]), missing);
		assert.equal((await getDraftPage('batch-good')).revision, 0);
		await assert.rejects(saveBuilderTemplate({ name: 'Missing', document: bad }), missing);
		let sectionDoc = addNode(createEmptyPageDocument('section-doc'), 'Container', { id: 'node_section01' });
		sectionDoc = addNode(sectionDoc, 'Image', { id: 'node_sectionimg1', parentId: 'node_section01' });
		sectionDoc = updateNodeProps(sectionDoc, 'node_sectionimg1', { src: '/media/uploads/not-there.png' });
		await assert.rejects(createSharedSection('Missing', sectionDoc.nodes[0]), missing);
		const blank = addNode(createEmptyPageDocument('section-blank'), 'Container', { id: 'node_section02' });
		const section = await createSharedSection('Blank', blank.nodes[0]);
		await assert.rejects(updateSharedSection(section.id, section.revision, sectionDoc.nodes[0]), missing);
	});
	it('rejects sync of a legacy section whose source file disappeared outside the lock', async () => {
		const image = await upload();
		let source = addNode(createEmptyPageDocument('source'), 'Container', { id: 'node_section03' });
		const section = await createSharedSection('Source', source.nodes[0]);
		const target = insertDocumentFragment(createEmptyPageDocument('sync-target'), sectionFragment(section), null).document;
		await saveDraftPage({ slug: target.slug, expectedRevision: 0, document: target });
		source = addNode(source, 'Image', { id: 'node_sectionimg3', parentId: 'node_section03' });
		source = updateNodeProps(source, 'node_sectionimg3', { src: image.publicUrl });
		const updated = await updateSharedSection(section.id, 1, source.nodes[0]);
		await assert.rejects(deleteUpload(image.name), conflict);
		// Simulate a noncooperating operator deleting the source's file.
		await unlink(path.join(UPLOAD_DIR, image.name));
		await assert.rejects(synchronizeSharedSection(section.id, updated.revision), missing);
		assert.equal((await getDraftPage(target.slug)).revision, 1);
	});
	it('uses the forwarded public origin when validating Builder API writes', async () => {
		const request = (doc: ReturnType<typeof imagePage>) => new Request('http://internal/cms/api/builder/pages/api-image', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-forwarded-host': 'site.example', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ expectedRevision: 0, document: doc }) });
		const local = await saveRoute({ locals: { cmsUser: { role: 'editor' } }, params: { slug: 'api-image' }, request: request(imagePage('api-image', 'https://site.example/media/uploads/missing.png')) } as never);
		assert.equal(local.status, 409);
		const remote = await saveRoute({ locals: { cmsUser: { role: 'editor' } }, params: { slug: 'api-image' }, request: request(imagePage('api-image', 'https://external.example/media/uploads/missing.png')) } as never);
		assert.equal(remote.status, 200);
	});
});
