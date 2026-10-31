import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listSiteKits, prepareSiteKit, validateSiteKit } from '../src/lib/builder/site-kits.ts';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { verifySiteKitAssets } from '../src/lib/builder/site-kit-assets.ts';
import { getDraftPage, getPublishedPage, installDraftPages, publishPage } from '../src/lib/builder/store.ts';

describe('site kit installation', () => {
	it('rejects invalid dependencies and assets', () => {
		const kit = listSiteKits()[0];
		assert.throws(() => validateSiteKit({ ...kit, requiredComponents: [] }));
		assert.throws(() => validateSiteKit({ ...kit, assets: ['missing.png'] }));
		assert.throws(() => validateSiteKit({ ...kit, assets: [] }));
		assert.throws(() => validateSiteKit({ ...kit, assets: ['media://uploads/test.png'] }));
		assert.throws(() => prepareSiteKit(kit, '../bad'));
		const page = kit.pages[0];
		assert.throws(() => validateSiteKit({ ...kit, pages: [{ ...page, links: [{ nodeId: 'node_kit_nav_home', targetSuffix: 'missing' }] }, ...kit.pages.slice(1)] }));
		assert.throws(() => validateSiteKit({ ...kit, pages: [{ ...page, links: [{ nodeId: 'node_kit_navigation', targetSuffix: 'home' }] }, ...kit.pages.slice(1)] }));
		assert.throws(() => validateSiteKit({ ...kit, pages: [{ ...page, links: [{ nodeId: 'node_kit_nav_home', targetSuffix: 'home' }, { nodeId: 'node_kit_nav_home', targetSuffix: 'contact' }] }, ...kit.pages.slice(1)] }));
	});
	it('requires schema v5 when accordion or tab text contains formatting', () => {
		for (const type of ['Accordion', 'Tabs'] as const) {
			let document = addNode(createEmptyPageDocument('kit-rich'), type, { id: 'node_kit_rich_collection' });
			document = updateNodeProps(document, 'node_kit_rich_collection', { items: [{ id: 'item_rich_kit', title: 'Title', body: 'Body', bodyMarks: [{ kind: 'bold', start: 0, end: 4 }] }] });
			const kit = { ...listSiteKits()[0], minBuilderSchema: 4, requiredComponents: [type], assets: [], pages: [{ suffix: 'home', title: 'Home', document }] };
			assert.throws(() => validateSiteKit(kit), /نسخهٔ ۵/);
			assert.equal(validateSiteKit({ ...kit, minBuilderSchema: 5 }).minBuilderSchema, 5);
		}
	});
	it('checks declared bundled files before installation without network access', async () => {
		const kit = listSiteKits()[0];
		const checked: string[] = [];
		assert.equal(await verifySiteKitAssets(kit, async (name) => { checked.push(name); return true; }), true);
		assert.deepEqual(checked, ['blog-placeholder-about.jpg']);
		assert.equal(await verifySiteKitAssets(kit, async () => false), false);
	});
	it('installs three drafts atomically and refuses a collision without partial pages', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-kits-'));
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		try {
			const kit = listSiteKits()[0];
			const documents = prepareSiteKit(kit, 'demo');
			assert.deepEqual(documents.map((doc) => doc.slug), ['demo-home', 'demo-services', 'demo-contact']);
			assert.equal((await installDraftPages(documents)).length, 3);
			assert.equal((await getDraftPage('demo-home')).revision, 1);
			const hrefs = (nodes: typeof documents[number]['nodes']): string[] => nodes.flatMap((node) => node.type === 'Container' ? hrefs(node.children) : node.type === 'Button' ? [node.props.href] : []);
			for (const document of documents) {
				assert.ok(['/pages/demo-home', '/pages/demo-services', '/pages/demo-contact'].every((href) => hrefs(document.nodes).includes(href)));
			}
			assert.ok(hrefs(kit.pages[0].document.nodes).includes('#'));
			assert.ok(!hrefs(kit.pages[0].document.nodes).includes('/pages/demo-home'));
			await publishPage({ slug: 'demo-home', expectedRevision: 1, document: documents[0] });
			assert.ok(hrefs((await getPublishedPage('demo-home'))!.document.nodes).includes('/pages/demo-services'));
			assert.equal(await getPublishedPage('demo-services'), null);
			const other = prepareSiteKit(kit, 'other');
			await assert.rejects(installDraftPages([other[0], documents[1], other[2]]));
			assert.equal((await getDraftPage('other-home')).revision, 0);
			assert.equal((await getDraftPage('demo-services')).revision, 1);
		} finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
	});
});

