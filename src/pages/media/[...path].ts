import type { APIRoute } from 'astro';
import { readAsset } from '../../lib/cms/media';

export const prerender = false;

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Public, read-only access to the media library (used by the storefront). */
export const GET: APIRoute = async ({ params }) => {
	try {
		const { body, type } = await readAsset(params.path ?? '');
		return new Response(new Uint8Array(body), {
			headers: {
				'content-type': type,
				'content-length': String(body.byteLength),
				'cache-control': IMMUTABLE,
				'x-content-type-options': 'nosniff',
			},
		});
	} catch {
		return new Response('تصویر پیدا نشد.', {
			status: 404,
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		});
	}
};
