import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { convertElementorJson } from '../src/lib/migrations/elementor/converter.ts';
import { createEmptyPageDocument, exportPageDocument, importPageDocument } from '../src/lib/builder/document.ts';
import { buildResponsiveCss } from '../src/lib/builder/render.ts';

const fixture = readFileSync(new URL('./fixtures/elementor-basic.json', import.meta.url), 'utf8');
const page = () => createEmptyPageDocument('import-test', 'عنوان اصلی');

describe('Elementor local import', () => {
	it('converts nested supported widgets to a valid editable document and reports loss', () => {
		const target = page();
		const before = JSON.stringify(target);
		const result = convertElementorJson(fixture, target);
		assert.equal(JSON.stringify(target), before);
		assert.equal(result.document.title, target.title);
		assert.equal(result.converted, 7);
		assert.deepEqual({ ...result.supportedWidgets }, { heading: 1, 'text-editor': 1, button: 1, image: 1 });
		assert.deepEqual({ ...result.unsupportedWidgets }, { form: 1 });
		assert.equal(result.missingAssets, 1);
		const section = result.document.nodes[0];
		assert.equal(section.type, 'Container');
		if (section.type !== 'Container') throw new Error('section');
		const column = section.children[0];
		assert.equal(column.type, 'Container');
		if (column.type !== 'Container') throw new Error('column');
		const [heading, text, button, image, unsupported] = column.children;
		assert.equal(heading.type, 'Heading');
		if (heading.type !== 'Heading') throw new Error('heading');
		assert.equal(heading.props.text, 'سلام Novex');
		assert.equal(heading.styles?.marginBlockStart, 16);
		assert.equal(heading.responsiveStyles?.mobile?.marginBlockStart, 4);
		assert.match(buildResponsiveCss(result.document), /@media \(max-width:767px\).*margin-block-start:4px/);
		assert.equal(text.type, 'Text');
		if (text.type !== 'Text') throw new Error('text');
		assert.equal(text.props.text, 'متن فارسی');
		assert.equal(button.type === 'Button' && button.props.href, '/contact');
		assert.equal(image.type === 'Image' && image.props.src, '');
		assert.equal(unsupported.type, 'Text');
		assert.ok(['asset', 'unsupported-widget', 'rich-text', 'unsupported-settings', 'breakpoints'].every((code) => result.warnings.some((warning) => warning.code === code)));
		assert.deepEqual(importPageDocument(exportPageDocument(result.document), 'import-test'), result.document);
	});
	it('rejects malformed, oversized and excessively nested data', () => {
		assert.throws(() => convertElementorJson('{', page()), /JSON/);
		assert.throws(() => convertElementorJson('{"content":[]}', page()), /Elementor/);
		assert.throws(() => convertElementorJson(' '.repeat(1024 * 1024 + 1), page()), /مگابایت/);
		let node: unknown = { id: 'inner', elType: 'widget', widgetType: 'heading', settings: {}, elements: [] };
		for (let i = 0; i < 8; i++) node = { id: `c${i}`, elType: 'container', settings: {}, elements: [node] };
		assert.throws(() => convertElementorJson(JSON.stringify({ version: '0.4', content: [node] }), page()), /عمق/);
	});
	it('does not retain unsafe links, active markup, remote assets, or unsupported spacing', () => {
		const input = JSON.parse(fixture);
		const widgets = input.content[0].elements[0].elements;
		widgets[2].settings.link.url = 'javascript:alert(1)';
		widgets[0].settings._margin_mobile = { unit: '%', top: '10' };
		const result = convertElementorJson(JSON.stringify(input), page());
		assert.ok(result.warnings.some((w) => w.code === 'unsafe-link'));
		assert.ok(result.warnings.some((w) => w.code === 'spacing'));
		assert.doesNotMatch(JSON.stringify(result.document), /javascript:|example\.com|<script>/);
	});
	it('rejects excessive node count before conversion can exhaust resources', () => {
		const node = { id: 'x', elType: 'widget', widgetType: 'heading', settings: {}, elements: [] };
		assert.throws(() => convertElementorJson(JSON.stringify({ version: '0.4', content: Array(201).fill(node) }), page()), /۲۰۰/);
	});
});

