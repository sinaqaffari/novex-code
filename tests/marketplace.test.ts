import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { filterCatalogSections, filterCatalogTemplates, getCatalogSection, getCatalogTemplate, listCatalogSections, listCatalogTemplates, SECTION_CATEGORIES, TEMPLATE_CATEGORIES } from '../src/lib/builder/template-catalog.ts';
import { getStarterTemplate, listStarterTemplateSummaries, applyTemplate } from '../src/lib/builder/templates.ts';
import { createEmptyPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { compilePageDocument } from '../src/lib/builder/publishing.ts';
import { traversePageNodes } from '../src/lib/builder/operations.ts';
import { assetExists } from '../src/lib/cms/media.ts';
import { POST as createPage } from '../src/pages/cms/api/builder/pages/index.ts';
import { GET as readTemplate } from '../src/pages/cms/api/builder/templates/[id].ts';
import { getDraftPage, getPublishedPage, listBuilderPages } from '../src/lib/builder/store.ts';
import type { PageDocument } from '../src/lib/builder/types.ts';

const locals = (role: string) => ({ cmsUser: { username: 'test', role } });
function request(payload: unknown, role = 'editor') {
	return createPage({ locals: locals(role), request: new Request('http://localhost/cms/api/builder/pages', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) }) } as never);
}

function ids(document: PageDocument): string[] {
	const result: string[] = [];
	traversePageNodes(document, (node) => result.push(node.id));
	return result;
}

describe('public native template catalogue', () => {
	it('lists real curated designs, filters Persian spelling and never includes saved private templates', () => {
		const catalogue = listCatalogTemplates();
		assert.equal(catalogue.length, 8);
		assert.equal(new Set(catalogue.map((item) => item.id)).size, catalogue.length);
		assert.equal(new Set(TEMPLATE_CATEGORIES.map((item) => item.id)).size, TEMPLATE_CATEGORIES.length);
		assert.ok(catalogue.every((item) => item.kind === 'page' && item.image.startsWith('/media/builder-')));
		assert.ok(!getCatalogTemplate('template_private'));
		assert.equal(filterCatalogTemplates('كلينيك', '')[0]?.id, 'clinic-landing');
		assert.equal(filterCatalogTemplates('', 'shop')[0]?.id, 'shop-landing');
		assert.deepEqual(filterCatalogTemplates('چیزی ناموجود', ''), []);
		assert.deepEqual(filterCatalogTemplates('', 'unknown'), []);
		assert.ok(listStarterTemplateSummaries().every((item) => !('document' in item)));
	});

	it('every listed design renders from a valid editable document and its bundled image exists', async () => {
		for (const item of listCatalogTemplates()) {
			const template = getStarterTemplate(item.id);
			assert.ok(template, item.id);
			assert.equal(template.kind, 'page');
			assert.equal(compilePageDocument(template.document).ok, true, item.id);
			assert.equal(await assetExists(item.image.slice('/media/'.length)), true, item.id);
			const nodeTypes = new Set<string>();
			traversePageNodes(template.document, (node) => nodeTypes.add(node.type));
			for (const type of ['Container', 'Heading', 'Text', 'Image', 'Button']) assert.ok(nodeTypes.has(type), `${item.id}: ${type}`);
			const applied = applyTemplate(template.document, createEmptyPageDocument(`test-${item.id}`, 'عنوان مستقل'));
			assert.equal(applied.title, 'عنوان مستقل');
			assert.equal(applied.slug, `test-${item.id}`);
			assert.deepEqual(validatePageDocument(applied), applied);
			assert.ok(ids(applied).every((id) => !ids(template.document).includes(id)));
		}
		const first = getStarterTemplate('clinic-landing')!;
		first.document.nodes.length = 0;
		assert.ok(getStarterTemplate('clinic-landing')!.document.nodes.length > 0);
	});

	it('lists and compiles real independent section previews, including a real-data product grid', async () => {
		const sections = listCatalogSections();
		assert.equal(sections.length, 8);
		assert.equal(new Set(sections.map((item) => item.id)).size, sections.length);
		assert.equal(new Set(SECTION_CATEGORIES.map((item) => item.id)).size, SECTION_CATEGORIES.length);
		assert.equal(filterCatalogSections('كلينيك', '')[0]?.id, 'section-clinic-faq');
		assert.equal(filterCatalogSections('', 'shop')[0]?.id, 'section-shop-products');
		assert.deepEqual(filterCatalogSections('', 'missing'), []);
		assert.equal(getCatalogSection('template_private'), undefined);
		for (const item of listStarterTemplateSummaries().filter((entry) => entry.kind === 'section')) {
			assert.ok('image' in item && typeof item.image === 'string', item.id);
			assert.equal(await assetExists(item.image.slice('/media/'.length)), true, item.id);
		}
		for (const item of sections) {
			assert.ok(!('document' in item));
			assert.equal(await assetExists(item.image.slice('/media/'.length)), true, item.id);
			const template = getStarterTemplate(item.id);
			assert.ok(template, item.id);
			assert.equal(template.kind, 'section');
			assert.equal(template.document.nodes.length, 1);
			assert.equal(compilePageDocument(template.document).ok, true, item.id);
			const types = new Set<string>();
			traversePageNodes(template.document, (node) => types.add(node.type));
			assert.ok(types.has('Container') && (types.has('Heading') || types.has('ProductGrid')), item.id);
			if (item.category === 'shop') assert.ok(types.has('ProductGrid'));
			if (item.category === 'faq') assert.ok(types.has('Accordion'));
			template.document.nodes.length = 0;
			assert.equal(getStarterTemplate(item.id)?.document.nodes.length, 1);
		}
	});

	it('exposes bundled documents only to roles permitted to read pages', async () => {
		const denied = await readTemplate({ params: { id: 'restaurant-landing' }, locals: locals('subscriber') } as never);
		assert.equal(denied.status, 403);
		const response = await readTemplate({ params: { id: 'restaurant-landing' }, locals: locals('editor') } as never);
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(body.template.id, 'restaurant-landing');
		assert.equal(body.template.document.nodes.length > 0, true);
	});
});

