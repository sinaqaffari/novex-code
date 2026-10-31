import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createEmptyPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { addNode, findNode, traversePageNodes, updateNodeProps } from '../src/lib/builder/operations.ts';
import { getStarterTemplate, listStarterTemplateSummaries } from '../src/lib/builder/templates.ts';
import { getDraftPage, publishPage, saveDraftPage } from '../src/lib/builder/store.ts';
import { can } from '../src/lib/cms/rbac.ts';
import { requiredCmsPermission } from '../src/lib/cms/access.ts';
import { BackendError, deleteInquiry, listInquiries, readInquiryFeedback, signInquiryFeedback, updateInquiry } from '../src/lib/backend/inquiries.ts';
import { POST } from '../src/pages/api/inquiries.ts';

function withBackendEnv<T>(fn: () => T): T {
	const oldUrl = process.env.NOVEX_BACKEND_URL, oldToken = process.env.NOVEX_BACKEND_TOKEN;
	process.env.NOVEX_BACKEND_URL = 'http://127.0.0.1:9999';
	process.env.NOVEX_BACKEND_TOKEN = '0123456789abcdef0123456789abcdef';
	try { return fn(); }
	finally {
		if (oldUrl === undefined) delete process.env.NOVEX_BACKEND_URL; else process.env.NOVEX_BACKEND_URL = oldUrl;
		if (oldToken === undefined) delete process.env.NOVEX_BACKEND_TOKEN; else process.env.NOVEX_BACKEND_TOKEN = oldToken;
	}
}

function context(payload: Record<string, unknown>) {
	const request = new Request('http://local/api/inquiries', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) });
	return { request, url: new URL(request.url), clientAddress: '127.0.0.1', cookies: { set() {}, get() { return undefined; } } } as never;
}

describe('editable full-page inquiry forms', () => {
	it('includes a native validated form in every bundled complete page design', () => {
		const pages = listStarterTemplateSummaries().filter((item) => item.kind === 'page');
		assert.ok(pages.length >= 10);
		for (const summary of pages) {
			const template = getStarterTemplate(summary.id)!;
			let formId = '';
			traversePageNodes(template.document, (node) => { if (node.type === 'InquiryForm') formId = node.id; });
			assert.ok(formId, summary.id);
			const edited = updateNodeProps(template.document, formId, { title: 'عنوان ویرایش‌شده', kind: 'contact' });
			assert.equal(findNode(edited.nodes, formId)?.type, 'InquiryForm');
			assert.doesNotThrow(() => validatePageDocument(edited));
			assert.throws(() => updateNodeProps(edited, formId, { kind: 'confirmed-booking' }));
			assert.throws(() => updateNodeProps(edited, formId, { arbitraryHtml: '<script>bad()</script>' }));
		}
	});
	it('restricts reading, changing and deleting personal requests to explicit CMS permissions', () => {
		assert.equal(requiredCmsPermission({ pathname: '/cms/inquiries', method: 'GET' }), 'cms.inquiries:read');
		assert.equal(requiredCmsPermission({ pathname: '/cms/api/inquiries/inq_test', method: 'POST' }), 'cms.inquiries:write');
		assert.equal(requiredCmsPermission({ pathname: '/cms/api/inquiries/inq_test', method: 'POST', action: 'delete' }), 'cms.inquiries:delete');
		for (const role of ['contributor', 'subscriber'] as const) assert.equal(can(role, 'cms.inquiries:read'), false);
		assert.equal(can('editor', 'cms.inquiries:write'), true);
		assert.equal(can('editor', 'cms.inquiries:delete'), false);
		assert.equal(can('admin', 'cms.inquiries:delete'), true);
	});
	it('accepts only signed, unexpired feedback for the correct page and form', () => withBackendEnv(() => {
		const feedback = { slug: 'test-page', nodeId: 'node_testform1', result: 'sent' as const, expires: Date.now() + 30000 };
		const signed = signInquiryFeedback(feedback);
		assert.deepEqual(readInquiryFeedback(signed, 'test-page'), feedback);
		assert.equal(readInquiryFeedback(signed, 'other-page'), null);
		assert.equal(readInquiryFeedback(`${signed}x`, 'test-page'), null);
		assert.equal(readInquiryFeedback(signInquiryFeedback({ ...feedback, expires: Date.now() - 1 }), 'test-page'), null);
	}));
	it('returns native-form feedback to the submitted form, not another form on the same page', async () => {
		const oldUrl = process.env.NOVEX_BACKEND_URL, oldToken = process.env.NOVEX_BACKEND_TOKEN;
		process.env.NOVEX_BACKEND_URL = 'http://127.0.0.1:9999';
		process.env.NOVEX_BACKEND_TOKEN = '0123456789abcdef0123456789abcdef';
		try {
			const payload = new URLSearchParams({ slug: 'test-page', nodeId: 'node_secondform1', requestId: randomUUID().replaceAll('-', ''), name: '', contact: 'test@example.invalid', message: 'متن' });
			const request = new Request('http://local/api/inquiries', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: payload });
			const result = await POST({ request, url: new URL(request.url), cookies: { set() {} } } as never);
			assert.equal(result.status, 303);
			assert.equal(result.headers.get('location'), '/pages/test-page#node_secondform1');
		} finally {
			if (oldUrl === undefined) delete process.env.NOVEX_BACKEND_URL; else process.env.NOVEX_BACKEND_URL = oldUrl;
			if (oldToken === undefined) delete process.env.NOVEX_BACKEND_TOKEN; else process.env.NOVEX_BACKEND_TOKEN = oldToken;
		}
	});
	it('rejects unknown, draft-only, oversized or malformed public forms before contacting the backend', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-inquiry-unit-'));
		const previous = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'builder.json');
		try {
			const doc = addNode(createEmptyPageDocument('inquiry-draft'), 'InquiryForm', { id: 'node_inquirytest' });
			await saveDraftPage({ slug: doc.slug, expectedRevision: 0, document: doc });
			const good = { slug: doc.slug, nodeId: 'node_inquirytest', requestId: randomUUID().replaceAll('-', ''), name: 'نام نمونه', contact: 'hello@example.com', message: 'پیام نمونه' };
			assert.equal((await POST(context(good))).status, 404);
			assert.equal((await POST(context({ ...good, website: 'spam' }))).status, 400);
			assert.equal((await POST(context({ ...good, requestId: 'bad' }))).status, 400);
			assert.equal((await POST(context({ ...good, message: 'x'.repeat(18000) }))).status, 400);
			assert.equal((await POST(context({ ...good, extra: 'not accepted' }))).status, 400);
		} finally {
			if (previous === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = previous;
			await rm(dir, { recursive: true, force: true });
		}
	});
});

