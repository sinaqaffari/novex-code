import { assetExists } from '../cms/media.ts';
import { readSettings } from '../cms/settings.ts';
import { listBoundPublicProductCards } from '../commerce/product-grid.ts';
import { normalizeProductGridBinding } from '../commerce/product-binding.ts';
import type { ProductGridBinding, PublicProductCard } from '../commerce/types.ts';

export interface ProductGridData {
	status: 'ready' | 'disabled' | 'error';
	currency: string;
	products: PublicProductCard[];
}

/** Shared resolver for the authenticated editor preview API and public SSR renderer. */
async function availablePublicImage(image: string): Promise<string> {
	if (!image.startsWith('/media/')) return image;
	try {
		const reference = decodeURIComponent(image.slice('/media/'.length));
		return await assetExists(reference) ? image : '';
	} catch {
		return '';
	}
}

export async function resolveProductGridData(input: ProductGridBinding | unknown): Promise<ProductGridData> {
	const binding = normalizeProductGridBinding(input);
	const settings = await readSettings();
	if (!settings.commerceEnabled) return { status: 'disabled', currency: settings.currency, products: [] };
	try {
		const cards = await listBoundPublicProductCards(binding);
		const products = await Promise.all(cards.map(async (product) => ({
			...product,
			image: await availablePublicImage(product.image),
		})));
		return { status: 'ready', currency: settings.currency, products };
	} catch {
		return { status: 'error', currency: settings.currency, products: [] };
	}
}
