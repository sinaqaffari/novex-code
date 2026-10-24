import type { APIRoute } from 'astro';
import { marked } from 'marked';
import { asText, json, readPayload } from '../../../lib/cms/http';

export const prerender = false;

marked.setOptions({ gfm: true, breaks: false });

/**
 * Live Markdown preview for the editor. Only authenticated administrators can
 * reach this endpoint (see `src/middleware.ts`), so the HTML is trusted.
 */
export const POST: APIRoute = async ({ request }) => {
	const payload = await readPayload(request);
	const markdown = asText(payload.markdown);
	const words = markdown
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/[#>*_~`|\-[\]()!]/g, ' ')
		.split(/\s+/)
		.filter(Boolean).length;

	const html = await marked.parse(markdown);
	return json({
		ok: true,
		html,
		words,
		minutes: Math.max(1, Math.round(words / 200)),
	});
};
