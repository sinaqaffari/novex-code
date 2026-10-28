import type { APIRoute } from 'astro';
import { json } from '../../lib/cms/http.ts';
import { resolveProductGridData } from '../../lib/builder/product-grid.ts';
import { parseProductGridQuery } from '../../lib/commerce/product-binding.ts';

export const prerender = false;

/** Public product-card projection for Builder bindings; private IDs, SKU, and quantities are omitted. */
export const GET: APIRoute = async ({ url }) => {
	try {
		const binding = parseProductGridQuery(url.searchParams);
		const data = await resolveProductGridData(binding);
		if (data.status === 'error') return json({ ok: false, status: 'error' }, 503);
		return json({ ok: true, ...data });
	} catch (error) {
		return json({ ok: false, message: error instanceof Error ? error.message : 'Product query is invalid.' }, 400);
	}
};
