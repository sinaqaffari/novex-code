import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { validateSiteKit } from '../src/lib/builder/site-kits.ts';
import { getDraftPage, getPublishedPage, saveDraftPage } from '../src/lib/builder/store.ts';
import { mergeKitDocument } from '../src/lib/builder/kit-merge.ts';

function kit() {
	let document = addNode(createEmptyPageDocument('package-source'), 'Heading', { id: 'node_package01' });
	document = updateNodeProps(document, 'node_package01', { text: 'نسخهٔ یک' });
	return { schemaVersion: 1, id: 'example-package', version: '1.0.0', name: 'بستهٔ نمونه', description: '', category: 'business', language: 'fa', direction: 'rtl', minBuilderSchema: 3, license: 'MIT', author: 'Example', requiredComponents: ['Heading'], assets: [], pages: [{ suffix: 'home', title: 'خانه', document }] };
}

async function isolated(run: () => Promise<void>) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-package-'));
	const old = process.env.BUILDER_DATA_FILE;
	process.env.BUILDER_DATA_FILE = path.join(dir, 'builder.json');
	try { await run(); } finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
}

describe('bounded data-only site kit packages', () => {
	it('rejects executable or unknown entries, incompatible versions and undeclared remote media', () => {
		const input = kit();
		assert.equal(validateSiteKit(input).id, input.id);
		assert.throws(() => validateSiteKit({ ...input, script: 'require("fs")' }), /پشتیبانی‌نشده/);
		assert.throws(() => validateSiteKit({ ...input, minBuilderSchema: 999 }));
		assert.throws(() => validateSiteKit({ ...input, pages: [{ ...input.pages[0], code: '<script>' }] }));
		assert.throws(() => validateSiteKit({ ...input, requiredComponents: ['Unknown'] }));
		assert.throws(() => validateSiteKit({ ...input, assets: ['https://127.0.0.1/secret.png'] }));
		assert.throws(() => validateSiteKit({ ...input, requiredComponents: ['Heading', 'Heading'] }));
	});
	it('installs and updates local JSON packages with explicit confirmation and three-way merge', async () => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/package.ts');
		const payload = (value: unknown) => new Request('http://local/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
		const editor = { cmsUser: { role: 'editor' } };
		const input = kit();
		assert.equal((await POST({ locals: { cmsUser: { role: 'subscriber' } }, request: payload({ action: 'install', confirm: true, prefix: 'json', kit: input }) } as never)).status, 403);
		assert.equal((await POST({ locals: editor, request: payload({ action: 'install', prefix: 'json', kit: input }) } as never)).status, 400);
		const create = await POST({ locals: editor, request: payload({ action: 'install', confirm: true, prefix: 'json', kit: input }) } as never);
		assert.equal(create.status, 201);
		const current = await getDraftPage('json-home');
		assert.equal(current.draft.nodes[0].id, 'node_package01');
		assert.equal(await getPublishedPage('json-home'), null);
		assert.equal((await POST({ locals: editor, request: payload({ action: 'install', confirm: true, prefix: 'json', kit: input }) } as never)).status, 409);
		await saveDraftPage({ slug: 'json-home', expectedRevision: 1, document: { ...current.draft, title: 'عنوان محلی' } });
		const updated = { ...input, version: '1.1.0', pages: [{ ...input.pages[0], document: updateNodeProps(input.pages[0].document, 'node_package01', { text: 'نسخهٔ دو' }) }] };
		const response = await POST({ locals: editor, request: payload({ action: 'update', confirm: true, prefix: 'json', kit: updated }) } as never);
		assert.equal(response.status, 200);
		const merged = (await getDraftPage('json-home')).draft;
		assert.equal(merged.title, 'عنوان محلی');
		assert.equal(merged.nodes[0].type === 'Heading' && merged.nodes[0].props.text, 'نسخهٔ دو');
		assert.equal(await getPublishedPage('json-home'), null);
	}));
	it('rejects a second installation with the same kit identity even when page suffixes do not overlap', async () => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/package.ts');
		const invoke = (value: unknown) => POST({ locals: { cmsUser: { role: 'editor' } }, request: new Request('http://local/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }) } as never);
		const original = kit();
		assert.equal((await invoke({ action: 'install', confirm: true, prefix: 'identity', kit: original })).status, 201);
		const disjoint = { ...original, pages: [{ ...original.pages[0], suffix: 'other' }] };
		const duplicate = await invoke({ action: 'install', confirm: true, prefix: 'identity', kit: disjoint });
		assert.equal(duplicate.status, 409);
		assert.equal((await duplicate.json()).code, 'kit_already_installed');
		assert.equal((await getDraftPage('identity-other')).revision, 0);
		assert.equal((await getDraftPage('identity-home')).revision, 1);
		const updated = { ...original, version: '1.1.0' };
		assert.equal((await invoke({ action: 'update', confirm: true, prefix: 'identity', kit: updated })).status, 200);
	}));
	it('fails before creating any draft if a declared local asset is absent', async () => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/package.ts');
		const input = kit();
		let document = addNode(input.pages[0].document, 'Image', { id: 'node_missing01' });
		document = updateNodeProps(document, 'node_missing01', { src: 'media://uploads/missing-package-image.png' });
		const candidate = { ...input, requiredComponents: ['Heading', 'Image'], assets: ['media://uploads/missing-package-image.png'], pages: [{ ...input.pages[0], document }] };
		const response = await POST({ locals: { cmsUser: { role: 'editor' } }, request: new Request('http://local/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'install', confirm: true, prefix: 'absent', kit: candidate }) }) } as never);
		assert.equal(response.status, 422);
		assert.equal((await getDraftPage('absent-home')).revision, 0);
	}));
	it('bounds the package request even without a trustworthy content length', async () => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/package.ts');
		const body = 'x'.repeat(3_200_001);
		const response = await POST({ locals: { cmsUser: { role: 'editor' } }, request: new Request('http://local/', { method: 'POST', headers: { 'content-type': 'application/json' }, body }) } as never);
		assert.equal(response.status, 413);
	}));
	it('merges reordering and independent upstream edits by stable ID instead of position', () => {
		let base = addNode(createEmptyPageDocument('order'), 'Heading', { id: 'node_heading01' });
		base = addNode(base, 'Heading', { id: 'node_heading02' });
		const local = { ...base, nodes: [...base.nodes].reverse() };
		const upstream = updateNodeProps(base, 'node_heading01', { text: 'Changed upstream' });
		const result = mergeKitDocument(base, local, upstream);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.deepEqual(result.document.nodes.map((node) => node.id), ['node_heading02', 'node_heading01']);
			assert.equal(result.document.nodes[1].type === 'Heading' && result.document.nodes[1].props.text, 'Changed upstream');
		}
	});
});
