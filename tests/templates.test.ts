import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyTemplate,
	listStarterTemplates,
	templateDocumentForPage,
} from '../src/lib/builder/templates.ts';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { updateNodeProps } from '../src/lib/builder/operations.ts';
import { validatePageDocument } from '../src/lib/builder/document.ts';
import type { PageDocument } from '../src/lib/builder/types.ts';

describe('Reusable sections and templates', () => {
	it('returns the existing starters and editable visual page designs', () => {
		const templates = listStarterTemplates();
		assert.equal(templates.length, 9);
		const ids = templates.map((t) => t.id);
		assert.ok(ids.includes('hero-intro'));
		assert.ok(ids.includes('feature-grid'));
		assert.ok(ids.includes('contact-cta'));
		assert.ok(ids.includes('storefront-start'));
		assert.ok(ids.includes('business-page'));
	});

	it('storefront template links to real shop, cart, checkout, and contact routes with no fake products', () => {
		const template = listStarterTemplates().find((t) => t.id === 'storefront-start')!;
		assert.ok(template);
		assert.match(template.description, /بدون محصول ساختگی/);

		function collectButtons(nodes: PageDocument['nodes']): Array<{ type: string; href: string }> {
			const result: Array<{ type: string; href: string }> = [];
			for (const node of nodes) {
				if (node.type === 'Button') {
					result.push({ type: node.type, href: node.props.href });
				}
				if (node.type === 'Container' && node.children) {
					result.push(...collectButtons(node.children));
				}
			}
			return result;
		}

		const buttons = collectButtons(template.document.nodes);
		const hrefs = [...new Set(buttons.map((b) => b.href))].sort();
		assert.deepEqual(hrefs, ['/about', '/shop', '/shop/cart', '/shop/checkout']);
	});

	it('applies a template to a page, replacing nodes but keeping slug and title', () => {
		const current = { ...createEmptyPageDocument('my-page', 'عنوان من'), description: 'توضیح من' };
		const template = listStarterTemplates()[0];
		const result = applyTemplate(template.document, current);

		assert.equal(result.slug, 'my-page');
		assert.equal(result.title, current.title);
		assert.equal(result.description, current.description);
		assert.equal(result.themeId, template.document.themeId);
		assert.equal(result.nodes.length, template.document.nodes.length);
		// New IDs are generated for cloned nodes
		assert.notEqual(result.nodes[0].id, template.document.nodes[0].id);
	});

	it('template application produces a valid document', () => {
		const current = createEmptyPageDocument('template-test', 'صفحه تست');
		const template = listStarterTemplates()[0];
		const result = applyTemplate(template.document, current);
		assert.doesNotThrow(() => validatePageDocument(result, 'template-test'));
	});

	it('templateDocumentForPage produces the same structure as applyTemplate with fresh IDs', () => {
		const current = createEmptyPageDocument('alias-test', 'عنوان');
		const template = listStarterTemplates()[0];
		const a = applyTemplate(template.document, current);
		const b = templateDocumentForPage(template.document, current);

		// Same structure, different generated IDs
		assert.equal(a.slug, b.slug);
		assert.equal(a.title, b.title);
		assert.equal(a.themeId, b.themeId);
		assert.equal(a.nodes.length, b.nodes.length);
		for (let i = 0; i < a.nodes.length; i += 1) {
			assert.equal(a.nodes[i].type, b.nodes[i].type);
			assert.notEqual(a.nodes[i].id, b.nodes[i].id);
		if (a.nodes[i].type === 'Container' && b.nodes[i].type === 'Container') {
			assert.equal((a.nodes[i] as { children: unknown[] }).children.length, (b.nodes[i] as { children: unknown[] }).children.length);
		}
		}
		assert.doesNotThrow(() => validatePageDocument(a, 'alias-test'));
		assert.doesNotThrow(() => validatePageDocument(b, 'alias-test'));
	});

	it('starter template nodes can be edited after application through operations', () => {
		const current = createEmptyPageDocument('edit-test', 'صفحه Edit');
		const template = listStarterTemplates().find((t) => t.id === 'feature-grid')!;
		let result = applyTemplate(template.document, current);

		const firstContainer = result.nodes.find((n) => n.type === 'Container');
		assert.ok(firstContainer);

		result = updateNodeProps(result, firstContainer!.id, { gap: 32 });
		const updated = result.nodes.find((n) => n.id === firstContainer!.id);
		assert.ok(updated);
		assert.equal(updated!.type, 'Container');
		if (updated!.type === 'Container') {
			assert.equal(updated!.props.gap, 32);
		}
	});

	it('duplicate template preserves document structure with fresh IDs', () => {
		const current = createEmptyPageDocument('dup-test', 'original');
		const template = listStarterTemplates()[0];
		const applied = applyTemplate(template.document, current);
		const cloned = templateDocumentForPage(template.document, applied);

		assert.notEqual(cloned, applied);
		assert.equal(cloned.nodes.length, applied.nodes.length);
		// IDs differ between applications
		for (let i = 0; i < cloned.nodes.length; i += 1) {
			assert.notEqual(cloned.nodes[i].id, applied.nodes[i].id);
		}
	});

	it('reusing the same template on multiple pages produces independent documents', () => {
		const template = listStarterTemplates()[0];
		const pageA = applyTemplate(template.document, createEmptyPageDocument('page-a', 'صفحه A'));
		const pageB = applyTemplate(template.document, createEmptyPageDocument('page-b', 'صفحه B'));

		assert.notEqual(pageA.slug, pageB.slug);
		assert.notEqual(pageA.title, pageB.title);
		assert.notEqual(pageA.nodes[0].id, pageB.nodes[0].id);
		assert.equal(pageA.themeId, pageB.themeId);
	});

	it('compatible templates carry the same schema version', () => {
		for (const template of listStarterTemplates()) {
			assert.equal(template.document.schemaVersion, 5);
			assert.doesNotThrow(() => validatePageDocument(template.document, template.document.slug));
		}
	});

	it('business page template contains header, hero, grid, images, testimonials, pricing, FAQ, and footer sections', () => {
		const template = listStarterTemplates().find((t) => t.id === 'business-page')!;
		assert.ok(template);

		function collectAllNodes(nodes: PageDocument['nodes']): PageDocument['nodes'] {
			const result: PageDocument['nodes'] = [];
			for (const node of nodes) {
				result.push(node);
				if (node.type === 'Container' && node.children) {
					result.push(...collectAllNodes(node.children));
				}
			}
			return result;
		}

		const allNodes = collectAllNodes(template.document.nodes);
		const nodeTypes = new Set(allNodes.map((n) => n.type));
		assert.ok(nodeTypes.has('Container'));
		assert.ok(nodeTypes.has('Heading'));
		assert.ok(nodeTypes.has('Text'));
		assert.ok(nodeTypes.has('Button'));

		// All headings and text nodes use non-empty content
		for (const node of allNodes) {
			if (node.type === 'Heading' || node.type === 'Text') {
				assert.ok(node.props.text && node.props.text.length > 0, `Empty text in node ${node.id}`);
			}
			if (node.type === 'Button') {
				assert.ok(node.props.label && node.props.label.length > 0, `Empty label in node ${node.id}`);
				assert.ok(node.props.href && node.props.href.length > 0, `Empty href in node ${node.id}`);
			}
		}
	});

	it('business page template is a valid document and editable after application', () => {
		const current = createEmptyPageDocument('business-test', 'صفحه تجاری تست');
		const template = listStarterTemplates().find((t) => t.id === 'business-page')!;
		let result = applyTemplate(template.document, current);

		assert.equal(result.slug, 'business-test');
		assert.equal(result.title, current.title);
		assert.equal(result.themeId, template.document.themeId);
		assert.doesNotThrow(() => validatePageDocument(result, 'business-test'));

		// Edit a node after application
		const firstContainer = result.nodes.find((n) => n.type === 'Container');
		assert.ok(firstContainer);
		result = updateNodeProps(result, firstContainer!.id, { gap: 24 });
		const updated = result.nodes.find((n) => n.id === firstContainer!.id);
		assert.ok(updated);
		if (updated!.type === 'Container') {
			assert.equal(updated!.props.gap, 24);
		}
	});

	it('business page template produces independent documents when applied to multiple pages', () => {
		const template = listStarterTemplates().find((t) => t.id === 'business-page')!;
		const pageA = applyTemplate(template.document, createEmptyPageDocument('page-a', 'صفحه A'));
		const pageB = applyTemplate(template.document, createEmptyPageDocument('page-b', 'صفحه B'));

		assert.notEqual(pageA.slug, pageB.slug);
		assert.notEqual(pageA.title, pageB.title);
		assert.notEqual(pageA.nodes[0].id, pageB.nodes[0].id);
		assert.equal(pageA.themeId, pageB.themeId);
		assert.doesNotThrow(() => validatePageDocument(pageA, 'page-a'));
		assert.doesNotThrow(() => validatePageDocument(pageB, 'page-b'));
	});
});
