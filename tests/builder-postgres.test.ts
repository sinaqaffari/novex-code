import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, it } from 'node:test';

let root = '';
let store: typeof import('../src/lib/builder/store.ts');
let document: typeof import('../src/lib/builder/document.ts');
let operations: typeof import('../src/lib/builder/operations.ts');
let kits: typeof import('../src/lib/builder/site-kits.ts');
let media: typeof import('../src/lib/cms/media.ts');
const keys = ['BUILDER_DATA_FILE', 'CMS_ASSETS_DIR', 'CMS_BLOG_DIR', 'COMMERCE_DB_FILE', 'NOVEX_BACKEND_URL', 'NOVEX_BACKEND_TOKEN', 'NOVEX_BUILDER_STORE', 'NOVEX_COMMERCE_STORE'] as const;
const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const fakeToken = 'builder-test-only-token-0123456789abcdef0123456789';

before(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), 'novex-builder-postgres-'));
	process.env.CMS_ASSETS_DIR = path.join(root, 'assets');
	process.env.CMS_BLOG_DIR = path.join(root, 'blog');
	process.env.COMMERCE_DB_FILE = path.join(root, 'commerce.json');
	process.env.BUILDER_DATA_FILE = path.join(root, 'initial.json');
	delete process.env.NOVEX_BUILDER_STORE;
	delete process.env.NOVEX_COMMERCE_STORE;
	await mkdir(path.join(root, 'assets', 'uploads'), { recursive: true });
	await mkdir(path.join(root, 'blog'), { recursive: true });
	await cp('src/assets/blog-placeholder-about.jpg', path.join(root, 'assets', 'blog-placeholder-about.jpg'));
	store = await import('../src/lib/builder/store.ts');
	document = await import('../src/lib/builder/document.ts');
	operations = await import('../src/lib/builder/operations.ts');
	kits = await import('../src/lib/builder/site-kits.ts');
	media = await import('../src/lib/cms/media.ts');
});

after(async () => {
	for (const key of keys) {
		const value = originalEnv[key];
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	await rm(root, { recursive: true, force: true });
});

interface FakeSnapshot { storeId: string; sourceHash: string; revision: number; snapshot: unknown }
function fakeBuilderBackend(interrupt = false) {
	let remote: FakeSnapshot | null = null;
	let interrupted = interrupt;
	return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const pathname = new URL(input instanceof Request ? input.url : String(input)).pathname;
		if (pathname === '/v1/builder' && (!init?.method || init.method === 'GET')) {
			return remote ? Response.json({ ok: true, ...remote }) : Response.json({ ok: false, code: 'not_initialized' }, { status: 404 });
		}
		if (pathname === '/v1/builder/bootstrap' && init?.method === 'POST') {
			const body = JSON.parse(String(init.body)) as Omit<FakeSnapshot, 'revision'>;
			const replayed = Boolean(remote);
			if (!remote) remote = { ...body, revision: 0 };
			else if (remote.storeId !== body.storeId || remote.sourceHash !== body.sourceHash || remote.revision !== 0 || JSON.stringify(remote.snapshot) !== JSON.stringify(body.snapshot)) return Response.json({ ok: false, code: 'already_initialized' }, { status: 409 });
			if (interrupted) { interrupted = false; throw new Error('connection lost after commit'); }
			return Response.json({ ok: true, revision: 0, replayed }, { status: replayed ? 200 : 201 });
		}
		if (pathname === '/v1/builder' && init?.method === 'PUT') {
			const body = JSON.parse(String(init.body)) as { storeId: string; expectedRevision: number; snapshot: unknown };
			if (!remote || remote.storeId !== body.storeId || remote.revision !== body.expectedRevision) return Response.json({ ok: false, code: 'conflict' }, { status: 409 });
			remote = { ...remote, revision: remote.revision + 1, snapshot: body.snapshot };
			return Response.json({ ok: true, revision: remote.revision });
		}
		throw new Error(`Unexpected fake request: ${pathname}`);
	};
}

