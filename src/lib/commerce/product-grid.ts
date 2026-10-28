import type { Product, ProductGridBinding, PublicProductCard } from './types.ts';
import { readDatabase } from './db.ts';
import { normalizeProductGridBinding } from './product-binding.ts';

function safePublicImage(value: string): string {
	const image = value.trim();
	if (!image || /[\\\u0000-\u001f\u007f]/.test(image)) return '';
	if (image.startsWith('/') && !image.startsWith('//')) return image;
	try {
		const parsed = new URL(image);
		return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? image : '';
	} catch {
		return '';
	}
}

function isPublishedProduct(value: unknown): value is Product {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const product = value as Partial<Product>;
	return product.status === 'active' &&
		typeof product.name === 'string' && product.name.trim().length > 0 &&
		typeof product.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug) &&
		typeof product.category === 'string' &&
		typeof product.description === 'string' &&
		typeof product.image === 'string' &&
		typeof product.price === 'number' && Number.isFinite(product.price) && product.price >= 0 &&
		typeof product.stock === 'number' && Number.isSafeInteger(product.stock) && product.stock >= 0 &&
		typeof product.featured === 'boolean' &&
		typeof product.createdAt === 'string';
}

function productTimestamp(product: Product): number {
	const value = Date.parse(product.createdAt);
	return Number.isFinite(value) ? value : 0;
}

function productNameOrder(a: Product, b: Product): number {
	return normalizeProductName(a.name).localeCompare(normalizeProductName(b.name), 'fa') || a.slug.localeCompare(b.slug);
}

function normalizeProductName(value: string): string {
	return value.toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064B-\u065F\u0670]/g, '');
}

export async function listBoundPublicProductCards(input: ProductGridBinding | unknown): Promise<PublicProductCard[]> {
	const binding = normalizeProductGridBinding(input);
	const database = await readDatabase();
	let products = database.products.filter(isPublishedProduct);

	if (binding.selection === 'featured') products = products.filter((product) => product.featured);
	if (binding.selection === 'category') {
		const category = normalizeProductName(binding.category ?? '');
		if (!category) return [];
		products = products.filter((product) => normalizeProductName(product.category) === category);
	}

	products = [...products].sort((a, b) =>
		productTimestamp(b) - productTimestamp(a) || productNameOrder(a, b),
	);

	return products.slice(0, binding.limit).map((product) => ({
		name: product.name.slice(0, 160),
		slug: product.slug,
		category: product.category.slice(0, 60),
		description: product.description.slice(0, 4000),
		price: product.price,
		...(typeof product.compareAtPrice === 'number' && Number.isFinite(product.compareAtPrice) && product.compareAtPrice > product.price
			? { compareAtPrice: product.compareAtPrice }
			: {}),
		image: safePublicImage(product.image),
		inStock: product.stock > 0,
	}));
}
