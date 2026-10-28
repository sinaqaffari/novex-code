import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AutosaveConflictError, AutosaveController, type AutosaveStatus } from '../src/lib/builder/autosave.ts';
import {
	createEmptyPageDocument,
	exportPageDocument,
	hiddenAtBreakpoint,
	importPageDocument,
	validatePageDocument,
} from '../src/lib/builder/document.ts';
import { commitDocument, createDocumentHistory, redoDocument, undoDocument } from '../src/lib/builder/history.ts';
import {
	addNode,
	deleteNode,
	duplicateNode,
	findNode,
	findNodeLocation,
	moveNode,
	moveNodeBy,
	setNodeHiddenAtBreakpoint,
	updateNodeProps,
	updateNodeStyles,
} from '../src/lib/builder/operations.ts';
import { normalizeProps, safeHref, safeImageSrc } from '../src/lib/builder/registry.ts';
import { applyTemplate, listStarterTemplates } from '../src/lib/builder/templates.ts';
import { buildResponsiveCss, controlledNodeStyle, publicPagePath } from '../src/lib/builder/render.ts';
import { themeStyleText } from '../src/lib/builder/themes.ts';
import type { BuilderNode, PageDocument } from '../src/lib/builder/types.ts';

const page = () => createEmptyPageDocument('builder-test', 'صفحهٔ آزمون');

function withHeading(document: PageDocument, id = 'node_heading01'): PageDocument {
	return addNode(document, 'Heading', { id });
}

function collectNodes(nodes: readonly BuilderNode[]): BuilderNode[] {
	return nodes.flatMap((node) => node.type === 'Container' ? [node, ...collectNodes(node.children)] : [node]);
}

