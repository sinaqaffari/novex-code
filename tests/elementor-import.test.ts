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
		assert.ok(result.warnings.some((warning) => warning.code === 'image-box-image-link'));
		assert.equal(node.children[1].type === 'Heading' && node.children[1].props.marks?.find((mark) => mark.kind === 'link')?.href, 'https://example.com');
		assert.doesNotMatch(JSON.stringify(result.document), /example\.com\/a\.png/);
	});
});

describe('Elementor icon list conversion', () => {
	it('preserves list semantics, text and safe links as editable native nodes', () => {
		const input = { version: '0.4', content: [{ id: 'list01', elType: 'widget', widgetType: 'icon-list', settings: { icon_list: [
			{ text: '<b>فارسی</b>', link: { url: '/about' }, selected_icon: { value: 'icon' } },
			{ text: 'بدون پیوند', link: { url: 'javascript:alert(1)' } },
			{ text: 'مورد ساده', link: { url: '' } },
		] }, elements: [] }] };
		const result = convertElementorJson(JSON.stringify(input), page());
		const list = result.document.nodes[0];
		assert.equal(list.type, 'List');
		if (list.type !== 'List') throw new Error('expected list');
		assert.deepEqual(list.props.items.map(({ text, href }) => ({ text, href })), [{ text: 'فارسی', href: '/about' }, { text: 'بدون پیوند', href: '' }, { text: 'مورد ساده', href: '' }]);
		assert.ok(result.warnings.some((warning) => warning.code === 'list-layout'));
		assert.ok(result.warnings.some((warning) => warning.code === 'list-link'));
		assert.doesNotMatch(JSON.stringify(result.document), /javascript:/);
		assert.deepEqual(importPageDocument(exportPageDocument(result.document), 'import-test'), result.document);
	});
	it('enforces expansion and item limits rather than silently dropping content', () => {
		const list = { id: 'list', elType: 'widget', widgetType: 'icon-list', settings: { icon_list: Array(51).fill({ text: 'x' }) }, elements: [] };
		assert.throws(() => convertElementorJson(JSON.stringify({ version: '0.4', content: [list] }), page()), /۵۰/);
		list.settings.icon_list = Array(50).fill({ text: 'x' });
		const converted = convertElementorJson(JSON.stringify({ version: '0.4', content: [list] }), page());
		const group = converted.document.nodes[0];
		assert.equal(group.type, 'Container'); if (group.type !== 'Container') throw new Error('list group');
		assert.deepEqual(group.children.map((child) => child.type === 'List' ? child.props.items.length : -1), [24, 24, 2]);
		assert.throws(() => convertElementorJson(JSON.stringify({ version: '0.4', content: Array(100).fill(list) }), page()), /200/);
	});
});

