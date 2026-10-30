import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diagnosePageDocument } from '../src/lib/builder/diagnostics.ts';
import { createEmptyPageDocument, exportPageDocument, importPageDocument, validatePageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { executeDocumentCommand } from '../src/lib/builder/commands.ts';
import { commitDocument, createDocumentHistory, undoDocument } from '../src/lib/builder/history.ts';
import { inspectWxr, wxrItemToDocument } from '../src/lib/migrations/wordpress/wxr.ts';

describe('native lists and WordPress migration', () => {
	it('validates list links, stable item IDs, history and schema compatibility', async () => {
		let page = addNode(createEmptyPageDocument('list-test'), 'List', { id: 'node_listtest1' });
		page = updateNodeProps(page, 'node_listtest1', { kind: 'ordered', items: [{ id: 'item_first1', text: 'مرحله', href: '/about' }] });
		assert.deepEqual(importPageDocument(exportPageDocument(page)), page);
		assert.throws(() => validatePageDocument({ ...page, schemaVersion: 3 }), /not part of schema v3/);
		assert.throws(() => updateNodeProps(page, 'node_listtest1', { items: [{ id: 'item_first1', text: 'x', href: 'javascript:alert(1)' }] }));
		assert.throws(() => updateNodeProps(page, 'node_listtest1', { items: [{ id: 'item_first1', text: 'x', href: '', html: '<b>' }] }));
		const result = executeDocumentCommand(page, { type: 'props', id: 'node_listtest1', patch: { items: [] } });
		assert.ok(result.ok); if (!result.ok) return;
		assert.deepEqual(undoDocument(commitDocument(createDocumentHistory(page), result.document)).present, page);
		assert.ok((await diagnosePageDocument(result.document, page.slug, async () => true)).some((d) => d.code === 'empty-list'));
	});
	it('preserves ordered list text and safe standalone links while stripping active content', () => {
		const html = '<p>قبل</p><ol><li><a href="/safe">یک</a></li><li>دو <a href="javascript:alert(1)">بدون پیوند</a></li><li><a href="javascript:alert(1)">ناامن</a></li></ol><p>بعد</p><script>alert(1)</script>';
		const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Test</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[${html}]]></content:encoded></item></channel></rss>`;
		const item = inspectWxr(xml).items[0];
		assert.ok(item.warnings.some((warning) => warning.includes('فهرست‌های ساده')));
		const page = wxrItemToDocument(item, createEmptyPageDocument('wxr-list'));
		assert.deepEqual(page.nodes.map((node) => node.type), ['Text', 'List', 'Text']);
		const list = page.nodes[1]; assert.equal(list.type, 'List'); if (list.type !== 'List') return;
		assert.equal(list.props.kind, 'ordered');
		assert.deepEqual(list.props.items.map(({ text, href }) => ({ text, href })), [{ text: 'یک', href: '/safe' }, { text: 'دو بدون پیوند', href: '' }, { text: 'ناامن', href: '' }]);
		assert.doesNotMatch(JSON.stringify(page), /javascript:|<script>|alert\(1\)/);
	});
	it('does not drop empty entries or reorder embedded quotes', () => {
		const item = { id: '1', type: 'page' as const, title: 'x', slug: 'x', status: 'draft', content: '<ul><li>قبل<blockquote>نقل قول</blockquote>پس</li><li></li></ul>', excerpt: '', warnings: [] };
		const page = wxrItemToDocument(item, createEmptyPageDocument('quoted-list'));
		assert.deepEqual(page.nodes.map((node) => node.type), ['List', 'Blockquote', 'List']);
		const before = page.nodes[0], quote = page.nodes[1], after = page.nodes[2];
		assert.equal(before.type === 'List' && before.props.items[0].text, 'قبل');
		assert.equal(quote.type === 'Blockquote' && quote.props.text, 'نقل قول');
		assert.deepEqual(after.type === 'List' && after.props.items.map((entry) => entry.text), ['پس', '']);
	});
	it('keeps nested and large list text in order without exceeding per-node limits', () => {
		const entries = Array.from({ length: 30 }, (_, i) => `<li>مورد ${i}</li>`).join('');
		const item = { id: '1', type: 'page' as const, title: 'x', slug: 'x', status: 'draft', content: `<ul><li>والد<ul><li>فرزند</li></ul>دنباله</li>${entries}</ul>`, excerpt: '', warnings: [] };
		const page = wxrItemToDocument(item, createEmptyPageDocument('nested-lists'));
		const lists = page.nodes.filter((node) => node.type === 'List');
		assert.ok(lists.every((node) => node.type === 'List' && node.props.items.length <= 24));
		const items = lists.flatMap((node) => node.type === 'List' ? node.props.items.map((entry) => entry.text) : []);
		assert.deepEqual(items.slice(0, 3), ['والد', 'فرزند', 'دنباله']);
		assert.equal(items.at(-1), 'مورد 29'); assert.equal(items.length, 33);
	});
});