describe('kit API authorization', () => {
	it('denies write access without a writer role', async () => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/index.ts');
		const response = await POST({ locals: { cmsUser: { role: 'subscriber' } }, request: new Request('http://local/cms/api/builder/kits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":"business-starter","prefix":"demo"}' }) } as never);
		assert.equal(response.status, 403);
	});
});

describe('site kit API integration', () => {
	it('installs declared bundled image and rewritten links as editable drafts only', async () => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/index.ts');
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-kit-api-'));
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		try {
			const response = await POST({ locals: { cmsUser: { role: 'editor' } }, request: new Request('http://local/cms/api/builder/kits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'business-starter', prefix: 'api-test' }) }) } as never);
			assert.equal(response.status, 201);
			const body = await response.json();
			assert.equal(body.pages.length, 3);
			const contact = (await getDraftPage('api-test-contact')).draft;
			assert.ok(contact.nodes.some((node) => node.type === 'Image' && node.props.src === 'media://assets/blog-placeholder-about.jpg'));
			const nav = contact.nodes.find((node) => node.type === 'Container' && node.children.some((child) => child.type === 'Button' && child.props.href === '/pages/api-test-home'));
			assert.ok(nav);
			assert.equal(await getPublishedPage('api-test-contact'), null);
		} finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
	});
});

describe('site kit provenance and conflict-safe updates', () => {
	it('records versions, upgrades unmodified drafts atomically and preserves published snapshots', async () => {
		const { updateInstalledKitDrafts } = await import('../src/lib/builder/store.ts');
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-kit-update-'));
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		try {
			const kit = listSiteKits()[0];
			const source = { id: kit.id, version: kit.version, prefix: 'upgrade' };
			const original = prepareSiteKit(kit, source.prefix);
			await installDraftPages(original, source);
			assert.equal((await getDraftPage('upgrade-home')).installation?.version, kit.version);
			await publishPage({ slug: 'upgrade-home', expectedRevision: 1, document: original[0] });
			const newer = { ...kit, version: '1.2.0' };
			const updated = prepareSiteKit(newer, source.prefix);
			await updateInstalledKitDrafts(updated, { ...source, version: newer.version });
			assert.equal((await getDraftPage('upgrade-home')).installation?.version, '1.2.0');
			assert.equal((await getDraftPage('upgrade-home')).revision, 3);
			assert.deepEqual((await getPublishedPage('upgrade-home'))?.document, original[0]);
			await assert.rejects(updateInstalledKitDrafts(updated, { ...source, version: newer.version }), /نسخهٔ جدیدتری/);
		} finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
	});
	it('never overwrites a customized page or partially updates the other pages', async () => {
		const { updateInstalledKitDrafts, saveDraftPage } = await import('../src/lib/builder/store.ts');
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-kit-conflict-'));
		const old = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		try {
			const kit = listSiteKits()[0];
			const source = { id: kit.id, version: kit.version, prefix: 'custom' };
			const docs = prepareSiteKit(kit, source.prefix);
			await installDraftPages(docs, source);
			await saveDraftPage({ slug: docs[1].slug, expectedRevision: 1, document: { ...docs[1], title: 'ویرایش کاربر' } });
			const newKit = { ...kit, version: '1.2.0', pages: kit.pages.map((page, index) => index === 1 ? { ...page, title: 'تغییر بسته' } : page) };
			await assert.rejects(updateInstalledKitDrafts(prepareSiteKit(newKit, source.prefix), { ...source, version: newKit.version }), /ویرایش شده/);
			assert.equal((await getDraftPage(docs[0].slug)).revision, 1);
			assert.equal((await getDraftPage(docs[1].slug)).draft.title, 'ویرایش کاربر');
		} finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
	});
});

describe('site kit update API permissions', () => {
	it('requires page write access and explicit confirmation', async () => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/update.ts');
		const request = () => new Request('http://local/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'business-starter', prefix: 'demo' }) });
		assert.equal((await POST({ locals: { cmsUser: { role: 'subscriber' } }, request: request() } as never)).status, 403);
		assert.equal((await POST({ locals: { cmsUser: { role: 'editor' } }, request: request() } as never)).status, 400);
	});
});

it('fails closed if an installed kit page or its complete baseline is missing', async () => {
	const { readFile, writeFile } = await import('node:fs/promises');
	const { updateInstalledKitDrafts } = await import('../src/lib/builder/store.ts');
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-kit-missing-'));
	const old = process.env.BUILDER_DATA_FILE;
	const file = path.join(dir, 'pages.json');
	process.env.BUILDER_DATA_FILE = file;
	try {
		const kit = listSiteKits()[0];
		const source = { id: kit.id, version: kit.version, prefix: 'missing' };
		const original = prepareSiteKit(kit, source.prefix);
		await installDraftPages(original, source);
		const database = JSON.parse(await readFile(file, 'utf8'));
		const missingPage = structuredClone(database);
		delete missingPage.pages[original[2].slug];
		await writeFile(file, JSON.stringify(missingPage));
		const newer = prepareSiteKit({ ...kit, version: '1.2.0' }, source.prefix);
		await assert.rejects(updateInstalledKitDrafts(newer, { ...source, version: '1.2.0' }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'kit_update_conflict');
		assert.equal((await getDraftPage(original[0].slug)).revision, 1);
		assert.equal((await getDraftPage(original[2].slug)).revision, 0);
		// Provenance created by older builds without a page-set baseline also fails safely.
		for (const page of Object.values(database.pages) as Array<{ installation: { pageSlugs?: string[] } }>) delete page.installation.pageSlugs;
		await writeFile(file, JSON.stringify(database));
		await assert.rejects(updateInstalledKitDrafts(newer, { ...source, version: '1.2.0' }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'kit_update_conflict');
	} finally {
		if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
		await rm(dir, { recursive: true, force: true });
	}
});

it('recognizes pristine schema-v2 kit baselines after migration, but not new edits', async () => {
	const { createHash } = await import('node:crypto');
	const { readFile, writeFile } = await import('node:fs/promises');
	const { updateInstalledKitDrafts, saveDraftPage } = await import('../src/lib/builder/store.ts');
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-kit-v2-'));
	const old = process.env.BUILDER_DATA_FILE;
	const file = path.join(dir, 'pages.json');
	process.env.BUILDER_DATA_FILE = file;
	try {
		const kit = listSiteKits()[0];
		const source = { id: kit.id, version: kit.version, prefix: 'legacy' };
		const docs = prepareSiteKit(kit, source.prefix);
		await installDraftPages(docs, source);
		const db = JSON.parse(await readFile(file, 'utf8'));
		for (const page of Object.values(db.pages) as Array<{ draft: { schemaVersion: number }; installation: { baselineHash: string; baselineDocument?: unknown }; revisions: Array<{ document: { schemaVersion: number } }> }>) {
			page.draft.schemaVersion = 2;
			for (const revision of page.revisions) revision.document.schemaVersion = 2;
			page.installation.baselineHash = createHash('sha256').update(JSON.stringify(page.draft)).digest('hex');
			delete page.installation.baselineDocument; // v2 installations did not retain the base document
		}
		await writeFile(file, JSON.stringify(db));
		const newer = prepareSiteKit({ ...kit, version: '1.2.0' }, source.prefix);
		await updateInstalledKitDrafts(newer, { ...source, version: '1.2.0' });
		assert.equal((await getDraftPage(docs[0].slug)).installation?.version, '1.2.0');
		// A v3-only customization must not be mistaken for its legacy baseline.
		await writeFile(file, JSON.stringify(db));
		const draft = await getDraftPage(docs[0].slug);
		await saveDraftPage({ slug: docs[0].slug, expectedRevision: draft.revision, document: { ...draft.draft, breakpoints: { tablet: 900, mobile: 500 } } });
		await assert.rejects(updateInstalledKitDrafts(newer, { ...source, version: '1.2.0' }), /ویرایش شده/);
	} finally {
		if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
		await rm(dir, { recursive: true, force: true });
	}
});

it('three-way merges independent edits but rejects simultaneous conflicting fields atomically', async () => {
	const { updateNodeProps, findNode } = await import('../src/lib/builder/operations.ts');
	const { updateInstalledKitDrafts, saveDraftPage } = await import('../src/lib/builder/store.ts');
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-kit-merge-'));
	const old = process.env.BUILDER_DATA_FILE;
	process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
	try {
		const kit = listSiteKits()[0];
		const source = { id: kit.id, version: kit.version, prefix: 'merge' };
		const base = prepareSiteKit(kit, source.prefix);
		assert.deepEqual(prepareSiteKit(listSiteKits()[0], source.prefix), base); // stable source IDs
		await installDraftPages(base, source);
		await publishPage({ slug: base[0].slug, expectedRevision: 1, document: base[0] });
		const local = { ...updateNodeProps(base[0], 'node_bp_head01', { text: 'متن کاربر' }), title: 'عنوان کاربر' };
		await saveDraftPage({ slug: base[0].slug, expectedRevision: 2, document: local });
		const upstreamDoc = updateNodeProps(kit.pages[0].document, 'node_bp_head01', { color: 'muted' });
		const newer = { ...kit, version: '1.2.0', pages: [{ ...kit.pages[0], document: upstreamDoc }, ...kit.pages.slice(1)] };
		await updateInstalledKitDrafts(prepareSiteKit(newer, source.prefix), { ...source, version: '1.2.0' });
		const merged = await getDraftPage(base[0].slug);
		const heading = findNode(merged.draft.nodes, 'node_bp_head01');
		assert.equal(heading?.type, 'Heading');
		if (heading?.type !== 'Heading') throw new Error('heading');
		assert.equal(heading.props.text, 'متن کاربر');
		assert.equal(heading.props.color, 'muted');
		assert.equal(merged.draft.title, 'عنوان کاربر');
		assert.deepEqual((await getPublishedPage(base[0].slug))?.document, base[0]);
		assert.equal(merged.installation?.baselineDocument?.title, base[0].title);
		const conflictingDoc = updateNodeProps(upstreamDoc, 'node_bp_head01', { text: 'متن متفاوت بسته' });
		const conflicting = { ...kit, version: '1.3.0', pages: [{ ...kit.pages[0], document: conflictingDoc }, ...kit.pages.slice(1)] };
		const otherBefore = await getDraftPage(base[1].slug);
		await assert.rejects(updateInstalledKitDrafts(prepareSiteKit(conflicting, source.prefix), { ...source, version: '1.3.0' }),
			(error: unknown) => error instanceof Error && 'code' in error && error.code === 'kit_update_conflict' && 'diagnostics' in error && Array.isArray(error.diagnostics) && error.diagnostics.length > 0);
		assert.deepEqual(await getDraftPage(base[1].slug), otherBefore);
		assert.equal((await getDraftPage(base[0].slug)).draft.title, 'عنوان کاربر');
	} finally {
		if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
		await rm(dir, { recursive: true, force: true });
	}
});

it('preserves package document descriptions and bounds package versions', () => {
	const kit = listSiteKits()[0];
	const first = { ...kit.pages[0], document: { ...kit.pages[0].document, description: 'توضیح بسته' } };
	const candidate = { ...kit, pages: [first, ...kit.pages.slice(1)] };
	assert.equal(prepareSiteKit(candidate, 'describe')[0].description, 'توضیح بسته');
	assert.throws(() => validateSiteKit({ ...candidate, version: `${'9'.repeat(81)}.0.0` }));
});

it('protects assets retained only by the upstream kit baseline after history rotates', async () => {
	const { createEmptyPageDocument } = await import('../src/lib/builder/document.ts');
	const { addNode, updateNodeProps } = await import('../src/lib/builder/operations.ts');
	const { listBuilderAssetUsages, saveDraftPage } = await import('../src/lib/builder/store.ts');
	const { saveUpload, deleteUpload, UPLOAD_DIR } = await import('../src/lib/cms/media.ts');
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-kit-assets-'));
	const old = process.env.BUILDER_DATA_FILE; process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
	const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64');
	let uploaded: Awaited<ReturnType<typeof saveUpload>> | undefined;
	try {
		uploaded = await saveUpload(new File([png], 'baseline-test.png', { type: 'image/png' }));
		let doc = addNode(createEmptyPageDocument('baseline-home'), 'Image', { id: 'node_baseline01' });
		doc = updateNodeProps(doc, 'node_baseline01', { src: `media://uploads/${uploaded.name}` });
		await installDraftPages([doc], { id: 'baseline-kit', prefix: 'baseline', version: '1.0.0' });
		const local = updateNodeProps(doc, 'node_baseline01', { src: '' });
		for (let revision = 1; revision <= 25; revision++) await saveDraftPage({ slug: doc.slug, expectedRevision: revision, document: local });
		const usages = await listBuilderAssetUsages(`uploads/${uploaded.name}`);
		assert.deepEqual(usages.map((usage) => usage.scope), ['kit-baseline']);
		await assert.rejects(deleteUpload(uploaded.name), (error: unknown) => error instanceof Error && 'status' in error && error.status === 409);
	} finally {
		if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
		if (uploaded) await rm(path.join(UPLOAD_DIR, uploaded.name), { force: true });
		await rm(dir, { recursive: true, force: true });
	}
});