it('resumes an interrupted Builder migration only with the unchanged original and never falls back', async () => {
	const file = path.join(root, 'interrupted.json');
	const original = JSON.stringify({ schemaVersion: 1, pages: {}, retained: { legacy: true } }, null, 2) + '\n';
	await writeFile(file, original);
	process.env.BUILDER_DATA_FILE = file;
	process.env.NOVEX_BACKEND_URL = 'http://fake.invalid';
	process.env.NOVEX_BACKEND_TOKEN = fakeToken;
	delete process.env.NOVEX_BUILDER_STORE;
	const oldFetch = globalThis.fetch;
	globalThis.fetch = fakeBuilderBackend(true);
	try {
		await assert.rejects(store.migrateBuilderToPostgres(), (error: unknown) => error instanceof store.BuilderStoreError && error.status === 503);
		const pending = JSON.parse(await readFile(`${file}.novex-postgres`, 'utf8')) as { state: string; storeId: string };
		assert.equal(pending.state, 'pending');
		assert.equal(await readFile(file, 'utf8'), original);
		await assert.rejects(store.getDraftPage('sample'), (error: unknown) => error instanceof store.BuilderStoreError && error.status === 503);
		await writeFile(file, original.replace('true', 'false'));
		await assert.rejects(store.migrateBuilderToPostgres(), /source changed/i);
		await writeFile(file, original);
		await store.migrateBuilderToPostgres();
		const complete = JSON.parse(await readFile(`${file}.novex-postgres`, 'utf8')) as { state: string; storeId: string };
		assert.equal(complete.state, 'complete'); assert.equal(complete.storeId, pending.storeId);
		assert.equal(await readFile(file, 'utf8'), original);
		await assert.rejects(store.getDraftPage('sample'), (error: unknown) => error instanceof store.BuilderStoreError && error.status === 503);
		process.env.NOVEX_BUILDER_STORE = 'postgres';
		assert.equal((await store.getDraftPage('sample')).revision, 0);
		const saved = await store.saveDraftPage({ slug: 'sample', expectedRevision: 0, document: document.createEmptyPageDocument('sample') });
		assert.equal(saved.revision, 1);
		const backup = path.join(root, 'interrupted-export.json');
		await store.exportPostgresBuilder(backup);
		assert.equal((await stat(backup)).mode & 0o077, 0);
		assert.deepEqual((JSON.parse(await readFile(backup, 'utf8')) as { retained: unknown }).retained, { legacy: true });
		await assert.rejects(store.exportPostgresBuilder(backup));
		await assert.rejects(store.exportPostgresBuilder(file));
		await writeFile(`${file}.novex-postgres`, '{broken marker');
		await assert.rejects(store.getDraftPage('sample'), (error: unknown) => error instanceof store.BuilderStoreError && error.status === 503 && error.code === 'storage_unavailable');
	} finally { globalThis.fetch = oldFetch; delete process.env.NOVEX_BUILDER_STORE; }
});