it('persists an actual published form via the explicitly isolated Go/PostgreSQL test service', async (t) => {
	const url = process.env.NOVEX_TEST_BACKEND_URL, token = process.env.NOVEX_TEST_BACKEND_TOKEN;
	if (!url || !token) return t.skip('Set NOVEX_TEST_BACKEND_URL and NOVEX_TEST_BACKEND_TOKEN for an isolated test service.');
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-inquiry-integration-'));
	const oldFile = process.env.BUILDER_DATA_FILE, oldUrl = process.env.NOVEX_BACKEND_URL, oldToken = process.env.NOVEX_BACKEND_TOKEN;
	process.env.BUILDER_DATA_FILE = path.join(dir, 'builder.json');
	process.env.NOVEX_BACKEND_URL = url; process.env.NOVEX_BACKEND_TOKEN = token;
	let id = '';
	try {
		const slug = `inquiry-${randomUUID().slice(0, 8)}`;
		const doc = addNode(createEmptyPageDocument(slug), 'InquiryForm', { id: 'node_inquiryintegration' });
		await saveDraftPage({ slug, expectedRevision: 0, document: doc });
		const body = { slug, nodeId: 'node_inquiryintegration', requestId: randomUUID().replaceAll('-', ''), name: 'نام آزمایشی', contact: 'integration@example.invalid', message: 'این درخواست آزمایشی است.' };
		assert.equal((await POST(context(body))).status, 404);
		const draft = await getDraftPage(slug);
		await publishPage({ slug, expectedRevision: draft.revision, document: draft.draft });
		const created = await POST(context(body)); assert.equal(created.status, 201);
		const createdBody = await created.json() as { ok: boolean; id: string };
		assert.equal(createdBody.ok, true); id = createdBody.id;
		const replay = await POST(context(body)); assert.equal(replay.status, 201);
		assert.equal((await replay.json() as { id: string }).id, id);
		assert.equal((await POST(context({ ...body, message: 'متن متفاوت' }))).status, 409);
		const list = await listInquiries({ limit: 100 }); assert.ok(list.items.some((item) => item.id === id && item.pageSlug === slug));
		await updateInquiry(id, 'archived');
		assert.ok((await listInquiries({ status: 'archived', limit: 100 })).items.some((item) => item.id === id));
		await deleteInquiry(id); id = '';
	} finally {
		if (id) await deleteInquiry(id).catch(() => undefined);
		if (oldFile === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = oldFile;
		if (oldUrl === undefined) delete process.env.NOVEX_BACKEND_URL; else process.env.NOVEX_BACKEND_URL = oldUrl;
		if (oldToken === undefined) delete process.env.NOVEX_BACKEND_TOKEN; else process.env.NOVEX_BACKEND_TOKEN = oldToken;
		await rm(dir, { recursive: true, force: true });
	}
});

it('fails closed if the service is unavailable instead of reporting success', async () => {
	await assert.rejects(deleteInquiry('inq_not-a-real-id'), (error: unknown) => error instanceof BackendError && error.status === 400);
	const oldUrl = process.env.NOVEX_BACKEND_URL, oldToken = process.env.NOVEX_BACKEND_TOKEN;
	process.env.NOVEX_BACKEND_URL = 'http://127.0.0.1:9';
	process.env.NOVEX_BACKEND_TOKEN = '0123456789abcdef0123456789abcdef';
	try { await assert.rejects(deleteInquiry('inq_11111111111111111111111111111111'), (error: unknown) => error instanceof BackendError && error.status === 503); }
	finally {
		if (oldUrl === undefined) delete process.env.NOVEX_BACKEND_URL; else process.env.NOVEX_BACKEND_URL = oldUrl;
		if (oldToken === undefined) delete process.env.NOVEX_BACKEND_TOKEN; else process.env.NOVEX_BACKEND_TOKEN = oldToken;
	}
});