describe('Elementor draft persistence', () => {
	it('persists an imported draft without publishing and supports undo before saving', async () => {
		const { mkdtemp, rm } = await import('node:fs/promises');
		const os = await import('node:os');
		const path = await import('node:path');
		const { saveDraftPage, getDraftPage, getPublishedPage } = await import('../src/lib/builder/store.ts');
		const { createDocumentHistory, commitDocument, undoDocument, redoDocument } = await import('../src/lib/builder/history.ts');
		const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-import-'));
		const prior = process.env.BUILDER_DATA_FILE;
		process.env.BUILDER_DATA_FILE = path.join(dir, 'pages.json');
		try {
			const original = page();
			const imported = convertElementorJson(fixture, original).document;
			const history = commitDocument(createDocumentHistory(original), imported);
			assert.deepEqual(undoDocument(history).present, original);
			assert.deepEqual(redoDocument(undoDocument(history)).present, imported);
			await saveDraftPage({ slug: original.slug, expectedRevision: 0, document: imported });
			assert.deepEqual((await getDraftPage(original.slug)).draft, imported);
			assert.equal(await getPublishedPage(original.slug), null);
		} finally {
			if (prior === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = prior;
			await rm(dir, { recursive: true, force: true });
		}
	});
	it('accepts Elementor empty-array settings but rejects nonempty array settings', () => {
		const widget = { id: 'test', elType: 'widget', widgetType: 'heading', settings: [], elements: [] };
		assert.equal(convertElementorJson(JSON.stringify({ version: '0.4', content: [widget] }), page()).converted, 1);
		assert.throws(() => convertElementorJson(JSON.stringify({ version: '0.4', content: [{ ...widget, settings: [1] }] }), page()));
	});
});

describe('Elementor image box conversion', () => {
	it('preserves editable title and description while reporting the unresolved asset', () => {
		const input = { version: '0.4', content: [{ id: 'box1', elType: 'widget', widgetType: 'image-box', settings: { image: { url: 'https://example.com/a.png', id: 12 }, title_text: 'خدمات', description_text: 'توضیح <b>فارسی</b>', link: { url: 'https://example.com' } }, elements: [] }] };
		const result = convertElementorJson(JSON.stringify(input), page());
		assert.equal(result.supportedWidgets['image-box'], 1);
		assert.equal(result.missingAssets, 1);
		const node = result.document.nodes[0];
		assert.equal(node.type, 'Container');
		if (node.type !== 'Container') throw new Error('container');
		assert.equal(node.children[0].type === 'Image' && node.children[0].props.src, '');
		assert.equal(node.children[1].type === 'Heading' && node.children[1].props.text, 'خدمات');
		assert.equal(node.children[2].type === 'Text' && node.children[2].props.text, 'توضیح فارسی');
		assert.ok(result.warnings.some((warning) => warning.code === 'unsupported-settings'));
		assert.doesNotMatch(JSON.stringify(result.document), /example\.com/);
	});
});

describe('Elementor icon list conversion', () => {
	it('preserves list text and safe links as editable native nodes, warning about lost semantics and unsafe URLs', () => {
		const input = { version: '0.4', content: [{ id: 'list01', elType: 'widget', widgetType: 'icon-list', settings: { icon_list: [
			{ text: '<b>فارسی</b>', link: { url: '/about' }, selected_icon: { value: 'icon' } },
			{ text: 'بدون پیوند', link: { url: 'javascript:alert(1)' } },
			{ text: 'مورد ساده', link: { url: '' } },
		] }, elements: [] }] };
		const result = convertElementorJson(JSON.stringify(input), page());
		const list = result.document.nodes[0];
		assert.equal(list.type, 'Container');
		if (list.type !== 'Container') throw new Error('expected container');
		assert.equal(list.children[0].type === 'Button' && list.children[0].props.href, '/about');
		assert.equal(list.children[0].type === 'Button' && list.children[0].props.label, 'فارسی');
		assert.equal(list.children[1].type === 'Text' && list.children[1].props.text, 'بدون پیوند');
		assert.equal(list.children[2].type === 'Text' && list.children[2].props.text, 'مورد ساده');
		assert.ok(result.warnings.some((warning) => warning.code === 'list-layout'));
		assert.ok(result.warnings.some((warning) => warning.code === 'list-link'));
		assert.doesNotMatch(JSON.stringify(result.document), /javascript:/);
		assert.deepEqual(importPageDocument(exportPageDocument(result.document), 'import-test'), result.document);
	});
	it('enforces expansion and item limits rather than silently dropping content', () => {
		const list = { id: 'list', elType: 'widget', widgetType: 'icon-list', settings: { icon_list: Array(51).fill({ text: 'x' }) }, elements: [] };
		assert.throws(() => convertElementorJson(JSON.stringify({ version: '0.4', content: [list] }), page()), /۵۰/);
		list.settings.icon_list = Array(50).fill({ text: 'x' });
		assert.throws(() => convertElementorJson(JSON.stringify({ version: '0.4', content: Array(4).fill(list) }), page()), /200/);
	});
});