describe('creating drafts directly from native templates', () => {
	it('validates permissions, creates one independent draft atomically and refuses collisions or invalid input', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'novex-marketplace-test-'));
		const previous = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(directory, 'pages.json');
		try {
			const denied = await request({ slug: 'market-denied', title: 'نه', templateId: 'clinic-landing' }, 'subscriber');
			assert.equal(denied.status, 403);
			const missing = await request({ slug: 'market-missing', title: 'نه', templateId: 'not-a-design' });
			assert.equal(missing.status, 404);
			assert.equal((await missing.json()).code, 'template_not_found');
			const section = await request({ slug: 'market-section', title: 'نه', templateId: 'hero-intro' });
			assert.equal(section.status, 404);
			const malformed = await request({ slug: 'market-bad', title: 'عنوان\u0000بد', templateId: 'clinic-landing' });
			assert.equal(malformed.status, 400);
			assert.equal((await listBuilderPages()).length, 0);
			const response = await request({ slug: 'market-clinic', title: 'کلینیک من', templateId: 'clinic-landing' });
			assert.equal(response.status, 201);
			const body = await response.json();
			assert.equal(body.revision, 1);
			assert.equal(body.document.title, 'کلینیک من');
			assert.equal(body.document.slug, 'market-clinic');
			assert.ok(body.document.nodes.length > 0);
			const stored = await getDraftPage('market-clinic');
			assert.deepEqual(stored.draft, body.document);
			assert.equal(await getPublishedPage('market-clinic'), null);
			const collision = await request({ slug: 'market-clinic', title: 'نباید جایگزین شود', templateId: 'education-landing' });
			assert.equal(collision.status, 409);
			const collisionBody = await collision.json();
			assert.equal(collisionBody.code, 'revision_conflict');
			assert.match(collisionBody.message, /نامک دیگری انتخاب کنید/);
			const overwrite = await request({ slug: 'market-clinic', title: 'بازنویسی', expectedRevision: 1 });
			assert.equal(overwrite.status, 400);
			assert.deepEqual((await getDraftPage('market-clinic')).draft, stored.draft);
			const form = new URLSearchParams({ slug: 'market-clinic', title: 'عنوان قبلی', templateId: 'clinic-landing' });
			const formResponse = await createPage({ locals: locals('editor'), request: new Request('http://localhost/cms/api/builder/pages', { method: 'POST', body: form }) } as never);
			assert.equal(formResponse.status, 303);
			const destination = new URL(formResponse.headers.get('location')!, 'http://localhost');
			assert.equal(destination.pathname, '/cms/pages/new');
			assert.equal(destination.searchParams.get('template'), 'clinic-landing');
			assert.equal(destination.searchParams.get('slug'), 'market-clinic');
			assert.ok(destination.searchParams.get('error'));
		} finally {
			if (previous === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = previous;
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('creates a new independent draft from a chosen section without allowing ambiguous or wrong kinds', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'novex-section-draft-'));
		const previous = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(directory, 'pages.json');
		try {
			assert.equal((await request({ slug: 'section-denied', title: 'نه', sectionId: 'section-clinic-faq' }, 'subscriber')).status, 403);
			assert.equal((await request({ slug: 'section-wrong', title: 'نه', sectionId: 'clinic-landing' })).status, 404);
			assert.equal((await request({ slug: 'section-missing', title: 'نه', sectionId: 'missing' })).status, 404);
			assert.equal((await request({ slug: 'section-both', title: 'نه', sectionId: 'section-clinic-faq', templateId: 'clinic-landing' })).status, 400);
			const response = await request({ slug: 'section-new', title: 'صفحهٔ مستقل', sectionId: 'section-clinic-faq' });
			assert.equal(response.status, 201);
			const body = await response.json();
			const source = getStarterTemplate('section-clinic-faq')!;
			assert.equal(body.document.title, 'صفحهٔ مستقل');
			assert.equal(body.document.nodes.length, 1);
			assert.ok(ids(body.document).every((id) => !ids(source.document).includes(id)));
			assert.equal(await getPublishedPage('section-new'), null);
			const stored = await getDraftPage('section-new');
			assert.deepEqual(stored.draft, body.document);
			const collision = await request({ slug: 'section-new', title: 'بازنویسی', sectionId: 'section-education-faq' });
			assert.equal(collision.status, 409);
			assert.deepEqual((await getDraftPage('section-new')).draft, stored.draft);
			const form = new URLSearchParams({ slug: 'section-new', title: 'عنوان قبلی', sectionId: 'section-education-faq' });
			const formResponse = await createPage({ locals: locals('editor'), request: new Request('http://localhost/cms/api/builder/pages', { method: 'POST', body: form }) } as never);
			assert.equal(formResponse.status, 303);
			const destination = new URL(formResponse.headers.get('location')!, 'http://localhost');
			assert.equal(destination.searchParams.get('section'), 'section-education-faq');
			assert.equal(destination.searchParams.get('slug'), 'section-new');
			assert.ok(destination.searchParams.get('error'));
		} finally {
			if (previous === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = previous;
			await rm(directory, { recursive: true, force: true });
		}
	});
});
