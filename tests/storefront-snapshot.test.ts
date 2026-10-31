import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hydrateCart } from '../src/lib/commerce/cart.ts';
import { createEmptyDatabase } from '../src/lib/commerce/db.ts';
import { getProduct, listProducts } from '../src/lib/commerce/products.ts';
import type { Product } from '../src/lib/commerce/types.ts';

function product(id: string, status: Product['status'], stock: number): Product {
	return { id, name: `کالای ${id}`, slug: `test-${id}`, sku: id, category: 'آزمایش', description: '', image: '', price: 500, stock, status, featured: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
}

describe('storefront request snapshots', () => {
	it('hydrates cart and product listings from the same supplied read-only snapshot', async () => {
		const db = createEmptyDatabase();
		db.products = [product('one', 'active', 2), product('draft', 'draft', 10), product('out', 'active', 0)];
		const cart = await hydrateCart([{ productId: 'one', quantity: 8 }, { productId: 'draft', quantity: 1 }, { productId: 'out', quantity: 1 }], db);
		assert.equal(cart.count, 2);
		assert.equal(cart.subtotal, 1000);
		assert.deepEqual(cart.lines.map((line) => line.product.id), ['one']);
		const listing = await listProducts({ status: 'active' }, db);
		assert.deepEqual(listing.items.map((item) => item.id).sort(), ['one', 'out']);
		assert.equal((await getProduct('test-one', db))?.id, 'one');
		assert.deepEqual(await hydrateCart([], db), { lines: [], subtotal: 0, count: 0 });
		assert.equal(db.products[0].stock, 2);
	});
});
