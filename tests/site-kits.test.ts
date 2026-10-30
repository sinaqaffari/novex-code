import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listSiteKits, prepareSiteKit, validateSiteKit } from '../src/lib/builder/site-kits.ts';
import { getDraftPage, getPublishedPage, installDraftPages } from '../src/lib/builder/store.ts';

describe('site kit installation', () => {
	it('rejects invalid dependencies and assets', () => {
		const kit = listSiteKits()[0];
		assert.throws(() => validateSiteKit({ ...kit, requiredComponents: [] }));
		assert.throws(() => validateSiteKit({ ...kit, assets: ['missing.png'] }));
		assert.throws(() => prepareSiteKit(kit, '../bad'));
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
			assert.equal(await getPublishedPage('demo-home'), null);
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
