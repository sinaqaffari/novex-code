import type { APIRoute } from 'astro';
import { readAsset } from '../../../../lib/cms/media';
import { CmsError } from '../../../../lib/cms/posts';

export const prerender = false;

/** Stream an asset from `src/assets` so the panel can preview uploads. */
export const GET: APIRoute = async ({ params }) => {
	try {
		const reference = params.path ?? '';
		const { body, type } = await readAsset(reference);
		return new Response(new Uint8Array(body), {
			headers: {
				'content-type': type,
			'content-length': String(body.byteLength),
			'cache-control': 'private, max-age=60',
			'x-content-type-options': 'nosniff',
			},
		});
	} catch (error) {
		const status = error instanceof CmsError ? error.status : 500;
		return new Response('تصویر پیدا نشد.', {
			status,
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		});
	}
};
