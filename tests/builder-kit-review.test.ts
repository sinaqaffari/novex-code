import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { getDraftPage, getPublishedPage, publishPage, saveDraftPage, type KitUpdateReview } from '../src/lib/builder/store.ts';

function kit(version: string, text: string) {
	const page = (slug: string, id: string) => {
		let document = addNode(createEmptyPageDocument(slug), 'Heading', { id });
		document = updateNodeProps(document, id, { text });
		return document;
	};
	return {
		schemaVersion: 1, id: 'review-kit', version, name: 'Review kit', description: '', category: 'business', language: 'fa', direction: 'rtl', minBuilderSchema: 3, license: 'MIT', author: 'Example',
		requiredComponents: ['Heading'], assets: [], pages: [
			{ suffix: 'home', title: 'Home', document: page('source-home', 'node_home_title') },
			{ suffix: 'about', title: 'About', document: page('source-about', 'node_about_title') },
		],
	};
}
async function isolated(run: () => Promise<void>) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-kit-review-'));
	const previous = process.env.BUILDER_DATA_FILE;
	process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
	try { await run(); } finally { if (previous === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = previous; await rm(dir, { recursive: true, force: true }); }
}
function request(payload: unknown) {
	return new Request('http://local/cms/api/builder/kits/package', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
}

describe('reviewed site-kit conflict resolution', () => {
	it('reviews all conflicting fields without writes and applies explicit mixed choices atomically to drafts only', async () => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/package.ts');
		const invoke = (body: unknown, role = 'editor') => POST({ locals: { cmsUser: { role } }, request: request(body) } as never);
		const original = kit('1.0.0', 'Original');
		const next = kit('1.1.0', 'Upstream');
		assert.equal((await invoke({ action: 'install', confirm: true, prefix: 'review', kit: original })).status, 201);
		const installed = await getDraftPage('review-home');
		await publishPage({ slug: 'review-home', expectedRevision: installed.revision, document: installed.draft });
		const published = await getPublishedPage('review-home');
		for (const slug of ['review-home', 'review-about']) {
			const current = await getDraftPage(slug);
			const id = current.draft.nodes[0].id;
			const document = updateNodeProps({ ...current.draft, description: 'Local description' }, id, { text: 'Local' });
			await saveDraftPage({ slug, expectedRevision: current.revision, document });
		}
		const beforeHome = await getDraftPage('review-home');
		const beforeAbout = await getDraftPage('review-about');
		assert.equal((await invoke({ action: 'review', prefix: 'review', kit: next }, 'subscriber')).status, 403);
		const response = await invoke({ action: 'review', prefix: 'review', kit: next });
		assert.equal(response.status, 200);
		const { review } = await response.json() as { review: KitUpdateReview };
		assert.equal(review.fields.length, 2);
		assert.deepEqual(review.unresolved, []);
		assert.equal(review.truncated, false);
		assert.ok(review.fields.every((field) => field.base === '"Original"' && field.local === '"Local"' && field.incoming === '"Upstream"'));
		assert.equal((await getDraftPage('review-home')).revision, beforeHome.revision);
		assert.equal((await getDraftPage('review-about')).revision, beforeAbout.revision);
		const choices = review.fields.map(({ slug, path }) => ({ slug, path, choice: slug.endsWith('home') ? 'local' : 'incoming' }));
		assert.equal((await invoke({ action: 'update', prefix: 'review', kit: next, decision: { token: review.token, choices } })).status, 400);
		assert.equal((await invoke({ action: 'update', confirm: true, prefix: 'review', kit: next, decision: { token: review.token, choices: choices.slice(0, 1) } })).status, 409);
		assert.equal((await getDraftPage('review-home')).revision, beforeHome.revision);
		const accepted = await invoke({ action: 'update', confirm: true, prefix: 'review', kit: next, decision: { token: review.token, choices } });
		assert.equal(accepted.status, 200);
		const home = await getDraftPage('review-home');
		const about = await getDraftPage('review-about');
		assert.equal(home.draft.nodes[0].type === 'Heading' && home.draft.nodes[0].props.text, 'Local');
		assert.equal(about.draft.nodes[0].type === 'Heading' && about.draft.nodes[0].props.text, 'Upstream');
		assert.equal(home.draft.description, 'Local description');
		assert.equal(about.draft.description, 'Local description');
		assert.deepEqual(await getPublishedPage('review-home'), published);
		assert.equal(home.installation?.version, '1.1.0');
		assert.equal(about.installation?.version, '1.1.0');
	}));
	it('rejects stale, mismatched, duplicate and incomplete choices without updating any page', async () => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/package.ts');
		const invoke = (body: unknown) => POST({ locals: { cmsUser: { role: 'editor' } }, request: request(body) } as never);
		const original = kit('1.0.0', 'Original');
		const next = kit('1.1.0', 'Upstream');
		await invoke({ action: 'install', confirm: true, prefix: 'stale', kit: original });
		const before = await getDraftPage('stale-home');
		await saveDraftPage({ slug: 'stale-home', expectedRevision: before.revision, document: updateNodeProps(before.draft, 'node_home_title', { text: 'Local' }) });
		const review = (await (await invoke({ action: 'review', prefix: 'stale', kit: next })).json() as { review: KitUpdateReview }).review;
		const field = review.fields[0];
		const choice = { slug: field.slug, path: field.path, choice: 'incoming' };
		const update = (decision: unknown) => invoke({ action: 'update', confirm: true, prefix: 'stale', kit: next, decision });
		assert.equal((await update({ token: review.token, choices: [choice, choice] })).status, 400);
		assert.equal((await update({ token: review.token, choices: [{ ...choice, path: 'title' }] })).status, 409);
		const edited = await getDraftPage('stale-about');
		await saveDraftPage({ slug: 'stale-about', expectedRevision: edited.revision, document: { ...edited.draft, description: 'Changed after review' } });
		const stale = await update({ token: review.token, choices: [choice] });
		assert.equal(stale.status, 409);
		assert.equal((await stale.json()).code, 'kit_review_stale');
		assert.equal((await getDraftPage('stale-home')).installation?.version, '1.0.0');
		assert.equal((await getDraftPage('stale-about')).installation?.version, '1.0.0');
	}));
	it('reviews bounded structural conflicts, requires exact choices and rejects a changed upstream package', async () => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/kits/package.ts');
		const invoke = (body: unknown) => POST({ locals: { cmsUser: { role: 'editor' } }, request: request(body) } as never);
		const original = kit('1.0.0', 'Original');
		await invoke({ action: 'install', confirm: true, prefix: 'structural', kit: original });
		const current = await getDraftPage('structural-home');
		await saveDraftPage({ slug: 'structural-home', expectedRevision: current.revision, document: { ...current.draft, nodes: [] } });
		const next = kit('1.1.0', 'Changed upstream');
		const review = (await (await invoke({ action: 'review', prefix: 'structural', kit: next })).json() as { review: KitUpdateReview }).review;
		const structural = review.fields.find((field) => field.slug === 'structural-home');
		assert.ok(structural);
		assert.equal(structural.kind, 'structural');
		assert.match(structural.local, /موجود نیست/);
		assert.deepEqual(review.unresolved, []);
		const forced = await invoke({ action: 'update', confirm: true, prefix: 'structural', kit: next, decision: { token: review.token, choices: [] } });
		assert.equal(forced.status, 409);
		const modified = kit('1.1.0', 'A different upstream');
		const stale = await invoke({ action: 'update', confirm: true, prefix: 'structural', kit: modified, decision: { token: review.token, choices: [] } });
		assert.equal((await stale.json()).code, 'kit_review_stale');
		assert.equal((await getDraftPage('structural-home')).installation?.version, '1.0.0');
		const choices = review.fields.map(({ slug, path }) => ({ slug, path, choice: 'incoming' }));
		const accepted = await invoke({ action: 'update', confirm: true, prefix: 'structural', kit: next, decision: { token: review.token, choices } });
		assert.equal(accepted.status, 200);
		const updated = await getDraftPage('structural-home');
		assert.equal(updated.installation?.version, '1.1.0');
		assert.equal(updated.draft.nodes[0].type === 'Heading' && updated.draft.nodes[0].props.text, 'Changed upstream');
	}));
});
