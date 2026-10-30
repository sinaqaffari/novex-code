import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BuilderStoreError, deleteBuilderTemplate, getBuilderTemplate, getDraftPage, getPageHistory, getPublishedPage, listBuilderTemplates, saveBuilderTemplate, saveDraftPage, publishPage } from '../src/lib/builder/store.ts';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';

let temporaryDirectory = '';
let priorFile: string | undefined;

before(async () => {
	temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'novex-builder-store-'));
	priorFile = process.env.BUILDER_DATA_FILE;
	process.env.BUILDER_DATA_FILE = path.join(temporaryDirectory, 'builder-pages.json');
});

after(async () => {
	if (priorFile === undefined) delete process.env.BUILDER_DATA_FILE;
	else process.env.BUILDER_DATA_FILE = priorFile;
	await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('Builder revision store', () => {
	it('creates a revisioned draft, detects stale writes, publishes, and returns history', async () => {
		const initial = await getDraftPage('store-test');
		assert.equal(initial.revision, 0);
		let document = addNode(createEmptyPageDocument('store-test', 'صفحهٔ پایدار'), 'Heading', { id: 'node_heading01' });
		document = updateNodeProps(document, 'node_heading01', { text: 'ذخیرهٔ پایدار' });
		const saved = await saveDraftPage({ slug: 'store-test', expectedRevision: 0, document });
		assert.equal(saved.revision, 1);
		await assert.rejects(
			saveDraftPage({ slug: 'store-test', expectedRevision: 0, document }),
			(error: unknown) => error instanceof BuilderStoreError && error.status === 409 && error.code === 'revision_conflict',
		);
		const published = await publishPage({ slug: 'store-test', expectedRevision: 1, document });
		assert.equal(published.revision, 2);
		assert.equal(published.publishedRevision, 2);
		const publicPage = await getPublishedPage('store-test');
		assert.equal(publicPage?.document.title, 'صفحهٔ پایدار');
		assert.equal((await getPageHistory('store-test')).length, 2);
	});

	it('serializes concurrent optimistic saves so only one writer wins', async () => {
		const first = createEmptyPageDocument('concurrent-test', 'نویسندهٔ یک');
		const second = createEmptyPageDocument('concurrent-test', 'نویسندهٔ دو');
		const results = await Promise.allSettled([
			saveDraftPage({ slug: 'concurrent-test', expectedRevision: 0, document: first }),
			saveDraftPage({ slug: 'concurrent-test', expectedRevision: 0, document: second }),
		]);
		assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
		const rejected = results.find((result) => result.status === 'rejected');
		assert.equal(rejected?.status, 'rejected');
		if (rejected?.status === 'rejected') {
			assert.ok(rejected.reason instanceof BuilderStoreError);
			assert.equal(rejected.reason.status, 409);
		}
		assert.equal((await getDraftPage('concurrent-test')).revision, 1);
	});

	it('stores reusable page templates separately from page revisions', async () => {
		const document = createEmptyPageDocument('template-source', 'قالب نمونه');
		const saved = await saveBuilderTemplate({ name: 'قالب آزمایشی', document });
		assert.match(saved.id, /^template_/);
		assert.equal((await listBuilderTemplates()).length, 1);
		assert.equal((await getBuilderTemplate(saved.id))?.document.title, 'قالب نمونه');
		await deleteBuilderTemplate(saved.id);
		assert.equal(await getBuilderTemplate(saved.id), null);
	});

	it('does not overwrite a corrupt database on read', async () => {
		const file = process.env.BUILDER_DATA_FILE!;
		const corrupt = '{ not valid JSON';
		await writeFile(file, corrupt, 'utf8');
		await assert.rejects(getDraftPage('store-test'), (error: unknown) => error instanceof BuilderStoreError && error.code === 'storage_corrupt');
		assert.equal(await readFile(file, 'utf8'), corrupt);
	});
});

it('preserves unknown store metadata on subsequent writes rather than silently discarding it', async () => {
	const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
	const os = await import('node:os');
	const path = await import('node:path');
	const { createEmptyPageDocument } = await import('../src/lib/builder/document.ts');
	const { saveDraftPage, saveBuilderTemplate } = await import('../src/lib/builder/store.ts');
	const directory = await mkdtemp(path.join(os.tmpdir(), 'novex-store-metadata-'));
	const old = process.env.BUILDER_DATA_FILE; const file = path.join(directory, 'pages.json'); process.env.BUILDER_DATA_FILE = file;
	try {
		const document = createEmptyPageDocument('metadata-page');
		await saveDraftPage({ slug: document.slug, expectedRevision: 0, document });
		const template = await saveBuilderTemplate({ name: 'Metadata template', document });
		const database = JSON.parse(await readFile(file, 'utf8'));
		database.futureRoot = { retained: true };
		database.pages[document.slug].futurePage = { retained: 2 };
		database.pages[document.slug].revisions[0].futureRevision = 'retained';
		database.templates[template.id].futureTemplate = [1, 2];
		await writeFile(file, JSON.stringify(database));
		await saveDraftPage({ slug: document.slug, expectedRevision: 1, document });
		const persisted = JSON.parse(await readFile(file, 'utf8'));
		assert.deepEqual(persisted.futureRoot, { retained: true });
		assert.deepEqual(persisted.pages[document.slug].futurePage, { retained: 2 });
		assert.equal(persisted.pages[document.slug].revisions[0].futureRevision, 'retained');
		assert.deepEqual(persisted.templates[template.id].futureTemplate, [1, 2]);
	} finally {
		if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
		await rm(directory, { recursive: true, force: true });
	}
});
