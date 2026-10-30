import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmptyPageDocument, exportPageDocument, importPageDocument } from '../src/lib/builder/document.ts';
import { normalizeLayoutLength } from '../src/lib/builder/layout.ts';
import { COMPONENT_REGISTRY, normalizeProps } from '../src/lib/builder/registry.ts';
import { addNode, findNode, setNodeHiddenAtBreakpoint, updateNodeStyles } from '../src/lib/builder/operations.ts';
import { explicitNodeStyle, resolveNodeStyles } from '../src/lib/builder/responsive.ts';
import { buildResponsiveCss, controlledNodeStyle, nodeStyleObject } from '../src/lib/builder/render.ts';

describe('validated layout and responsive rendering', () => {
	it('accepts bounded CSS lengths without accepting arbitrary declarations', () => {
		for (const value of ['12px', '50%', '1.5rem', '2em', '30vw', '50vh', 'auto', 'fit-content', '0']) assert.equal(normalizeLayoutLength(value, 'width'), value);
		for (const value of ['-1px', '999999px', 'calc(1px + 2px)', 'url(x)', '1px;color:red', '1', 'var(--bad)']) assert.throws(() => normalizeLayoutLength(value, 'width'));
		assert.throws(() => controlledNodeStyle({ width: '1px;display:none' }), /unsupported CSS length/);
	});
	it('shares layout style declarations with editor objects and responsive CSS', () => {
		let doc = addNode(createEmptyPageDocument('layout-test'), 'Container', { id: 'node_container1' });
		doc = updateNodeStyles(doc, 'node_container1', { width: '50%', height: '20rem', layout: 'flex', direction: 'row', gap: 24, alignItems: 'center' });
		doc = updateNodeStyles(doc, 'node_container1', { layout: 'grid', columns: 2, gap: 8 }, 'tablet');
		doc = updateNodeStyles(doc, 'node_container1', { columns: 1 }, 'mobile');
		const node = findNode(doc.nodes, 'node_container1')!;
		assert.deepEqual(nodeStyleObject(resolveNodeStyles(node, 'mobile')), {
			width: '50%', height: '20rem', display: 'grid', flexDirection: 'row', gridTemplateColumns: 'repeat(1,minmax(0,1fr))', gap: '8px', alignItems: 'center',
		});
		assert.equal(explicitNodeStyle(node, 'mobile', 'gap'), undefined);
		const css = buildResponsiveCss(doc);
		assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
		assert.match(css, /gap:8px!important/);
		assert.match(css, /grid-template-columns:repeat\(1,minmax\(0,1fr\)\)!important/);
		doc = updateNodeStyles(doc, node.id, { columns: undefined }, 'mobile');
		assert.equal(explicitNodeStyle(findNode(doc.nodes, node.id)!, 'mobile', 'columns'), undefined);
		assert.equal(resolveNodeStyles(findNode(doc.nodes, node.id)!, 'mobile').columns, 2);
		assert.equal(findNode(doc.nodes, node.id)!.responsiveStyles?.mobile, undefined);
		assert.deepEqual(importPageDocument(exportPageDocument(doc)), doc);
	});
	it('does not let an explicit responsive display override hidden and restores flex for visible buttons', () => {
		let doc = addNode(createEmptyPageDocument('visibility'), 'Container', { id: 'node_container1' });
		doc = updateNodeStyles(doc, 'node_container1', { layout: 'grid' }, 'mobile');
		doc = setNodeHiddenAtBreakpoint(doc, 'node_container1', 'mobile', true);
		const css = buildResponsiveCss(doc);
		assert.match(css, /display:none!important/);
		assert.doesNotMatch(css, /display:grid!important/);
		doc = addNode(doc, 'Button', { id: 'node_button001' });
		doc = setNodeHiddenAtBreakpoint(doc, 'node_button001', 'desktop', true);
		assert.match(buildResponsiveCss(doc), /node_button001"\]\{display:flex!important/);
	});
});

describe('native spacer and divider', () => {
	it('has registered defaults, validation and inspector controls', () => {
		for (const type of ['Spacer', 'Divider'] as const) {
			assert.deepEqual(normalizeProps(type, undefined), COMPONENT_REGISTRY[type].defaultProps);
			assert.ok(COMPONENT_REGISTRY[type].fields.length > 0);
		}
		assert.throws(() => normalizeProps('Spacer', { size: 2000 }));
		assert.throws(() => normalizeProps('Divider', { lineStyle: 'url(evil)' }));
		let doc = addNode(createEmptyPageDocument('primitives'), 'Spacer', { id: 'node_spacer001' });
		doc = addNode(doc, 'Divider', { id: 'node_divider01' });
		assert.deepEqual(importPageDocument(exportPageDocument(doc)).nodes.map((node) => node.type), ['Spacer', 'Divider']);
	});
});

it('renders and edits legacy desktop overrides without losing unrelated values', () => {
	const initial = addNode(createEmptyPageDocument('legacy-layout'), 'Container', { id: 'node_container1' });
	const legacy = importPageDocument(JSON.stringify({ ...initial, schemaVersion: 1, nodes: [{ ...initial.nodes[0], styles: { width: 'full' }, responsiveStyles: { desktop: { width: '40%', height: '20px' }, mobile: { width: '70%' } } }] }));
	let node = legacy.nodes[0];
	assert.equal(explicitNodeStyle(node, 'desktop', 'width'), '40%');
	assert.equal(resolveNodeStyles(node, 'desktop').width, '40%');
	assert.equal(resolveNodeStyles(node, 'tablet').height, '20px');
	assert.equal(resolveNodeStyles(node, 'mobile').width, '70%');
	assert.match(controlledNodeStyle(resolveNodeStyles(node, 'desktop'))!, /width:40%/);
	const edited = updateNodeStyles(legacy, node.id, { width: '50%' }, 'desktop');
	node = edited.nodes[0];
	assert.equal(resolveNodeStyles(node, 'desktop').width, '50%');
	assert.equal(node.responsiveStyles?.desktop?.width, undefined);
	assert.equal(node.responsiveStyles?.desktop?.height, '20px');
	assert.equal(resolveNodeStyles(node, 'mobile').width, '70%');
});
