import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEmptyPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps, updateNodeStyles } from '../src/lib/builder/operations.ts';
import { globalScriptBootstrap, globalStyleRawText } from '../src/lib/builder/global-code.ts';
import { diagnosePageDocument } from '../src/lib/builder/diagnostics.ts';
import { validateBuilderPresets } from '../src/lib/builder/plugin-presets.ts';
import { listSiteKits, validateSiteKit } from '../src/lib/builder/site-kits.ts';
import { getDraftPage, getPublishedPage, saveDraftPage } from '../src/lib/builder/store.ts';
import { can } from '../src/lib/cms/rbac.ts';

function pageWithCode(slug: string) {
	let doc = addNode(createEmptyPageDocument(slug), 'Heading', { id: 'node_heading001' });
	doc = addNode(doc, 'GlobalCode', { id: 'node_globalcode1' });
	return updateNodeProps(doc, 'node_globalcode1', { title: 'Reviewed code', css: '.nvx-page { color: red }', javascript: "document.body.dataset.authorCode='yes'" });
}
async function isolated(run: () => Promise<void>) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-global-code-'));
	const old = process.env.BUILDER_DATA_FILE;
	process.env.BUILDER_DATA_FILE = path.join(dir, 'builder.json');
	try { await run(); } finally { if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old; await rm(dir, { recursive: true, force: true }); }
}

describe('privileged published page code', () => {
	it('keeps author code bounded, top-level and separate from old schemas', () => {
		const doc = pageWithCode('bounds');
		assert.equal(validatePageDocument(doc).nodes[1].type, 'GlobalCode');
		assert.throws(() => validatePageDocument({ ...doc, schemaVersion: 3 }), /not part of schema v3/);
		assert.throws(() => updateNodeProps(doc, 'node_globalcode1', { javascript: 'x'.repeat(64001) }));
		assert.throws(() => updateNodeStyles(doc, 'node_globalcode1', { width: '50%' }));
		let container = addNode(createEmptyPageDocument('nested-code'), 'Container', { id: 'node_container01' });
		assert.throws(() => addNode(container, 'GlobalCode', { parentId: 'node_container01', id: 'node_globalcode1' }));
	});
	it('prevents raw-text markup breakout without claiming to sandbox the code', () => {
		const css = globalStyleRawText('p::after{content:"</style><script>bad</script>"}');
		assert.doesNotMatch(css, /<\/style/i);
		assert.match(css, /\\3c \/style/);
		const js = globalScriptBootstrap("document.body.dataset.text = '</script><script>bad</script>'; if (2 < 3) window.ok = true;");
		assert.doesNotMatch(js, /<\/script/i);
		assert.match(js, /\\u003c/);
		assert.match(js, /textContent/);
	});
	it('rejects host code in data-only kits and plugin presets', () => {
		const doc = pageWithCode('package');
		const kit = listSiteKits()[0];
		assert.throws(() => validateSiteKit({ ...kit, requiredComponents: ['Heading', 'GlobalCode'], pages: [{ suffix: 'home', title: 'Home', document: doc }], assets: [] }), /کد اجرایی/);
		assert.throws(() => validateBuilderPresets([{ id: 'unsafe-code', label: 'Bad', description: '', document: doc }]), /کد اجرایی/);
	});
	it('diagnoses code and restricts publication to a reviewed administrator request', async () => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/pages/[slug].ts');
		const doc = pageWithCode('admin-code');
		assert.ok((await diagnosePageDocument(doc, doc.slug, async () => true)).some((item) => item.code === 'global-code'));
		assert.equal(can('admin', 'cms.pages:publishCode'), true);
		assert.equal(can('editor', 'cms.pages:publishCode'), false);
		await saveDraftPage({ slug: doc.slug, expectedRevision: 0, document: doc });
		const request = (role: string, acknowledged: boolean) => POST({ params: { slug: doc.slug }, locals: { cmsUser: { role } }, request: new Request('http://localhost/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 1, document: doc, acknowledgeExecutableCode: acknowledged, allowHostCode: true }) }) } as never);
		const editor = await request('editor', true);
		assert.equal(editor.status, 403); assert.equal((await editor.json()).code, 'global_code_forbidden');
		const notReviewed = await request('admin', false);
		assert.equal(notReviewed.status, 422); assert.equal((await notReviewed.json()).code, 'code_review_required');
		assert.equal(await getPublishedPage(doc.slug), null);
		assert.equal((await getDraftPage(doc.slug)).revision, 1);
		assert.equal((await request('admin', true)).status, 200);
		assert.equal((await getPublishedPage(doc.slug))?.document.nodes[1].type, 'GlobalCode');
	}));
	it('requires explicit API acknowledgement for the opaque iframe widget too', async () => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/pages/[slug].ts');
		const doc = addNode(createEmptyPageDocument('framed-code'), 'CodeWidget', { id: 'node_codewidget1' });
		await saveDraftPage({ slug: doc.slug, expectedRevision: 0, document: doc });
		const request = (acknowledgeExecutableCode: boolean) => POST({ params: { slug: doc.slug }, locals: { cmsUser: { role: 'editor' } }, request: new Request('http://localhost/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 1, document: doc, acknowledgeExecutableCode }) }) } as never);
		const denied = await request(false);
		assert.equal(denied.status, 422);
		assert.equal((await denied.json()).code, 'code_review_required');
		assert.equal((await request(true)).status, 200);
	}));
});
