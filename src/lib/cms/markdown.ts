/**
 * Shared Markdown rendering for public posts and CMS previews. Marked does not
 * sanitize raw HTML or dangerous URL schemes, so both are filtered here.
 */

import { marked, Renderer, type MarkedOptions } from 'marked';

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function decodeUrlEntities(value: string): string {
	return value
		.replace(/&#(?:x([\da-f]{1,6})|(\d{1,7}));?/gi, (entity, hex: string | undefined, decimal: string | undefined) => {
			const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
			try {
				return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
					? String.fromCodePoint(codePoint)
					: entity;
			} catch {
				return entity;
			}
		})
		.replace(/&colon;/gi, ':')
		.replace(/&tab;/gi, '\t')
		.replace(/&newline;/gi, '\n');
}

function hasAllowedScheme(value: string, allowed: readonly string[]): boolean {
	const normalized = decodeUrlEntities(value)
		.trim()
		.replace(/[\u0000-\u0020\u007f]+/g, '')
		.toLowerCase();
	const scheme = normalized.match(/^([a-z][a-z\d+.-]*):/)?.[1];
	return !scheme || allowed.includes(scheme);
}

export function createSafeMarkdownRenderer(): Renderer {
	const renderer = new Renderer();
	const renderLink = renderer.link.bind(renderer);
	const renderImage = renderer.image.bind(renderer);

	renderer.html = ({ text }) => escapeHtml(text);
	renderer.link = (token) =>
		hasAllowedScheme(token.href, ['http', 'https', 'mailto', 'tel'])
			? renderLink(token)
			: token.text;
	renderer.image = (token) =>
		hasAllowedScheme(token.href, ['http', 'https'])
			? renderImage(token)
			: escapeHtml(token.text);
	return renderer;
}

export async function renderMarkdown(markdown: string, options: MarkedOptions = {}): Promise<string> {
	return marked.parse(markdown, {
		gfm: true,
		breaks: false,
		...options,
		renderer: options.renderer ?? createSafeMarkdownRenderer(),
	});
}
