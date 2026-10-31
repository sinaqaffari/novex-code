import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectDocumentAssets } from '../src/lib/builder/assets.ts';
import { executeDocumentCommand } from '../src/lib/builder/commands.ts';
import { createEmptyPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { dropInsertionPoint, dropPlacement } from '../src/lib/builder/drag-drop.ts';
import { commitDocument, createDocumentHistory, redoDocument, undoDocument } from '../src/lib/builder/history.ts';
import { addNode, createBuilderNode, findNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { compilePageDocument } from '../src/lib/builder/publishing.ts';
import { resolveNodeStyles } from '../src/lib/builder/responsive.ts';
import { applyTemplate, listStarterTemplates } from '../src/lib/builder/templates.ts';
import { assetExists } from '../src/lib/cms/media.ts';
import type { BuilderNode, PageDocument } from '../src/lib/builder/types.ts';

function flatten(nodes: BuilderNode[]): BuilderNode[] {
	return nodes.flatMap((node) => node.type === 'Container' ? [node, ...flatten(node.children)] : [node]);
}

describe('Visual starter designs', () => {
	it('ships distinct complete, responsive, editable pages with available bundled images', async () => {
		const ids = ['studio-landing', 'travel-landing', 'portfolio-landing', 'shop-landing'];
		const templates = listStarterTemplates().filter((entry) => ids.includes(entry.id));
		assert.equal(templates.length, 4);
		const imageIdentities = new Set<string>();
		for (const template of templates) {
			assert.equal(template.kind, 'page');
			assert.ok(template.document.nodes.length >= 5, template.id);
			const all = flatten(template.document.nodes);
			assert.ok(all.length >= 25, `${template.id}: expected a complete editable composition`);
			assert.ok(all.some((node) => node.type === 'Container' && node.responsiveStyles));
			const asset = collectDocumentAssets(template.document)[0];
			assert.ok(asset, `${template.id}: expected a local editable image`);
			assert.equal(await assetExists(asset.identity.replace(/^assets\//, '')), true, asset.identity);
			imageIdentities.add(asset.identity);
			const applied = applyTemplate(template.document, createEmptyPageDocument(`test-${template.id}`, 'عنوان من'));
			assert.equal(applied.title, 'عنوان من');
			assert.notEqual(applied.nodes[0].id, template.document.nodes[0].id);
			const heading = flatten(applied.nodes).find((node) => node.type === 'Heading');
			assert.ok(heading);
			const edited = updateNodeProps(applied, heading.id, { text: 'عنوان ویرایش‌شده' });
			assert.equal((findNode(edited.nodes, heading.id) as Extract<BuilderNode, { type: 'Heading' }>).props.text, 'عنوان ویرایش‌شده');
			assert.doesNotThrow(() => validatePageDocument(edited, applied.slug));
			assert.equal(compilePageDocument(edited, applied.slug).ok, true);
		}
		assert.equal(imageIdentities.size, 4);
	});

	it('uses real product binding rather than fabricated product cards in the shop design', () => {
		const shop = listStarterTemplates().find((entry) => entry.id === 'shop-landing')!;
		const products = flatten(shop.document.nodes).filter((node) => node.type === 'ProductGrid');
		assert.equal(products.length, 1);
		assert.deepEqual(products[0].props.binding, { provider: 'novex-commerce-products', version: 1, selection: 'latest', limit: 4 });
		const grid = flatten(shop.document.nodes).find((node) => node.type === 'Container' && node.styles?.columns === 3)!;
		assert.equal(resolveNodeStyles(grid, 'desktop', shop.document).columns, 3);
		assert.equal(resolveNodeStyles(grid, 'tablet', shop.document).columns, 2);
		assert.equal(resolveNodeStyles(grid, 'mobile', shop.document).columns, 1);
	});
});

describe('Visual drop placement and commands', () => {
	function fixture(): PageDocument {
		let document = createEmptyPageDocument('drop-test');
		document = addNode(document, 'Container', { id: 'node_section01' });
		document = addNode(document, 'Heading', { parentId: 'node_section01', id: 'node_heading01' });
		document = addNode(document, 'Text', { id: 'node_textroot01' });
		return document;
	}

	it('chooses container edges or interior and leaf insertion edges', () => {
		const container = createBuilderNode('Container', 'node_section01');
		const heading = createBuilderNode('Heading', 'node_heading01');
		assert.equal(dropPlacement(container, 100, 200, 101), 'before');
		assert.equal(dropPlacement(container, 100, 200, 150), 'inside');
		assert.equal(dropPlacement(container, 100, 200, 299), 'after');
		assert.equal(dropPlacement(heading, 100, 40, 105), 'before');
		assert.equal(dropPlacement(heading, 100, 40, 139), 'after');
		assert.equal(dropPlacement(container, 0, 0, 0), 'inside');
	});

	it('resolves nested and root insertion points, and rejects stale or invalid targets', () => {
		const document = fixture();
		assert.deepEqual(dropInsertionPoint(document, null), { parentId: null, index: 2 });
		assert.deepEqual(dropInsertionPoint(document, 'node_section01', 'inside'), { parentId: 'node_section01', index: 1 });
		assert.deepEqual(dropInsertionPoint(document, 'node_heading01', 'before'), { parentId: 'node_section01', index: 0 });
		assert.deepEqual(dropInsertionPoint(document, 'node_heading01', 'after'), { parentId: 'node_section01', index: 1 });
		assert.throws(() => dropInsertionPoint(document, 'node_heading01', 'inside'));
		assert.throws(() => dropInsertionPoint(document, 'node_missing01', 'before'));
	});

	it('inserts and moves through validated commands with undo and no partial mutation', () => {
		const original = fixture();
		const insertion = dropInsertionPoint(original, 'node_heading01', 'before');
		const inserted = executeDocumentCommand(original, { type: 'insert', component: 'Image', id: 'node_image001', ...insertion, props: { alt: 'تصویر تازه' } });
		assert.equal(inserted.ok, true);
		if (!inserted.ok) return;
		const section = findNode(inserted.document.nodes, 'node_section01');
		assert.equal(section?.type, 'Container');
		if (section?.type !== 'Container') return;
		assert.deepEqual(section.children.map((node) => node.id), ['node_image001', 'node_heading01']);
		const moved = executeDocumentCommand(inserted.document, { type: 'move-root', id: 'node_image001' });
		assert.equal(moved.ok, true);
		if (!moved.ok) return;
		assert.equal(moved.document.nodes.at(-1)?.id, 'node_image001');
		assert.equal(findNode(moved.document.nodes, 'node_image001')?.type, 'Image');
		const history = commitDocument(createDocumentHistory(inserted.document), moved.document, 60, { selectionAfter: 'node_image001' });
		assert.deepEqual(undoDocument(history).present, inserted.document);
		assert.deepEqual(redoDocument(undoDocument(history)).present, moved.document);
		const invalid = executeDocumentCommand(inserted.document, { type: 'insert', component: 'GlobalCode', parentId: 'node_section01', id: 'node_badcode01' });
		assert.equal(invalid.ok, false);
		assert.equal(findNode(inserted.document.nodes, 'node_badcode01'), null);
		const missing = executeDocumentCommand(inserted.document, { type: 'move-root', id: 'node_missing01' });
		assert.equal(missing.ok, false);
	});
});