describe('Builder registry and document contract', () => {
	it('provides normalized defaults for Container, Heading, Text, Image, and Button components', () => {
		assert.equal(normalizeProps('Container', undefined).layout, 'stack');
		assert.equal(normalizeProps('Heading', undefined).level, 2);
		assert.equal(normalizeProps('Text', undefined).size, 'md');
		assert.equal(normalizeProps('Image', undefined).src, '');
		assert.equal(normalizeProps('Button', undefined).href, '#');
	});

	it('validates plain text and safe image sources without accepting executable or insecure URLs', () => {
		assert.equal(normalizeProps('Text', { text: 'خط اول\nخط دوم' }).text, 'خط اول\nخط دوم');
		assert.equal(normalizeProps('Image', { src: '/media/catalog/item.webp', alt: 'محصول' }).src, '/media/catalog/item.webp');
		assert.equal(safeImageSrc('https://images.example.test/item.webp'), true);
		assert.equal(safeImageSrc(''), true);
		assert.equal(safeImageSrc('javascript:alert(1)'), false);
		assert.equal(safeImageSrc('data:image/svg+xml,<svg/>'), false);
		assert.equal(safeImageSrc('http://images.example.test/item.webp'), false);
		assert.equal(safeImageSrc('//images.example.test/item.webp'), false);
		assert.throws(() => normalizeProps('Image', { src: 'javascript:alert(1)' }), /safe HTTPS URL/i);
		assert.throws(() => normalizeProps('Text', { text: 'x'.repeat(5001) }), /at most 5000/);
	});

	it('normalizes omitted props and stable document structure', () => {
		const document = validatePageDocument({
			schemaVersion: 1,
			id: 'page_builder-test',
			slug: 'builder-test',
			title: 'صفحهٔ آزمون',
			nodes: [{ id: 'node_heading01', type: 'Heading', componentVersion: 1, props: { text: 'سلام' } }],
		});
		assert.equal(document.description, '');
		assert.equal(document.themeId, 'site');
		assert.equal(document.nodes[0].type, 'Heading');
		if (document.nodes[0].type === 'Heading') {
			assert.equal(document.nodes[0].props.level, 2);
			assert.equal(document.nodes[0].props.text, 'سلام');
		}
		assert.equal(importPageDocument(exportPageDocument(document), 'builder-test').title, 'صفحهٔ آزمون');
	});

	it('rejects arbitrary properties, unsafe links, unsupported component versions, and duplicate IDs', () => {
		const base = withHeading(page());
		const heading = base.nodes[0];
		assert.throws(() => validatePageDocument({ ...base, nodes: [{ ...heading, props: { text: 'x', onClick: 'alert(1)' } }] }), /unsupported property/i);
		assert.throws(() => normalizeProps('Button', { ...normalizeProps('Button', undefined), href: 'javascript:alert(1)' }), /safe/i);
		assert.throws(() => validatePageDocument({ ...base, nodes: [{ ...heading, componentVersion: 99 }] }), /unsupported Heading component version/i);
		assert.throws(() => validatePageDocument({ ...base, nodes: [heading, { ...heading }] }), /unique/i);
		assert.throws(() => validatePageDocument({ ...base, themeId: 'not-a-theme' }), /Theme ID is not supported/i);
	});

	it('provides reusable starter templates with a token-only grid layout', () => {
		const templates = listStarterTemplates();
		assert.equal(templates.length, 4);
		const grid = templates.find((template) => template.id === 'feature-grid')!;
		assert.equal(grid.document.nodes.some((node) => node.type === 'Container' && node.props.layout === 'grid'), true);
		const current = { ...page(), title: 'صفحهٔ من', description: 'توضیح من' };
		const result = applyTemplate(grid.document, current, (() => {
			let index = 0;
			return () => `node_fresh000${++index}`;
		})());
		assert.equal(result.slug, current.slug);
		assert.equal(result.title, current.title);
		assert.equal(result.themeId, grid.document.themeId);
		assert.notEqual(result.nodes[0].id, grid.document.nodes[0].id);
	});

	it('provides a Persian storefront starter wired to the existing shop, cart, checkout, and contact routes', () => {
		const template = listStarterTemplates().find((item) => item.id === 'storefront-start');
		assert.ok(template);
		const nodes = collectNodes(template.document.nodes);
		assert.equal(nodes.some((node) => node.type === 'Container' && node.props.layout === 'grid'), true);
		assert.equal(nodes.some((node) => node.type === 'Text'), true);
		const links = nodes.filter((node) => node.type === 'Button').map((node) => node.props.href);
		assert.deepEqual([...new Set(links)].sort(), ['/about', '/shop', '/shop/cart', '/shop/checkout']);
		assert.match(template.description, /بدون محصول ساختگی/);
	});

	it('allows only safe internal and HTTP(S) button destinations', () => {
		assert.equal(safeHref('/about?from=builder'), true);
		assert.equal(safeHref('#contact'), true);
		assert.equal(safeHref('https://example.com/path'), true);
		assert.equal(safeHref('//example.com/path'), false);
		assert.equal(safeHref('javascript:alert(1)'), false);
		assert.equal(safeHref('https://user:pass@example.com'), false);
	});

	it('renders responsive CSS only from validated tokens and exposes built-in theme variables', () => {
	let document = withHeading(page());
	document = updateNodeStyles(document, 'node_heading01', { marginBlockStart: 16 });
	document = updateNodeStyles(document, 'node_heading01', { width: 'wide' }, 'tablet');
	document = setNodeHiddenAtBreakpoint(document, 'node_heading01', 'mobile', true);
	const node = findNode(document.nodes, 'node_heading01')!;
	const css = buildResponsiveCss(document);
	assert.equal(controlledNodeStyle(node.styles), 'margin-block-start:16px');
	assert.match(css, /max-width:1023px/);
	assert.match(css, /width:min\(100%,72rem\)/);
	assert.match(css, /max-width:767px/);
	assert.match(css, /display:none!important/);
	assert.equal(publicPagePath('safe-page'), '/pages/safe-page');
	assert.match(themeStyleText('warm') ?? '', /--brand:#a44d2d/);
});

	it('migrates known schema-zero aliases for heading, text, and image before validation', () => {
		const migrated = validatePageDocument({
			schemaVersion: 0,
			slug: 'builder-test',
			title: 'نسخهٔ قدیمی',
			blocks: [
				{ id: 'node_heading01', type: 'heading', props: { text: 'تیتر قدیمی' } },
				{ id: 'node_text00001', type: 'text', props: { text: 'متن قدیمی' } },
				{ id: 'node_image0001', type: 'image', props: { src: '/media/old.webp', alt: 'تصویر قدیمی' } },
			],
		});
		assert.equal(migrated.schemaVersion, 1);
		assert.deepEqual(migrated.nodes.map((node) => node.type), ['Heading', 'Text', 'Image']);
	});

	it('caps nesting and node count and rejects mismatched slugs', () => {
		const document = page();
		assert.throws(() => validatePageDocument(document, 'different-page'), /does not match/i);
		const repeated = Array.from({ length: 201 }, (_, index) => ({
			id: `node_${String(index).padStart(6, '0')}`,
			type: 'Heading',
			componentVersion: 1,
			props: {},
		}));
		assert.throws(() => validatePageDocument({ ...document, nodes: repeated }), /no more than 200/i);
	});
});

describe('Builder node operations', () => {
	it('adds nested layout, text, image, and action nodes and records parent locations', () => {
		let document = addNode(page(), 'Container', { id: 'node_container01' });
		document = addNode(document, 'Heading', { parentId: 'node_container01', id: 'node_heading01' });
		document = addNode(document, 'Text', { parentId: 'node_container01', id: 'node_text00001' });
		document = addNode(document, 'Image', { parentId: 'node_container01', id: 'node_image0001' });
		document = addNode(document, 'Button', { parentId: 'node_container01', id: 'node_button001' });
		assert.equal(findNode(document.nodes, 'node_heading01')?.type, 'Heading');
		assert.equal(findNode(document.nodes, 'node_text00001')?.type, 'Text');
		assert.equal(findNode(document.nodes, 'node_image0001')?.type, 'Image');
		assert.equal(findNode(document.nodes, 'node_button001')?.type, 'Button');
		assert.deepEqual(findNodeLocation(document.nodes, 'node_heading01'), { parentId: 'node_container01', index: 0 });
		assert.equal(document.nodes[0].type === 'Container' && document.nodes[0].props.layout === 'grid', false);
		const grid = updateNodeProps(document, 'node_container01', { layout: 'grid' });
		assert.equal(grid.nodes[0].type === 'Container' && grid.nodes[0].props.layout === 'grid', true);
	});

	it('updates typed props and controlled responsive styles', () => {
		let document = withHeading(page());
		document = updateNodeProps(document, 'node_heading01', { text: 'تیتر ویرایش‌شده' });
		document = updateNodeStyles(document, 'node_heading01', { width: 'wide', marginBlockStart: 24 }, 'tablet');
		document = setNodeHiddenAtBreakpoint(document, 'node_heading01', 'mobile', true);
		const heading = findNode(document.nodes, 'node_heading01');
		assert.equal(heading?.type, 'Heading');
		assert.equal(heading?.responsiveStyles?.tablet?.width, 'wide');
		assert.equal(hiddenAtBreakpoint(heading!, 'mobile'), true);
		assert.throws(() => updateNodeProps(document, 'node_heading01', { text: 55 }), /text value/i);
	});

	it('moves nodes between sibling positions and into containers', () => {
		let document = withHeading(page(), 'node_heading01');
		document = addNode(document, 'Button', { id: 'node_button001' });
		document = addNode(document, 'Container', { id: 'node_container01' });
		document = moveNode(document, 'node_heading01', 'node_container01', 'inside');
		assert.deepEqual(findNodeLocation(document.nodes, 'node_heading01'), { parentId: 'node_container01', index: 0 });
		document = moveNodeBy(document, 'node_button001', -1);
		assert.equal(document.nodes[0].id, 'node_button001');
	});

	it('duplicates a nested subtree with fresh IDs and deletes a whole node subtree', () => {
		let document = addNode(page(), 'Container', { id: 'node_container01' });
		document = addNode(document, 'Heading', { parentId: 'node_container01', id: 'node_heading01' });
		const result = duplicateNode(document, 'node_container01', (() => {
			let index = 0;
			return () => `node_clone000${++index}`;
		})());
		assert.notEqual(result.newId, 'node_container01');
		assert.equal(result.document.nodes.length, 2);
		assert.equal(result.document.nodes[1].type, 'Container');
		if (result.document.nodes[1].type === 'Container') assert.notEqual(result.document.nodes[1].children[0].id, 'node_heading01');
		const deleted = deleteNode(result.document, 'node_container01');
		assert.equal(deleted.nodes.length, 1);
	});

	it('rejects moving a container into a descendant and leaves the document untouched', () => {
		let document = addNode(page(), 'Container', { id: 'node_container01' });
		document = addNode(document, 'Container', { parentId: 'node_container01', id: 'node_container02' });
		assert.throws(() => moveNode(document, 'node_container01', 'node_container02', 'inside'), /descendants/i);
		assert.equal(document.nodes[0].id, 'node_container01');
	});
});

describe('Builder undo/redo and autosave', () => {
	it('undoes, redoes, and drops the redo branch after a new edit', () => {
		const initial = page();
		const withContainer = addNode(initial, 'Container', { id: 'node_container01' });
		const withHeading = addNode(withContainer, 'Heading', { id: 'node_heading01' });
		let state = createDocumentHistory(initial);
		state = commitDocument(state, withContainer);
		state = commitDocument(state, withHeading);
		state = undoDocument(state);
		assert.equal(state.present.nodes.length, 1);
		state = redoDocument(state);
		assert.equal(state.present.nodes.length, 2);
		state = undoDocument(state);
		state = commitDocument(state, updateNodeProps(state.present, 'node_container01', { gap: 24 }));
		assert.equal(state.future.length, 0);
	});

	it('coalesces scheduled edits and keeps the latest snapshot', async () => {
		const saved: PageDocument[] = [];
		const statuses: AutosaveStatus[] = [];
		const autosave = new AutosaveController(async (document) => { saved.push(document); }, (status) => statuses.push(status), 60_000);
		const initial = page();
		autosave.initialize(initial);
		const first = withHeading(initial, 'node_heading01');
		const latest = updateNodeProps(first, 'node_heading01', { text: 'آخرین تغییر' });
		autosave.schedule(first);
		autosave.schedule(latest);
		await autosave.flush();
		assert.equal(saved.length, 1);
		assert.equal(saved[0].nodes[0].type === 'Heading' ? saved[0].nodes[0].props.text : '', 'آخرین تغییر');
		assert.equal(statuses.at(-1), 'saved');
		autosave.cancel();
	});

	it('retains local edits and exposes recovery after a failed save', async () => {
		let attempts = 0;
		const statuses: AutosaveStatus[] = [];
		const autosave = new AutosaveController(async () => {
			attempts += 1;
			if (attempts === 1) throw new Error('offline');
		}, (status) => statuses.push(status), 60_000);
		const initial = page();
		const next = withHeading(initial);
		autosave.initialize(initial);
		autosave.schedule(next);
		await assert.rejects(autosave.flush(), /offline/);
		assert.equal(autosave.isDirty(), true);
		assert.equal(statuses.at(-1), 'error');
		await autosave.retry();
		assert.equal(autosave.isDirty(), false);
		assert.equal(statuses.at(-1), 'saved');
		autosave.cancel();
	});

	it('automatically retries a transient save failure after a newer edit', async () => {
		let attempts = 0;
		let savedText = '';
		const statuses: AutosaveStatus[] = [];
		const autosave = new AutosaveController(async (document) => {
			attempts += 1;
			if (attempts === 1) throw new Error('temporary outage');
			savedText = document.nodes[0]?.type === 'Heading' ? document.nodes[0].props.text : '';
		}, (status) => statuses.push(status), 60_000);
		const initial = page();
		const first = withHeading(initial);
		autosave.initialize(initial);
		autosave.schedule(first);
		await assert.rejects(autosave.flush(), /temporary outage/);
		const latest = updateNodeProps(first, 'node_heading01', { text: 'recovered' });
		autosave.schedule(latest);
		await autosave.flush();
		assert.equal(attempts, 2);
		assert.equal(savedText, 'recovered');
		assert.equal(statuses.at(-1), 'saved');
		autosave.cancel();
	});

	it('blocks retry on an optimistic concurrency conflict', async () => {
		const autosave = new AutosaveController(async () => { throw new AutosaveConflictError('newer revision'); }, () => undefined, 60_000);
		const initial = page();
		autosave.initialize(initial);
		autosave.schedule(withHeading(initial));
		await assert.rejects(autosave.flush(), AutosaveConflictError);
		await assert.rejects(autosave.retry(), AutosaveConflictError);
		autosave.cancel();
	});
});
