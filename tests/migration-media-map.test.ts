import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { mappedMigrationMedia, parseMigrationMediaMap } from '../src/lib/migrations/media-map.ts';
import { convertElementorJson } from '../src/lib/migrations/elementor/converter.ts';
import { convertWxrItem, inspectWxr, wxrToDraftPages } from '../src/lib/migrations/wordpress/wxr.ts';

const existing = 'media://uploads/existing.png';
const other = 'media://assets/other.webp';
const widget = (id: string, widgetType: string, settings: object) => ({ id, elType: 'widget', widgetType, settings, elements: [] });

describe('migration media mapping', () => {
	it('validates bounded source keys and only managed image targets', () => {
		const mapping = parseMigrationMediaMap({ 'id:12': existing, 'https://old.example/pic.png': existing, '/wp-content/other.webp': other });
		assert.equal(mapping.size, 3);
		assert.equal(mappedMigrationMedia(mapping, { id: 12, url: 'https://old.example/pic.png' }), existing);
		assert.equal(mappedMigrationMedia(mapping, { url: '/wp-content/other.webp' }), other);
		assert.equal(mappedMigrationMedia(mapping, { id: 999 }), null);
		for (const input of [null, [], 'x', { 'id:0': existing }, { '__proto__': null, 'https://old.example/a': 'https://example.com/a.png' }, { 'javascript:alert(1)': existing }, { 'https://user:secret@old.example/a': existing }, { '//old.example/a': existing }, { 'id:2': 'media://uploads/../bad.png' }, Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`id:${i + 1}`, existing]))]) {
			assert.throws(() => parseMigrationMediaMap(input));
		}
		assert.throws(() => mappedMigrationMedia(new Map([['id:12', 'https://example.com/a.png']]), { id: 12 }));
	});
	it('fails closed if an ID and URL disagree rather than assigning the wrong asset', () => {
		const mapping = parseMigrationMediaMap({ 'id:12': existing, 'https://old.example/pic.png': other });
		assert.throws(() => mappedMigrationMedia(mapping, { id: '12', url: 'https://old.example/pic.png' }), /تعارض/);
	});
	it('maps Elementor images, image boxes and gallery entries without preserving remote URLs', () => {
		const source = JSON.stringify({ version: '0.4', content: [
			widget('one', 'image', { image: { id: 12, url: 'https://old.example/pic.png', alt: 'نمونه' } }),
			widget('two', 'image-box', { image: { url: '/wp-content/other.webp' }, title_text: 'عنوان', description_text: 'متن' }),
			widget('three', 'image-gallery', { wp_gallery: [{ id: 12, url: 'https://old.example/pic.png', alt: 'گالری' }, { id: 99, url: 'https://old.example/unmapped.png' }] }),
		] });
		const map = parseMigrationMediaMap({ 'id:12': existing, '/wp-content/other.webp': other });
		const target = createEmptyPageDocument('map-test');
		const result = convertElementorJson(source, target, map);
		assert.equal(result.missingAssets, 1);
		const [image, box, gallery] = result.document.nodes;
		assert.equal(image.type === 'Image' && image.props.src, existing);
		assert.equal(image.type === 'Image' && image.props.alt, 'نمونه');
		assert.equal(box.type === 'Container' && box.children[0].type === 'Image' && box.children[0].props.src, other);
		assert.deepEqual(gallery.type === 'ImageGallery' && gallery.props.items.map((item) => item.src), [existing, '']);
		assert.doesNotMatch(JSON.stringify(result.document), /old\.example|wp-content/);
		assert.equal(convertElementorJson(source, target).missingAssets, 4);
		const conflicting = parseMigrationMediaMap({ 'id:12': existing, 'https://old.example/pic.png': other });
		assert.throws(() => convertElementorJson(source, target, conflicting), /تعارض/);
	});
	it('applies the same mapping to WXR HTML, embedded Elementor and bulk drafts', () => {
		const html = '<p>متن</p><img class="align wp-image-12 size-large" src="https://old.example/pic.png" alt="نمونه"><img src="/wp-content/other.webp"><img src="https://old.example/unmapped.png">';
		const elementor = JSON.stringify([widget('e1', 'image', { image: { id: 12, url: 'https://old.example/pic.png' } })]);
		const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>یک</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[${html}]]></content:encoded><wp:postmeta><wp:meta_key>_elementor_data</wp:meta_key><wp:meta_value><![CDATA[${elementor}]]></wp:meta_value></wp:postmeta></item><item><title>دو</title><wp:post_type>post</wp:post_type><content:encoded><![CDATA[${html}]]></content:encoded></item></channel></rss>`;
		const inspection = inspectWxr(xml);
		const before = JSON.stringify(inspection);
		const map = parseMigrationMediaMap({ 'id:12': existing, '/wp-content/other.webp': other });
		const htmlDoc = convertWxrItem(inspection.items[0], createEmptyPageDocument('wxr'), false, map).document;
		assert.deepEqual(htmlDoc.nodes.filter((node) => node.type === 'Image').map((node) => node.props.src), [existing, other, '']);
		const embedded = convertWxrItem(inspection.items[0], createEmptyPageDocument('wxr'), true, map).document;
		assert.equal(embedded.nodes[0].type === 'Image' && embedded.nodes[0].props.src, existing);
		const bulk = wxrToDraftPages(inspection, 'mapped-wp', true, map);
		assert.equal(bulk[0].nodes[0].type === 'Image' && bulk[0].nodes[0].props.src, existing);
		assert.equal(bulk[1].nodes[1].type === 'Image' && bulk[1].nodes[1].props.src, existing);
		assert.equal(JSON.stringify(inspection), before);
		assert.doesNotMatch(JSON.stringify(bulk), /old\.example|wp-content/);
		const ambiguous = { ...inspection.items[0], content: '<img data-attachment-id="99" class="wp-image-12">' };
		assert.throws(() => convertWxrItem(ambiguous, createEmptyPageDocument('ambiguous'), false, map), /تعارض/);
	});
});