describe('Elementor accordion and toggle conversion', () => {
	it('preserves interactive accordion, toggle and tabs items without executing markup', () => {
		const widgets = ['accordion', 'toggle', 'tabs'].map((widgetType) => ({ id: widgetType, elType: 'widget', widgetType, settings: { tabs: [
			{ tab_title: 'پرسش <b>یک</b>', tab_content: '<p>پاسخ</p><script>alert(1)</script>' },
			{ tab_title: 'دوم', tab_content: '<a href="javascript:alert(1)">متن پیوند</a>' },
		] }, elements: [] }));
		const result = convertElementorJson(JSON.stringify({ version: '0.4', content: widgets }), page());
		assert.equal(result.supportedWidgets.accordion, 1);
		assert.equal(result.supportedWidgets.toggle, 1);
		assert.equal(result.supportedWidgets.tabs, 1);
		for (const node of result.document.nodes.slice(0, 2)) {
			assert.equal(node.type, 'Accordion');
			if (node.type !== 'Accordion') throw new Error('accordion');
			assert.deepEqual(node.props.items.map(({ title, body }) => ({ title, body })), [
				{ title: 'پرسش یک', body: 'پاسخ' }, { title: 'دوم', body: 'متن پیوند' },
			]);
		}
		const tabs = result.document.nodes[2];
		assert.equal(tabs.type, 'Tabs');
		if (tabs.type !== 'Tabs') throw new Error('tabs');
		assert.deepEqual(tabs.props.items.map(({ title, body }) => ({ title, body })), [{ title: 'پرسش یک', body: 'پاسخ' }, { title: 'دوم', body: 'متن پیوند' }]);
		assert.equal(result.warnings.filter((w) => w.code === 'accordion-layout').length, 2);
		assert.ok(result.warnings.some((w) => w.code === 'tabs-content'));
		assert.doesNotMatch(JSON.stringify(result.document), /javascript:|<script>|alert\(1\)/);
		assert.deepEqual(importPageDocument(exportPageDocument(result.document), 'import-test'), result.document);
	});
	it('rejects malformed or oversized lists and expanded documents exceeding the node limit', () => {
		const widget = { id: 'a', elType: 'widget', widgetType: 'accordion', settings: { tabs: [] as unknown[] }, elements: [] };
		const convert = () => convertElementorJson(JSON.stringify({ version: '0.4', content: [widget] }), page());
		widget.settings.tabs = [null];
		assert.throws(convert, /آکاردئون/);
		widget.settings.tabs = Array(51).fill({ tab_title: 'x' });
		assert.throws(convert, /۵۰/);
		widget.settings.tabs = Array.from({ length: 50 }, (_, index) => ({ tab_title: `x${index}`, tab_content: `answer${index}` }));
		const expanded = convert();
		const group = expanded.document.nodes[0];
		assert.equal(group.type, 'Container');
		if (group.type !== 'Container') throw new Error('group');
		assert.deepEqual(group.children.map((node) => node.type === 'Accordion' ? node.props.items.length : -1), [24, 24, 2]);
		assert.equal(group.children[2].type === 'Accordion' && group.children[2].props.items[1].title, 'x49');
		assert.ok(expanded.warnings.some((warning) => warning.code === 'accordion-split'));
		// Large tab sets split into native groups without dropping any item.
		const tabs = { ...widget, widgetType: 'tabs' };
		const convertedTabs = convertElementorJson(JSON.stringify({ version: '0.4', content: [tabs, tabs] }), page());
		for (const root of convertedTabs.document.nodes) {
			assert.equal(root.type, 'Container');
			if (root.type !== 'Container') throw new Error('tab group');
			assert.deepEqual(root.children.map((child) => child.type === 'Tabs' ? child.props.items.length : -1), [24, 24, 2]);
		}
		assert.ok(convertedTabs.warnings.some((warning) => warning.code === 'tabs-split'));
	});
});

