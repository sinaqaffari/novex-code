import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmptyPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { textRuns } from '../src/lib/builder/rich-text.ts';
import { convertElementorJson } from '../src/lib/migrations/elementor/converter.ts';
import { parseInlineHtml } from '../src/lib/migrations/inline-html.ts';
import { convertWxrItem, inspectWxr, type WxrItem } from '../src/lib/migrations/wordpress/wxr.ts';

const item = (content: string): WxrItem => ({ id: '1', type: 'page', title: 'Example', slug: 'example', status: 'draft', content, excerpt: '', warnings: [] });
const elementor = (source: string) => JSON.stringify({ version: '0.4', content: [{ id: 'rich', elType: 'widget', widgetType: 'text-editor', settings: { editor: source }, elements: [] }] });

describe('safe formatted migration', () => {
	it('preserves nested emphasis, multiple links, Unicode and entities without retaining executable markup', () => {
		const source = '<p> A <strong>bold <em>and 😀</em></strong> <a href="/local">local</a> &amp; <a href="https://example.com">remote</a> <a href="javascript:alert(1)">unsafe</a> <script>alert(2)</script> &lt;img&gt;</p>';
		const parsed = parseInlineHtml(source);
		assert.equal(parsed.text, 'A bold and 😀 local & remote unsafe  <img>');
		assert.equal(parsed.unsafeLinks, true);
		assert.equal(parsed.unsupportedMarkup, true);
		const runs = textRuns(parsed.text, parsed.marks);
		assert.ok(runs.some((run) => run.text.includes('and 😀') && run.bold && run.italic));
		assert.ok(runs.some((run) => run.text === 'local' && run.href === '/local'));
		assert.ok(runs.some((run) => run.text === 'remote' && run.href === 'https://example.com'));
		assert.ok(runs.some((run) => run.text.includes('unsafe') && !run.href));
		assert.doesNotMatch(JSON.stringify(parsed), /javascript:|alert\(2\)/);
	});
	it('imports formatted Elementor text into editable canonical nodes and reports unsafe or unsupported content', () => {
		const result = convertElementorJson(elementor('<p>Hello <strong>bold <em>both</em></strong> and <a href="/learn">link</a>. <a href="data:text/html,bad">bad</a><span style="color:red"> red</span><script>evil()</script></p>'), createEmptyPageDocument('elementor-rich'));
		const node = result.document.nodes[0];
		assert.equal(node.type, 'Text'); if (node.type !== 'Text') return;
		assert.equal(node.props.text, 'Hello bold both and link. bad red');
		const runs = textRuns(node.props.text, node.props.marks);
		assert.ok(runs.some((run) => run.text === 'both' && run.bold && run.italic));
		assert.ok(runs.some((run) => run.text === 'link' && run.href === '/learn'));
		assert.ok(result.warnings.some((warning) => warning.code === 'unsafe-link'));
		assert.ok(result.warnings.some((warning) => warning.code === 'unsupported-rich-markup'));
		assert.doesNotMatch(JSON.stringify(result.document), /data:text|evil\(\)|color:red|<script>/);
		assert.deepEqual(validatePageDocument(result.document), result.document);
	});
	it('splits long Elementor text while carrying a link and emphasis across the Unicode boundary', () => {
		const source = 'a'.repeat(4999) + '<a href="/long"><strong>😀long</strong></a>' + 'z'.repeat(5100);
		const result = convertElementorJson(elementor(source), createEmptyPageDocument('elementor-rich-long'));
		const group = result.document.nodes[0]; assert.equal(group.type, 'Container'); if (group.type !== 'Container') return;
		assert.equal(group.children.map((node) => node.type === 'Text' ? node.props.text : '').join(''), 'a'.repeat(4999) + '😀long' + 'z'.repeat(5100));
		assert.equal(group.children[0].type === 'Text' && group.children[0].props.text.length, 4999);
		const second = group.children[1]; assert.equal(second.type, 'Text'); if (second.type !== 'Text') return;
		assert.ok(textRuns(second.props.text, second.props.marks).some((run) => run.text === '😀long' && run.bold && run.href === '/long'));
	});
	it('retains safe marks in WordPress headings, paragraphs, quotes and semantic list items', () => {
		const html = '<h2>Hi <em>heading</em></h2><p>Read <strong>important <a href="/one">one</a></strong> and <a href="/two">two</a>.</p><blockquote><p>Quote <b>bold</b> <a href="/quote">link</a></p></blockquote><ul><li>Item <em>first</em> and <a href="/item">link</a></li><li><a href="/whole"><b>Whole</b></a></li></ul><p><a href="javascript:evil()">unsafe</a></p>';
		const result = convertWxrItem(item(html), createEmptyPageDocument('wxr-rich'));
		assert.deepEqual(result.document.nodes.map((node) => node.type), ['Heading', 'Text', 'Blockquote', 'List', 'Text']);
		const [heading, text, quote, list] = result.document.nodes;
		assert.ok(heading.type === 'Heading' && textRuns(heading.props.text, heading.props.marks).some((run) => run.text === 'heading' && run.italic));
		assert.ok(text.type === 'Text' && textRuns(text.props.text, text.props.marks).some((run) => run.text === 'one' && run.bold && run.href === '/one'));
		assert.ok(quote.type === 'Blockquote' && textRuns(quote.props.text, quote.props.marks).some((run) => run.text === 'link' && run.href === '/quote'));
		assert.equal(list.type, 'List'); if (list.type !== 'List') return;
		assert.equal(list.props.items[0].href, '');
		assert.ok(textRuns(list.props.items[0].text, list.props.items[0].marks).some((run) => run.text === 'first' && run.italic));
		assert.ok(textRuns(list.props.items[0].text, list.props.items[0].marks).some((run) => run.text === 'link' && run.href === '/item'));
		assert.equal(list.props.items[1].href, '/whole');
		assert.ok(textRuns(list.props.items[1].text, list.props.items[1].marks).some((run) => run.bold));
		assert.ok(result.warnings.some((warning) => warning.code === 'unsafe-link'));
		assert.doesNotMatch(JSON.stringify(result.document), /javascript:/);
	});
	it('rejects excessive formatting and malformed list link nesting rather than losing content', () => {
		const crowded = Array.from({ length: 101 }, (_, index) => `<a href="/${index}">a</a>`).join(' ');
		assert.throws(() => convertElementorJson(elementor(crowded), createEmptyPageDocument('crowded')), /at most 100/);
		const result = convertWxrItem(item('<ul><li><a href="/safe">text</a></li></ul>'), createEmptyPageDocument('nested-links'));
		const list = result.document.nodes[0]; if (list.type !== 'List') throw new Error('list');
		const bad = { ...list, props: { ...list.props, items: [{ ...list.props.items[0], marks: [{ kind: 'link', start: 0, end: 1, href: '/other' }] }] } };
		assert.throws(() => validatePageDocument({ ...result.document, nodes: [bad] }), /nested links/);
		assert.throws(() => validatePageDocument({ ...result.document, schemaVersion: 4, nodes: [bad] }), /not part of schema v4/);
	});
	it('preserves Elementor heading, testimonial, image-box and list formatting and long content', () => {
		const longHeading = 'a'.repeat(239) + '😀tail';
		const longQuote = 'q'.repeat(4999) + '😀tail';
		const longList = 'l'.repeat(4999) + '😀tail';
		const widgets = [
			{ id: 'heading', elType: 'widget', widgetType: 'heading', settings: { title: `<strong>${longHeading}</strong>`, header_size: 'h3', align: 'center' }, elements: [] },
			{ id: 'quote', elType: 'widget', widgetType: 'testimonial', settings: { testimonial_content: `<em>${longQuote}</em>`, testimonial_name: 'Author' }, elements: [] },
			{ id: 'list', elType: 'widget', widgetType: 'icon-list', settings: { icon_list: [{ text: `<a href="/part"><strong>${longList}</strong></a>` }] }, elements: [] },
			{ id: 'box', elType: 'widget', widgetType: 'image-box', settings: { title_text: 'A <em>title</em>', description_text: 'A <a href="/detail">description</a>' }, elements: [] },
		];
		const result = convertElementorJson(JSON.stringify({ version: '0.4', content: widgets }), createEmptyPageDocument('elementor-extended-rich'));
		const headingGroup = result.document.nodes[0]; assert.equal(headingGroup.type, 'Container'); if (headingGroup.type !== 'Container') return;
		assert.equal(headingGroup.children.map((node) => node.type === 'Heading' || node.type === 'Text' ? node.props.text : '').join(''), longHeading);
		assert.ok(headingGroup.children.every((node) => (node.type === 'Heading' || node.type === 'Text') && node.props.align === 'center' && textRuns(node.props.text, node.props.marks).every((run) => run.bold)));
		const quoteGroup = result.document.nodes[1]; assert.equal(quoteGroup.type, 'Container'); if (quoteGroup.type !== 'Container') return;
		assert.equal(quoteGroup.children.map((node) => node.type === 'Blockquote' ? node.props.text : '').join(''), longQuote);
		assert.ok(quoteGroup.children.every((node) => node.type === 'Blockquote' && textRuns(node.props.text, node.props.marks).every((run) => run.italic)));
		const lastQuote = quoteGroup.children.at(-1); assert.equal(lastQuote?.type === 'Blockquote' && lastQuote.props.author, 'Author');
		const list = result.document.nodes[2]; assert.equal(list.type, 'List'); if (list.type !== 'List') return;
		assert.equal(list.props.items.map((entry) => entry.text).join(''), longList);
		assert.ok(list.props.items.every((entry) => textRuns(entry.text, entry.marks).every((run) => run.bold && run.href === '/part')));
		const box = result.document.nodes[3]; assert.equal(box.type, 'Container'); if (box.type !== 'Container') return;
		const heading = box.children[1], description = box.children[2];
		assert.ok(heading.type === 'Heading' && textRuns(heading.props.text, heading.props.marks).some((run) => run.text === 'title' && run.italic));
		assert.ok(description.type === 'Text' && textRuns(description.props.text, description.props.marks).some((run) => run.text === 'description' && run.href === '/detail'));
		for (const code of ['heading-split', 'quote-split', 'list-text-split']) assert.ok(result.warnings.some((warning) => warning.code === code), code);
	});
	it('reports and avoids nested links when an Elementor list item also has a whole-item destination', () => {
		const source = JSON.stringify({ version: '0.4', content: [{ id: 'list', elType: 'widget', widgetType: 'icon-list', settings: { icon_list: [{ text: 'a <a href="/inner">linked</a>', link: { url: '/outer' } }] }, elements: [] }] });
		const result = convertElementorJson(source, createEmptyPageDocument('nested-elementor-link'));
		const list = result.document.nodes[0]; assert.equal(list.type, 'List'); if (list.type !== 'List') return;
		assert.equal(list.props.items[0].href, '/outer');
		assert.equal(list.props.items[0].marks?.some((mark) => mark.kind === 'link') ?? false, false);
		assert.ok(result.warnings.some((warning) => warning.code === 'list-nested-link'));
	});

	it('preserves Elementor tab and accordion marks across interactive and Unicode length boundaries', () => {
		const title = 'h'.repeat(239) + '😀tail';
		const body = 'b'.repeat(4999) + '😀end';
		for (const widget of ['tabs', 'accordion']) {
			const source = JSON.stringify({ version: '0.4', content: [{ id: widget, elType: 'widget', widgetType: widget, settings: { tabs: [{ tab_title: `<a href="/title"><strong>${title}</strong></a>`, tab_content: `<a href="/body"><em>${body}</em></a>` }] }, elements: [] }] });
			const result = convertElementorJson(source, createEmptyPageDocument(`rich-${widget}`));
			const node = result.document.nodes[0]; assert.equal(node.type, widget === 'tabs' ? 'Tabs' : 'Accordion');
			if (node.type !== 'Tabs' && node.type !== 'Accordion') continue;
			assert.equal(node.props.items.length, 2);
			assert.equal(node.props.items[0].title, 'h'.repeat(239));
			assert.equal(node.props.items.map((entry) => entry.body).join(''), '😀tail\n' + body);
			assert.ok(node.props.items[0].titleMarks?.every((mark) => mark.kind === 'bold'));
			assert.ok(node.props.items.flatMap((entry) => textRuns(entry.body, entry.bodyMarks)).some((run) => run.href === '/body' && run.italic));
			for (const code of ['interactive-title-link', 'interactive-title-split', 'accordion-text-split']) assert.ok(result.warnings.some((warning) => warning.code === code), code);
		}
	});

	it('reports unsupported WXR semantics and attributes even inside blockquotes', () => {
		const html = '<blockquote><p><strong style="color:red">quote</strong> <code>code</code></p><ul><li>one</li></ul><a href="/safe" target="_blank">link</a></blockquote><p><mark>highlight</mark></p>';
		const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Title</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[${html}]]></content:encoded></item></channel></rss>`;
		const item = inspectWxr(xml).items[0];
		const result = convertWxrItem(item, createEmptyPageDocument('wxr-warnings'));
		assert.ok(result.warnings.some((warning) => warning.code === 'unsupported-rich-markup'));
		assert.ok(result.warnings.some((warning) => warning.code === 'quote-list'));
		assert.match(JSON.stringify(result.document), /quote/);
		assert.match(JSON.stringify(result.document), /highlight/);
		assert.doesNotMatch(JSON.stringify(result.document), /color:red|target/);
	});
	it('warns when a WordPress title or separate excerpt cannot be transferred completely', () => {
		const title = 'a'.repeat(99) + '😀tail';
		const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>${title}</title><wp:post_type>post</wp:post_type><excerpt:encoded>Untransferred excerpt</excerpt:encoded></item></channel></rss>`;
		const item = inspectWxr(xml).items[0];
		assert.equal(item.title, 'a'.repeat(99));
		assert.ok(item.warnings.some((warning) => warning.includes('عنوان منبع')));
		assert.ok(item.warnings.some((warning) => warning.includes('چکیده')));
	});

	it('migrates whole-heading destinations and preserves long button and price-table text', () => {
		const heading = 'h'.repeat(239) + '😀heading';
		const button = 'b'.repeat(79) + '😀button';
		const price = 'p'.repeat(4999) + '😀price';
		const feature = 'f'.repeat(4999) + '😀feature';
		const source = { version: '0.4', content: [
			{ id: 'heading', elType: 'widget', widgetType: 'heading', settings: { title: `<strong>${heading}<a href="/inner">inner</a></strong>`, link: { url: '/outer', is_external: 'on' } }, elements: [] },
			{ id: 'button', elType: 'widget', widgetType: 'button', settings: { text: `<em>${button}</em>`, link: { url: '/button' } }, elements: [] },
			{ id: 'price', elType: 'widget', widgetType: 'price-table', settings: { heading: '<em>Premium</em>', currency_symbol: '$', price, period: '<strong>month</strong>', features_list: [{ item_text: `<a href="/feature">${feature}</a>` }], button_text: button, link: { url: '/buy' } }, elements: [] },
		] };
		const result = convertElementorJson(JSON.stringify(source), createEmptyPageDocument('rich-price'));
		const headingGroup = result.document.nodes[0]; assert.equal(headingGroup.type, 'Container'); if (headingGroup.type !== 'Container') return;
		assert.equal(headingGroup.children.map((node) => node.type === 'Heading' || node.type === 'Text' ? node.props.text : '').join(''), heading + 'inner');
		assert.ok(headingGroup.children.every((node) => (node.type === 'Heading' || node.type === 'Text') && textRuns(node.props.text, node.props.marks).every((run) => run.bold && run.href === '/outer')));
		const buttonGroup = result.document.nodes[1]; assert.equal(buttonGroup.type, 'Container'); if (buttonGroup.type !== 'Container') return;
		assert.equal(buttonGroup.children.map((node) => node.type === 'Button' ? node.props.label : node.type === 'Text' ? node.props.text : '').join(''), button);
		assert.equal(buttonGroup.children[0].type === 'Button' && buttonGroup.children[0].props.href, '/button');
		const priceGroup = result.document.nodes[2]; assert.equal(priceGroup.type, 'Container'); if (priceGroup.type !== 'Container') return;
		const collected = priceGroup.children.map((node) => node.type === 'Button' ? node.props.label : node.type === 'Heading' || node.type === 'Text' ? node.props.text : '').join('');
		assert.ok(collected.includes(price)); assert.ok(collected.includes(feature)); assert.ok(collected.includes(button));
		assert.ok(priceGroup.children.some((node) => node.type === 'Heading' && textRuns(node.props.text, node.props.marks).some((run) => run.text === 'Premium' && run.italic)));
		assert.ok(priceGroup.children.some((node) => node.type === 'Text' && textRuns(node.props.text, node.props.marks).some((run) => run.href === '/feature')));
		for (const code of ['nested-link', 'link-options', 'heading-split', 'button-formatting', 'button-split', 'price-text-split', 'price-feature-split']) assert.ok(result.warnings.some((warning) => warning.code === code), code);
	});

	it('converts structured Elementor text-editor HTML to native nodes and maps only local media', () => {
		const html = '<h3>Structured <em>heading</em></h3><p>Rich <strong>paragraph</strong></p><blockquote>Quote <a href="/quote">link</a></blockquote><ul><li>First <em>item</em></li><li><a href="/two">Second</a></li></ul><a href="/image"><img src="https://old.example/a.png" alt="Local image"></a><script>window.bad=1</script>';
		const map = new Map([['https://old.example/a.png', 'media://assets/blog-placeholder-1.jpg']]);
		const result = convertElementorJson(elementor(html), createEmptyPageDocument('structured-elementor'), map);
		const group = result.document.nodes[0]; assert.equal(group.type, 'Container'); if (group.type !== 'Container') return;
		assert.deepEqual(group.children.map((node) => node.type), ['Heading', 'Text', 'Blockquote', 'List', 'Image']);
		const [heading, paragraph, quote, list, image] = group.children;
		assert.ok(heading.type === 'Heading' && heading.props.level === 3 && textRuns(heading.props.text, heading.props.marks).some((run) => run.italic));
		assert.ok(paragraph.type === 'Text' && textRuns(paragraph.props.text, paragraph.props.marks).some((run) => run.bold));
		assert.ok(quote.type === 'Blockquote' && textRuns(quote.props.text, quote.props.marks).some((run) => run.href === '/quote'));
		assert.ok(list.type === 'List' && list.props.items.length === 2 && list.props.items[1].href === '/two');
		assert.ok(image.type === 'Image' && image.props.src === 'media://assets/blog-placeholder-1.jpg');
		assert.equal(result.missingAssets, 0);
		assert.ok(result.warnings.some((warning) => warning.code === 'image-link-omitted'));
		assert.ok(result.warnings.some((warning) => warning.code === 'unsupported-active'));
		assert.doesNotMatch(JSON.stringify(result.document), /old\.example|window\.bad/);
	});

	it('bounds repeated unsupported-markup warnings in structured Elementor text', () => {
		const result = convertElementorJson(elementor('<p>' + '<u>x</u>'.repeat(1000) + '</p>'), createEmptyPageDocument('warning-bounds'));
		assert.equal(result.warnings.filter((warning) => warning.code === 'unsupported-rich-markup').length, 1);
		assert.equal(result.document.nodes[0].type === 'Text' && result.document.nodes[0].props.text.length, 1000);
	});

});
