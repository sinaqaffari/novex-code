import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderMarkdown } from '../src/lib/cms/markdown.ts';

describe('safe Markdown rendering', () => {
	it('escapes raw HTML while preserving Markdown formatting', async () => {
		const html = await renderMarkdown('<img src=x onerror=alert(1)>\n\n**متن امن**');
		assert.ok(!html.includes('<img'));
		assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
		assert.ok(html.includes('<strong>متن امن</strong>'));
	});

	it('does not render dangerous or entity-obfuscated URL schemes as active links', async () => {
		for (const href of ['javascript:alert(1)', 'java&#x73;cript:alert(1)', 'javascript&colon;alert(1)']) {
			const html = await renderMarkdown(`[پیوند](${href})`);
			assert.ok(!html.toLowerCase().includes('javascript:'));
			assert.ok(!html.includes('<a '));
		}
	});

	it('blocks data URLs in Markdown images', async () => {
		const html = await renderMarkdown('![تصویر](data:image/png;base64,AAAA)');
		assert.ok(!html.includes('<img'));
		assert.ok(!html.includes('src='));
	});
});