describe('Elementor layout, media and content conversions', () => {
	it('converts divider and responsive spacer into real native nodes', () => {
		const widgets = [
			{ id: 'space', elType: 'widget', widgetType: 'spacer', settings: { space: { unit: 'px', size: 60 }, space_tablet: { unit: 'px', size: 48 }, space_mobile: { unit: 'px', size: 16 } }, elements: [] },
			{ id: 'line', elType: 'widget', widgetType: 'divider', settings: { style: 'dashed', weight: { unit: 'px', size: 2 } }, elements: [] },
		];
		const result = convertElementorJson(JSON.stringify({ version: '0.4', content: widgets }), page());
		const [spacer, divider] = result.document.nodes;
		assert.equal(spacer.type, 'Spacer');
		if (spacer.type === 'Spacer') assert.equal(spacer.props.size, 60);
		assert.equal(spacer.responsiveStyles?.mobile?.height, '16px');
		assert.equal(divider.type, 'Divider');
		if (divider.type === 'Divider') assert.deepEqual(divider.props, { thickness: 2, lineStyle: 'dashed', color: 'muted' });
		assert.match(buildResponsiveCss(result.document), /height:16px!important/);
	});
	it('creates native gallery placeholders and quotes, and safe fallback video links without fetching assets', () => {
		const widgets = [
			{ id: 'gallery', elType: 'widget', widgetType: 'basic-gallery', settings: { wp_gallery: [{ url: 'http://127.0.0.1/secret', alt: 'یک' }, { url: 'https://example.com/a.png' }] }, elements: [] },
			{ id: 'testimony', elType: 'widget', widgetType: 'testimonial', settings: { testimonial_content: '<script>evil()</script>نظر خوب', testimonial_name: 'مشتری' }, elements: [] },
			{ id: 'video', elType: 'widget', widgetType: 'video', settings: { youtube_url: 'javascript:alert(1)' }, elements: [] },
		];
		const result = convertElementorJson(JSON.stringify({ version: '0.4', content: widgets }), page());
		assert.equal(result.missingAssets, 2);
		assert.equal(result.supportedWidgets['basic-gallery'], 1);
		assert.equal(result.supportedWidgets.testimonial, 1);
		assert.equal(result.supportedWidgets.video, 1);
		const gallery = result.document.nodes[0];
		assert.equal(gallery.type, 'ImageGallery');
		if (gallery.type === 'ImageGallery') {
			assert.deepEqual(gallery.props.items.map(({ src, alt }) => ({ src, alt })), [{ src: '', alt: 'یک' }, { src: '', alt: '' }]);
		}
		const quote = result.document.nodes[1];
		assert.equal(quote.type, 'Blockquote');
		if (quote.type === 'Blockquote') assert.deepEqual(quote.props, { text: 'نظر خوب', author: 'مشتری', role: '' });
		assert.ok(result.warnings.some((warning) => warning.code === 'video-link'));
		assert.ok(result.warnings.some((warning) => warning.code === 'unsafe-link'));
		assert.doesNotMatch(JSON.stringify(result.document), /127\.0\.0\.1|example\.com|javascript:|evil\(\)/);
	});
});

it('reports truncation and additional data dropped by approximate conversions', () => {
	const widgets = [
		{ id: 'g', elType: 'widget', widgetType: 'basic-gallery', settings: { wp_gallery: [{ alt: 'a'.repeat(241) }] }, elements: [] },
		{ id: 'v', elType: 'widget', widgetType: 'video', settings: { youtube_url: 'https://example.com/1', vimeo_url: 'https://example.com/2' }, elements: [] },
		{ id: 'p', elType: 'widget', widgetType: 'price-table', settings: { features_list: [{ item_text: 'Feature', item_icon: 'star' }], link: { url: '/offer' } }, elements: [] },
	];
	const result = convertElementorJson(JSON.stringify({ version: '0.4', content: widgets }), page());
	for (const code of ['truncated', 'additional-video-links', 'price-feature-options', 'price-link']) assert.ok(result.warnings.some((warning) => warning.code === code), code);
});