it('validates the original, rejects symlinks and requires explicit empty-store initialization', async () => {
	process.env.NOVEX_BACKEND_URL = 'http://fake.invalid'; process.env.NOVEX_BACKEND_TOKEN = fakeToken;
	const oldFetch = globalThis.fetch; globalThis.fetch = fakeBuilderBackend();
	try {
		const bad = path.join(root, 'bad.json');
		const corrupt = JSON.stringify({ schemaVersion: 1, pages: { invalid: { revision: 1 } } });
		await writeFile(bad, corrupt); process.env.BUILDER_DATA_FILE = bad;
		await assert.rejects(store.migrateBuilderToPostgres(), (error: unknown) => error instanceof store.BuilderStoreError);
		assert.equal(await readFile(bad, 'utf8'), corrupt); await assert.rejects(stat(`${bad}.novex-postgres`));
		const link = path.join(root, 'link.json'); await symlink(bad, link); process.env.BUILDER_DATA_FILE = link;
		await assert.rejects(store.migrateBuilderToPostgres(), /regular file/i); await assert.rejects(stat(`${link}.novex-postgres`));
		const empty = path.join(root, 'empty.json'); process.env.BUILDER_DATA_FILE = empty;
		await assert.rejects(store.migrateBuilderToPostgres(), /source is missing/i);
		await store.migrateBuilderToPostgres({ allowEmpty: true });
		assert.equal((JSON.parse(await readFile(`${empty}.novex-postgres`, 'utf8')) as { source: string }).source, 'empty');
		process.env.NOVEX_BUILDER_STORE = 'postgres';
		await store.saveDraftPage({ slug: 'new-page', expectedRevision: 0, document: document.createEmptyPageDocument('new-page') });
		assert.equal((await store.getDraftPage('new-page')).revision, 1);
		assert.equal((await store.getDraftPage('constructor')).revision, 0);
		await store.saveDraftPage({ slug: 'constructor', expectedRevision: 0, document: document.createEmptyPageDocument('constructor') });
		assert.equal((await store.getDraftPage('constructor')).revision, 1);
		await assert.rejects(stat(empty), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
		const occupied = path.join(root, 'occupied.json');
		const otherSource = JSON.stringify({ schemaVersion: 1, pages: {}, extension: 'do not overwrite' });
		await writeFile(occupied, otherSource); process.env.BUILDER_DATA_FILE = occupied;
		await assert.rejects(store.migrateBuilderToPostgres(), (error: unknown) => error instanceof store.BuilderStoreError && error.code === 'migration_conflict');
		await assert.rejects(stat(`${occupied}.novex-postgres`));
		assert.equal(await readFile(occupied, 'utf8'), otherSource);
		process.env.BUILDER_DATA_FILE = empty;
		assert.equal((await store.getDraftPage('new-page')).revision, 1);
	} finally { globalThis.fetch = oldFetch; delete process.env.NOVEX_BUILDER_STORE; }
});


it('does not replay a pending migration after the remote snapshot has changed', async () => {
	const file = path.join(root, 'changed-remote.json');
	const original = JSON.stringify({ schemaVersion: 1, pages: {} });
	await writeFile(file, original); process.env.BUILDER_DATA_FILE = file;
	process.env.NOVEX_BACKEND_URL = 'http://fake.invalid'; process.env.NOVEX_BACKEND_TOKEN = fakeToken;
	delete process.env.NOVEX_BUILDER_STORE;
	const oldFetch = globalThis.fetch; globalThis.fetch = fakeBuilderBackend(true);
	try {
		await assert.rejects(store.migrateBuilderToPostgres());
		const { builderSnapshotClient } = await import('../src/lib/backend/builder.ts');
		const current = await builderSnapshotClient.get();
		await builderSnapshotClient.update(current.storeId, current.revision, { ...(current.snapshot as object), external: 'retain' });
		await assert.rejects(store.migrateBuilderToPostgres(), (error: unknown) => error instanceof store.BuilderStoreError && error.code === 'migration_conflict');
		assert.equal(await readFile(file, 'utf8'), original);
		assert.equal((JSON.parse(await readFile(`${file}.novex-postgres`, 'utf8')) as { state: string }).state, 'pending');
		assert.deepEqual((await builderSnapshotClient.get()).snapshot, { schemaVersion: 1, pages: {}, external: 'retain' });
	} finally { globalThis.fetch = oldFetch; }
});

it('migrates real Builder data to PostgreSQL and preserves editing, publication, packages and media safeguards', async (t) => {
	const url = process.env.NOVEX_TEST_BUILDER_BACKEND_URL, token = process.env.NOVEX_TEST_BUILDER_BACKEND_TOKEN;
	if (!url || !token || process.env.NOVEX_TEST_BUILDER_CONFIRM !== 'initialize-disposable-store') return t.skip('Requires an explicitly confirmed disposable, uninitialized Builder backend.');
	const file = path.join(root, 'real-builder.json');
	process.env.BUILDER_DATA_FILE = file;
	process.env.NOVEX_BACKEND_URL = url; process.env.NOVEX_BACKEND_TOKEN = token;
	delete process.env.NOVEX_BUILDER_STORE;
	const uploadName = 'builder-postgres-fixture.png';
	await writeFile(path.join(media.UPLOAD_DIR, uploadName), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64'), { flag: 'wx' });
	let initial = operations.addNode(document.createEmptyPageDocument('legacy-page', 'نسخهٔ منتشرشده'), 'Heading', { id: 'node_legacy_heading' });
	initial = operations.addNode(initial, 'Image', { id: 'node_legacy_image' });
	initial = operations.updateNodeProps(initial, 'node_legacy_image', { src: `media://uploads/${uploadName}`, alt: 'تصویر آزمون' });
	await store.saveDraftPage({ slug: initial.slug, expectedRevision: 0, document: initial });
	await store.publishPage({ slug: initial.slug, expectedRevision: 1, document: initial });
	const draft = { ...initial, title: 'پیش‌نویس ویرایش‌شده' };
	await store.saveDraftPage({ slug: initial.slug, expectedRevision: 2, document: draft });
	const template = await store.saveBuilderTemplate({ name: 'قالب شخصی', document: initial });
	let sectionDoc = operations.addNode(document.createEmptyPageDocument('section-source'), 'Container', { id: 'node_pg_section' });
	sectionDoc = operations.addNode(sectionDoc, 'Heading', { parentId: 'node_pg_section', id: 'node_pg_heading' });
	const section = await store.createSharedSection('بخش مشترک', sectionDoc.nodes[0]);
	const pkg = { schemaVersion: 1, id: 'data-pg-example', version: '1.0.0', name: 'بستهٔ نمونه', description: 'فقط داده', components: [{ pluginId: 'data-pg-example', pluginVersion: '1.0.0', componentId: 'notice', label: 'پیام', fields: [{ key: 'message', label: 'متن', kind: 'text', value: 'سلام', maxLength: 240 }], parts: [{ type: 'text', textKey: 'message' }] }] };
	await store.installDeclarativePluginPackage(pkg, 'install');
	const kit = kits.listSiteKits()[0];
	const installation = { id: kit.id, version: kit.version, prefix: 'fixture' };
	const kitDocuments = kits.prepareSiteKit(kit, installation.prefix);
	await store.installDraftPages(kitDocuments, installation);
	await store.publishPage({ slug: kitDocuments[0].slug, expectedRevision: 1, document: kitDocuments[0] });
	const legacy = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
	legacy.futureRoot = { retained: true };
	const pages = legacy.pages as Record<string, Record<string, unknown>>;
	pages['legacy-page'].futurePage = { retained: 2 };
	(pages['legacy-page'].revisions as Array<Record<string, unknown>>)[0].futureRevision = 'keep';
	(legacy.templates as Record<string, Record<string, unknown>>)[template.id].futureTemplate = [1, 2];
	const original = `${JSON.stringify(legacy, null, 2)}\n`;
	await writeFile(file, original);
	await store.migrateBuilderToPostgres();
	assert.equal(await readFile(file, 'utf8'), original);
	process.env.NOVEX_BUILDER_STORE = 'postgres';
	assert.deepEqual((await store.getDraftPage(initial.slug)).draft, draft);
	assert.deepEqual((await store.getPublishedPage(initial.slug))?.document, initial);
	assert.equal((await store.getPageHistory(initial.slug)).length, 3);
	assert.equal((await store.getBuilderTemplate(template.id))?.name, 'قالب شخصی');
	assert.equal((await store.getSharedSection(section.id))?.revision, 1);
	assert.equal((await store.listDeclarativePluginPackages())[0].package.id, pkg.id);
	assert.equal((await store.getDraftPage(kitDocuments[0].slug)).installation?.version, kit.version);
	await assert.rejects(media.deleteUpload(uploadName), (error: unknown) => (error as { status?: number }).status === 409);
	await assert.rejects(store.saveDraftPage({ slug: initial.slug, expectedRevision: 2, document: draft }), (error: unknown) => error instanceof store.BuilderStoreError && error.code === 'revision_conflict' && error.currentRevision === 3);
	await store.changeDeclarativePluginPackage(pkg.id, 1, false);
	sectionDoc = operations.updateNodeProps(sectionDoc, 'node_pg_heading', { text: 'بخش تازه' });
	await store.updateSharedSection(section.id, 1, sectionDoc.nodes[0]);
	const updatedKit = { ...kit, version: '1.2.0' };
	await store.updateInstalledKitDrafts(kits.prepareSiteKit(updatedKit, installation.prefix), { ...installation, version: updatedKit.version });
	assert.deepEqual((await store.getPublishedPage(kitDocuments[0].slug))?.document, kitDocuments[0]);
	assert.equal((await store.getDraftPage(kitDocuments[0].slug)).installation?.version, updatedKit.version);
	assert.equal((await store.getSharedSection(section.id))?.revision, 2);
	assert.equal((await store.listDeclarativePluginPackages())[0].active, false);
	// Inject a separate PostgreSQL writer after the store has read its snapshot.
	// Its CAS must win without the app overwriting the concurrent change.
	const { builderSnapshotClient } = await import('../src/lib/backend/builder.ts');
	const realFetch = globalThis.fetch;
	let injected = false;
	globalThis.fetch = async (input, init) => {
		const pathname = new URL(input instanceof Request ? input.url : String(input)).pathname;
		if (!injected && pathname === '/v1/builder' && init?.method === 'PUT') {
			injected = true;
			const current = await builderSnapshotClient.get();
			await builderSnapshotClient.update(current.storeId, current.revision, { ...(current.snapshot as object), concurrentExtension: 'preserved' });
		}
		return realFetch(input, init);
	};
	try {
		await assert.rejects(store.saveDraftPage({ slug: initial.slug, expectedRevision: 3, document: draft }), (error: unknown) => error instanceof store.BuilderStoreError && error.status === 409 && error.code === 'storage_conflict');
	} finally { globalThis.fetch = realFetch; }
	assert.equal((await store.getDraftPage(initial.slug)).revision, 3);
	await store.saveDraftPage({ slug: initial.slug, expectedRevision: 3, document: { ...draft, title: 'پس از تلاش دوباره' } });
	const results = await Promise.all(Array.from({ length: 4 }, () => {
		const source = `const s=await import(${JSON.stringify(new URL('../src/lib/builder/store.ts', import.meta.url).href)}); const d=await import(${JSON.stringify(new URL('../src/lib/builder/document.ts', import.meta.url).href)}); try { await s.saveDraftPage({slug:'multi-process',expectedRevision:0,document:d.createEmptyPageDocument('multi-process')}); console.log('ok'); } catch(e) { console.log(e.code); }`;
		return new Promise<string>((resolve, reject) => {
			const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', source], { env: { ...process.env, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
			let output = '', errors = ''; child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); }); child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
			child.once('error', reject); child.once('exit', (code) => { if (code === 0) resolve(output.trim()); else reject(new Error(errors)); });
		});
	}));
	assert.equal(results.filter((value) => value === 'ok').length, 1);
	assert.equal(results.filter((value) => value === 'revision_conflict').length, 3);
	const backup = path.join(root, 'real-builder-backup.json');
	await store.exportPostgresBuilder(backup);
	const exported = JSON.parse(await readFile(backup, 'utf8')) as Record<string, unknown>;
	assert.equal(exported.concurrentExtension, 'preserved');
	assert.deepEqual(exported.futureRoot, { retained: true });
	const exportedPages = exported.pages as Record<string, Record<string, unknown>>;
	assert.deepEqual(exportedPages['legacy-page'].futurePage, { retained: 2 });
	assert.equal((exportedPages['legacy-page'].revisions as Array<Record<string, unknown>>)[0].futureRevision, 'keep');
	assert.deepEqual((exported.templates as Record<string, Record<string, unknown>>)[template.id].futureTemplate, [1, 2]);
	assert.equal((await stat(backup)).mode & 0o077, 0);
	assert.equal(await readFile(file, 'utf8'), original);
	process.env.NOVEX_BUILDER_STORE = 'file';
	await assert.rejects(store.getDraftPage(initial.slug), (error: unknown) => error instanceof store.BuilderStoreError && error.status === 503);
	process.env.NOVEX_BUILDER_STORE = 'postgres';
	process.env.NOVEX_BACKEND_URL = 'http://127.0.0.1:1';
	await assert.rejects(store.getDraftPage(initial.slug), (error: unknown) => error instanceof store.BuilderStoreError && error.status === 503);
	await assert.rejects(media.deleteUpload(uploadName), (error: unknown) => (error as { status?: number }).status === 503);
	await stat(path.join(media.UPLOAD_DIR, uploadName));
	process.env.NOVEX_BACKEND_URL = url;
	assert.equal((await store.getDraftPage(initial.slug)).revision, 4);
});
