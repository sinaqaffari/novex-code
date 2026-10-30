import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listSiteKits, prepareSiteKit, validateSiteKit } from '../src/lib/builder/site-kits.ts';
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