describe('native Elementor gallery and fixed-host video conversion', () => {
	it('preserves all gallery item alt text and captions across collection limits, without importing URLs', () => {
		const images = Array.from({ length: 50 }, (_, index) => ({ url: 'https://example.com/private.png', alt: `عکس ${index}`, caption: `زیرنویس ${index}` }));
		const widget = { id: 'gallery', elType: 'widget', widgetType: 'basic-gallery', settings: { wp_gallery: images, columns: '4' }, elements: [] };
		const result = convertElementorJson(JSON.stringify({ version: '0.4', content: [widget] }), page());
		assert.equal(result.missingAssets, 50);
		const group = result.document.nodes[0];
		assert.equal(group.type, 'Container');
		if (group.type !== 'Container') throw new Error('group');
		assert.deepEqual(group.children.map((node) => node.type === 'ImageGallery' ? node.props.items.length : -1), [24, 24, 2]);
		const last = group.children[2];
		assert.equal(last.type, 'ImageGallery');
		if (last.type === 'ImageGallery') {
			assert.equal(last.props.columns, 4);
			assert.deepEqual(last.props.items[1], { id: 'item_0049', src: '', alt: 'عکس 49', caption: 'زیرنویس 49' });
		}
		assert.ok(result.warnings.some((warning) => warning.code === 'gallery-split'));
		assert.ok(result.warnings.some((warning) => warning.code === 'gallery-assets'));
		assert.doesNotMatch(JSON.stringify(result.document), /example\.com/);
		assert.deepEqual(importPageDocument(exportPageDocument(result.document), 'import-test'), result.document);
	});
	it('extracts fixed-host YouTube and Vimeo IDs without trusting source hosts or copying playback options', () => {
		const video = (id: string, url: string) => ({ id, elType: 'widget', widgetType: 'video', settings: { video_url: url }, elements: [] });
		const widgets = [
			video('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=60'),
			video('short', 'https://youtu.be/dQw4w9WgXcQ'),
			video('vimeo', 'https://vimeo.com/123456789'),
			video('spoof', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'),
			video('unsafe', 'javascript:alert(1)'),
		];
		const result = convertElementorJson(JSON.stringify({ version: '0.4', content: widgets }), page());
		const [youtube, short, vimeo, spoof, unsafe] = result.document.nodes;
		assert.equal(youtube.type === 'VideoEmbed' && youtube.props.youtubeId, 'dQw4w9WgXcQ');
		assert.equal(short.type === 'VideoEmbed' && short.props.youtubeId, 'dQw4w9WgXcQ');
		assert.equal(vimeo.type === 'VideoEmbed' && vimeo.props.vimeoId, '123456789');
		assert.equal(spoof.type, 'Button');
		assert.equal(unsafe.type === 'Button' && unsafe.props.href, '#');
		assert.equal(result.warnings.filter((warning) => warning.code === 'video-embed').length, 3);
		assert.ok(result.warnings.some((warning) => warning.code === 'unsafe-link'));
		assert.doesNotMatch(JSON.stringify(result.document), /javascript:|t=60/);
	});
});

it('reports unsupported non-text content rather than silently dropping it from native imports', () => {
	const widgets = [
		{ id: 'q', elType: 'widget', widgetType: 'blockquote', settings: { blockquote_content: '<b>نقل‌قول</b>', blockquote_author: 'گوینده' }, elements: [] },
		{ id: 'a', elType: 'widget', widgetType: 'accordion', settings: { tabs: [{ tab_title: { dynamic: true }, tab_content: 'متن' }] }, elements: [] },
		{ id: 'g', elType: 'widget', widgetType: 'basic-gallery', settings: { wp_gallery: [{ alt: 5, caption: '<b>caption</b>' }] }, elements: [] },
		{ id: 'v', elType: 'widget', widgetType: 'video', settings: { video_url: { dynamic: true } }, elements: [] },
	];
	const result = convertElementorJson(JSON.stringify({ version: '0.4', content: widgets }), page());
	const quote = result.document.nodes[0];
	assert.equal(quote.type === 'Blockquote' && quote.props.text, 'نقل‌قول');
	assert.equal(quote.type === 'Blockquote' && quote.props.author, 'گوینده');
	assert.equal(result.warnings.filter((warning) => warning.code === 'text-format').length, 2);
	assert.ok(result.warnings.some((warning) => warning.code === 'gallery-item-options'));
	assert.ok(result.warnings.some((warning) => warning.code === 'video-source'));
});

it('preserves long text-editor content in ordered editable nodes without breaking Unicode pairs', () => {
	const content = `${'الف'.repeat(4999)}😀${'ب'.repeat(6000)} آخر`;
	const input = { version: '0.4', content: [{ id: 'long-text', elType: 'widget', widgetType: 'text-editor', settings: { editor: content, align: 'center' }, elements: [] }] };
	const result = convertElementorJson(JSON.stringify(input), page());
	const group = result.document.nodes[0];
	assert.equal(group.type, 'Container');
	if (group.type !== 'Container') throw new Error('expected text group');
	assert.ok(group.children.every((child) => child.type === 'Text' && child.props.text.length <= 5000 && child.props.align === 'center'));
	assert.equal(group.children.map((child) => child.type === 'Text' ? child.props.text : '').join(''), content);
	assert.ok(result.warnings.some((warning) => warning.code === 'text-split'));
	assert.equal(result.warnings.some((warning) => warning.code === 'truncated'), false);
});
