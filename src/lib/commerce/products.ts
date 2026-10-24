/** محصولات: فهرست، جست‌وجو، ساخت، ویرایش و حذف. */

import { AppError } from '../errors.ts';
import { slugify } from '../cms/posts.ts';
import { newId, readDatabase, updateDatabase } from './db.ts';
import type { Product, ProductStatus } from './types.ts';
import { parseEnum, parseInteger, parseMoney, requireText, asBool, asText } from './validation.ts';

export interface ProductInput {
	name: string;
	slug: string;
	sku: string;
	price: number;
	compareAtPrice?: number;
	stock: number;
	category: string;
	description: string;
	image: string;
	status: ProductStatus;
	featured: boolean;
}

export interface ProductListOptions {
	query?: string;
	status?: ProductStatus | 'all';
	category?: string;
	sort?: 'newest' | 'price-asc' | 'price-desc' | 'stock-asc' | 'name';
	page?: number;
	perPage?: number;
}

export function toProductInput(payload: Record<string, unknown>): ProductInput {
	const name = requireText(payload.name, 'name', 'نام محصول');
	const status = parseEnum<ProductStatus>(
		payload.status,
		['active', 'draft', 'archived'],
		'draft',
		'status',
		'وضعیت',
	);
	const compareAtPrice = payload.compareAtPrice
		? parseMoney(payload.compareAtPrice, 'compareAtPrice', 'قیمت پیش از تخفیف')
		: undefined;

	return {
		name,
		slug: asText(payload.slug) || slugify(name),
		sku: requireText(payload.sku, 'sku', 'کد کالا (SKU)', 40).toUpperCase(),
		price: parseMoney(payload.price, 'price', 'قیمت'),
		compareAtPrice: compareAtPrice && compareAtPrice > 0 ? compareAtPrice : undefined,
		stock: parseInteger(payload.stock, 'stock', 'موجودی', { max: 1_000_000 }),
		category: requireText(payload.category, 'category', 'دسته‌بندی', 60),
		description: asText(payload.description).slice(0, 4000),
		image: asText(payload.image),
		status,
		featured: asBool(payload.featured),
	};
}

function normalizeQuery(value: string): string {
	return value
		.toLowerCase()
		.replace(/[يى]/g, 'ی')
		.replace(/ك/g, 'ک')
		.replace(/[\u064B-\u065F\u0670]/g, '');
}

export async function listProducts(options: ProductListOptions = {}) {
	const db = await readDatabase();
	const {
		query = '',
		status = 'all',
		category = '',
		sort = 'newest',
		page = 1,
		perPage = 10,
	} = options;

	const needle = normalizeQuery(query.trim());
	let items = db.products.filter((product) => {
		const matchesStatus = status === 'all' || product.status === status;
		const matchesCategory = !category || product.category === category;
		const haystack = normalizeQuery(`${product.name} ${product.sku} ${product.category} ${product.slug}`);
		return matchesStatus && matchesCategory && (!needle || haystack.includes(needle));
	});

	items = [...items].sort((a, b) => {
		switch (sort) {
			case 'price-asc':
				return a.price - b.price;
			case 'price-desc':
				return b.price - a.price;
			case 'stock-asc':
				return a.stock - b.stock;
			case 'name':
				return a.name.localeCompare(b.name, 'fa');
			default:
				return new Date(b.updatedAt).valueOf() - new Date(a.updatedAt).valueOf();
		}
	});

	const total = items.length;
	const pages = Math.max(1, Math.ceil(total / perPage));
	const current = Math.min(Math.max(1, page), pages);

	return {
		items: items.slice((current - 1) * perPage, current * perPage),
		total,
		pages,
		page: current,
		perPage,
		categories: [...new Set(db.products.map((product) => product.category))].sort((a, b) =>
			a.localeCompare(b, 'fa'),
		),
		counts: {
			all: db.products.length,
			active: db.products.filter((product) => product.status === 'active').length,
			draft: db.products.filter((product) => product.status === 'draft').length,
			archived: db.products.filter((product) => product.status === 'archived').length,
		},
	};
}

export async function getProduct(idOrSlug: string): Promise<Product | null> {
	const db = await readDatabase();
	return (
		db.products.find((product) => product.id === idOrSlug || product.slug === idOrSlug) ?? null
	);
}

export async function createProduct(input: ProductInput): Promise<Product> {
	return updateDatabase((db) => {
		assertSkuAndSlugFree(db.products, input);
		const now = new Date().toISOString();
		const product: Product = {
			id: newId('prd'),
			...input,
			createdAt: now,
			updatedAt: now,
		};
		db.products.unshift(product);
		return product;
	});
}

export async function updateProduct(id: string, input: ProductInput): Promise<Product> {
	return updateDatabase((db) => {
		const product = db.products.find((item) => item.id === id);
		if (!product) throw new AppError('محصول مورد نظر پیدا نشد.', undefined, 404);
		assertSkuAndSlugFree(db.products, input, id);
		Object.assign(product, input, { updatedAt: new Date().toISOString() });
		return product;
	});
}

export async function deleteProduct(id: string): Promise<void> {
	await updateDatabase((db) => {
		const index = db.products.findIndex((item) => item.id === id);
		if (index === -1) throw new AppError('محصول مورد نظر پیدا نشد.', undefined, 404);
		db.products.splice(index, 1);
	});
}

export async function duplicateProduct(id: string): Promise<Product> {
	return updateDatabase((db) => {
		const source = db.products.find((item) => item.id === id);
		if (!source) throw new AppError('محصول مورد نظر پیدا نشد.', undefined, 404);
		const now = new Date().toISOString();
		const copy: Product = {
			...source,
			id: newId('prd'),
			name: `${source.name} — رونوشت`,
			slug: `${source.slug}-copy-${Date.now().toString(36)}`,
			sku: `${source.sku}-C${Math.floor(Math.random() * 90 + 10)}`,
			status: 'draft',
			featured: false,
			createdAt: now,
			updatedAt: now,
		};
		db.products.unshift(copy);
		return copy;
	});
}

export async function setProductStatus(id: string, status: ProductStatus): Promise<Product> {
	return updateDatabase((db) => {
		const product = db.products.find((item) => item.id === id);
		if (!product) throw new AppError('محصول مورد نظر پیدا نشد.', undefined, 404);
		product.status = status;
		product.updatedAt = new Date().toISOString();
		return product;
	});
}

function assertSkuAndSlugFree(products: Product[], input: ProductInput, ignoreId?: string) {
	const skuTaken = products.some(
		(product) => product.id !== ignoreId && product.sku.toLowerCase() === input.sku.toLowerCase(),
	);
	if (skuTaken) throw new AppError('این کد کالا قبلاً ثبت شده است.', 'sku');

	const slugTaken = products.some(
		(product) => product.id !== ignoreId && product.slug === input.slug,
	);
	if (slugTaken) throw new AppError('این نامک قبلاً استفاده شده است.', 'slug');

	const priceIssue =
		input.compareAtPrice !== undefined && input.compareAtPrice <= input.price
			? 'قیمت پیش از تخفیف باید بیشتر از قیمت فروش باشد.'
			: null;
	if (priceIssue) throw new AppError(priceIssue, 'compareAtPrice');
}

export async function listPublicProducts(): Promise<Product[]> {
	const db = await readDatabase();
	return db.products
		.filter((product) => product.status === 'active')
		.sort((a, b) => Number(b.featured) - Number(a.featured) || a.price - b.price);
}
