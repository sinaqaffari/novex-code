import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmptyPageDocument, exportPageDocument, importPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { executeDocumentCommand } from '../src/lib/builder/commands.ts';
import { validateDocumentWithDiagnostics } from '../src/lib/builder/diagnostics.ts';
import { addNode, updateNodeProps, updateNodeStyles } from '../src/lib/builder/operations.ts';
import { buildResponsiveCss } from '../src/lib/builder/render.ts';
import { breakpointWidths } from '../src/lib/builder/responsive.ts';
import { applyTemplate } from '../src/lib/builder/templates.ts';

describe('schema v3 custom breakpoint widths', () => {
	it('migrates v2 without changing its default cascade or mutating the stored object', () => {
		const original = { ...createEmptyPageDocument('legacy-two'), schemaVersion: 2 };
		const migrated = validatePageDocument(original);
		assert.equal(migrated.schemaVersion, 5);
		assert.equal(original.schemaVersion, 2);
		assert.deepEqual(breakpointWidths(migrated), { tablet: 1023, mobile: 767 });
		assert.equal(migrated.breakpoints, undefined);
		assert.throws(() => validatePageDocument({ ...original, breakpoints: { tablet: 900, mobile: 500 } }), /Unsupported property/);
	});
	it('validates finite integer widths, order, allowed keys and reports a typed error', () => {
		const doc = createEmptyPageDocument('bad-widths');
		for (const widths of [
			{ tablet: 900, mobile: 901 }, { tablet: 900, mobile: 900 }, { tablet: 639, mobile: 320 },
			{ tablet: 1921, mobile: 320 }, { tablet: 900, mobile: 319 }, { tablet: 900, mobile: 500.5 },
			{ tablet: 900, mobile: NaN }, { tablet: Infinity, mobile: 500 }, { tablet: 900, mobile: '500' },
			{ tablet: 900, mobile: 500, extra: 1 }, null, [],
		]) {
			const result = executeDocumentCommand(doc, { type: 'metadata', patch: { breakpoints: widths as never } });
			assert.equal(result.ok, false);
			if (!result.ok) { assert.equal(result.error.code, 'invalid_document'); assert.equal(result.error.path, 'breakpoints'); }
			const diagnostic = validateDocumentWithDiagnostics({ ...doc, breakpoints: widths });
			assert.equal(diagnostic.ok, false);
			if (!diagnostic.ok) assert.equal(diagnostic.diagnostics[0].code, 'invalid_breakpoints');
			assert.equal(doc.breakpoints, undefined);
		}
	});
	it('round-trips, compiles the specified boundaries including intrinsic rows, and can reset', () => {
		let doc = addNode(createEmptyPageDocument('custom-widths'), 'Container', { id: 'node_container1' });
		doc = updateNodeProps(doc, 'node_container1', { layout: 'row' });
		doc = updateNodeStyles(doc, 'node_container1', { width: '50%' }, 'tablet');
		doc = updateNodeStyles(doc, 'node_container1', { width: '30%' }, 'mobile');
		const result = executeDocumentCommand(doc, { type: 'metadata', patch: { breakpoints: { tablet: 900, mobile: 500 } } });
		assert.equal(result.ok, true);
		if (!result.ok) throw new Error('command failed');
		doc = importPageDocument(exportPageDocument(result.document));
		assert.deepEqual(doc.breakpoints, { tablet: 900, mobile: 500 });
		const css = buildResponsiveCss(doc);
		assert.match(css, /@media \(max-width:900px\).*width:50%!important/);
		assert.match(css, /@media \(max-width:500px\).*width:30%!important/);
		assert.match(css, /@media \(max-width:500px\).*data-layout='row'.*flex-direction:column/);
		assert.doesNotMatch(css, /max-width:767px|max-width:1023px/);
		const reset = executeDocumentCommand(doc, { type: 'metadata', patch: { breakpoints: undefined } });
		assert.equal(reset.ok, true);
		if (reset.ok) assert.deepEqual(breakpointWidths(reset.document), { tablet: 1023, mobile: 767 });
	});
	it('carries explicit template thresholds and preserves target thresholds for an unconfigured template', () => {
		const source = validatePageDocument({ ...createEmptyPageDocument('source'), breakpoints: { tablet: 900, mobile: 500 } });
		const target = validatePageDocument({ ...createEmptyPageDocument('target'), breakpoints: { tablet: 1100, mobile: 700 } });
		assert.deepEqual(applyTemplate(source, target).breakpoints, source.breakpoints);
		assert.deepEqual(applyTemplate(createEmptyPageDocument('unconfigured'), target).breakpoints, target.breakpoints);
	});
});
