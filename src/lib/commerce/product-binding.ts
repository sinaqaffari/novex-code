import type { ProductGridBinding } from './types.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function normalizeProductGridBinding(input: unknown): ProductGridBinding {
	if (!isRecord(input)) throw new Error('Product Grid data binding must be an object.');
	const allowed = ['provider', 'version', 'selection', 'limit', 'category'];
	for (const key of Object.keys(input)) {
		if (!allowed.includes(key)) throw new Error(`Unsupported product data binding property "${key}".`);
	}
	if (input.provider !== 'novex-commerce-products' || input.version !== 1) {
		throw new Error('Product Grid requires the supported Novex Commerce products binding (version 1).');
	}
	if (input.selection !== 'featured' && input.selection !== 'latest' && input.selection !== 'category') {
		throw new Error('Product Grid selection must be featured, latest, or category.');
	}
	if (typeof input.limit !== 'number' || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 12) {
		throw new Error('Product Grid limit must be an integer from 1 to 12.');
	}
	if (input.category !== undefined && (
		typeof input.category !== 'string' ||
		input.category.length > 60 ||
		/[\u0000-\u001f\u007f]/.test(input.category)
	)) {
		throw new Error('Product Grid category must be text of at most 60 characters.');
	}
	if (input.selection !== 'category' && input.category !== undefined) {
		throw new Error('Product Grid category is only valid with category selection.');
	}
	return {
		provider: 'novex-commerce-products',
		version: 1,
		selection: input.selection,
		limit: input.limit,
		...(input.selection === 'category' ? { category: String(input.category ?? '').trim() } : {}),
	};
}

export function parseProductGridQuery(params: URLSearchParams): ProductGridBinding {
	const keys = new Set(params.keys());
	for (const key of keys) {
		if (!['selection', 'limit', 'category'].includes(key)) throw new Error(`Unsupported product query parameter "${key}".`);
		if (params.getAll(key).length !== 1) throw new Error(`Product query parameter "${key}" must be provided only once.`);
	}
	const rawLimit = params.get('limit');
	return normalizeProductGridBinding({
		provider: 'novex-commerce-products',
		version: 1,
		selection: params.get('selection'),
		limit: rawLimit !== null && /^\d+$/.test(rawLimit) ? Number(rawLimit) : Number.NaN,
		...(params.has('category') ? { category: params.get('category') } : {}),
	});
}

export function productGridApiPath(binding: ProductGridBinding): string {
	const normalized = normalizeProductGridBinding(binding);
	const params = new URLSearchParams({ selection: normalized.selection, limit: String(normalized.limit) });
	if (normalized.selection === 'category') params.set('category', normalized.category ?? '');
	return `/api/products?${params.toString()}`;
}
