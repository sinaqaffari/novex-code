import type { APIRoute } from 'astro';
import { renderMarkdown } from '../../../lib/cms/markdown';
import { asText, json, readPayload } from '../../../lib/cms/http';

export const prerender = false;

/**
 * Live Markdown preview for authenticated users with post-write permission.
 * Raw HTML is escaped in the shared renderer, matching the public blog policy.
 */
export const POST: APIRoute = async ({ request }) => {
	const payload = await readPayload(request);
	const markdown = asText(payload.markdown);
	const words = markdown
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/[#>*_~`|\-[\]()!]/g, ' ')
		.split(/\s+/)
		.filter(Boolean).length;

	const html = await renderMarkdown(markdown);
	return json({
		ok: true,
		html,
		words,
		minutes: Math.max(1, Math.round(words / 200)),
	});
};
