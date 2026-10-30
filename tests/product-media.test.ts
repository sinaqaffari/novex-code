import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import type { ProductInput } from '../src/lib/commerce/products.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'novex-product-media-'));
const old = { blog: process.env.CMS_BLOG_DIR, assets: process.env.CMS_ASSETS_DIR, builder: process.env.BUILDER_DATA_FILE, commerce: process.env.COMMERCE_DB_FILE };
process.env.CMS_BLOG_DIR = path.join(root, 'blog');
process.env.CMS_ASSETS_DIR = path.join(root, 'assets');
process.env.BUILDER_DATA_FILE = path.join(root, 'builder.json');
process.env.COMMERCE_DB_FILE = path.join(root, 'commerce.json');
await mkdir(process.env.CMS_BLOG_DIR, { recursive: true });
const { saveUpload, deleteUpload, UPLOAD_DIR } = await import('../src/lib/cms/media.ts');
const { createProduct, updateProduct, deleteProduct, duplicateProduct } = await import('../src/lib/commerce/products.ts');
const { readDatabase, updateDatabase, DB_FILE } = await import('../src/lib/commerce/db.ts');
const { listBoundPublicProductCards } = await import('../src/lib/commerce/product-grid.ts');
after(async () => {
	for (const [key, value] of [['CMS_BLOG_DIR', old.blog], ['CMS_ASSETS_DIR', old.assets], ['BUILDER_DATA_FILE', old.builder], ['COMMERCE_DB_FILE', old.commerce]] as const) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	await rm(root, { recursive: true, force: true });
});

async function upload() {
	const png = await sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
	return saveUpload(new File([new Uint8Array(png)], 'product.png', { type: 'image/png' }));
}
function product(slug: string, image: string): ProductInput {
	return { name: slug, slug, sku: slug.toUpperCase(), price: 100, stock: 2, category: 'Test', description: '', image, status: 'active', featured: true };
}
const conflict = (error: unknown) => error instanceof Error && 'status' in error && error.status === 409;
const unavailable = (error: unknown) => error instanceof Error && 'status' in error && error.status === 503;

describe('coordinated product and media storage', () => {
	it('deletes an unused upload without creating a missing commerce database', async () => {
		const image = await upload();
		await deleteUpload(image.name);
		await assert.rejects(stat(DB_FILE), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
	});
	it('protects product images and allows removal once the reference is removed', async () => {
		const image = await upload();
		const created = await createProduct(product('product-media', image.publicUrl));
		await assert.rejects(deleteUpload(image.name), conflict);
		const copy = await duplicateProduct(created.id);
		await updateProduct(created.id, product('product-media', ''));
		await assert.rejects(deleteUpload(image.name), conflict);
		await deleteProduct(copy.id);
		await deleteUpload(image.name);
		await deleteProduct(created.id);
	});
	it('rejects newly missing local or known same-origin images and preserves genuine external images', async () => {
		await assert.rejects(createProduct(product('bad-local', '/media/uploads/missing.png')), conflict);
		await assert.rejects(createProduct(product('bad-absolute', 'https://shop.example/media/uploads/missing.png'), { origins: ['https://shop.example'] }), conflict);
		const external = await createProduct(product('external', 'https://other.example/media/uploads/missing.png'), { origins: ['https://shop.example'] });
		await deleteProduct(external.id);
	});
	it('prevents both orderings of a product-save versus delete race', async () => {
		for (const deleteFirst of [false, true]) {
			const image = await upload();
			const slug = deleteFirst ? 'product-delete-first' : 'product-write-first';
			const save = () => createProduct(product(slug, image.publicUrl));
			const remove = () => deleteUpload(image.name);
			const results = await Promise.allSettled(deleteFirst ? [remove(), save()] : [save(), remove()]);
			assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
			const created = (await readDatabase()).products.find((item) => item.slug === slug);
			if (created) {
				assert.ok((await stat(path.join(UPLOAD_DIR, image.name))).isFile());
				await deleteProduct(created.id); await deleteUpload(image.name);
			} else await assert.rejects(stat(path.join(UPLOAD_DIR, image.name)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
		}
	});
	it('keeps missing legacy images editable and renders managed legacy references in product grids', async () => {
		const image = await upload();
		const created = await createProduct(product('legacy-product', image.publicUrl));
		await updateDatabase((db) => { db.products.find((item) => item.id === created.id)!.image = `media://uploads/${image.name}`; });
		const cards = await listBoundPublicProductCards({ provider: 'novex-commerce-products', version: 1, selection: 'featured', limit: 4 });
		assert.equal(cards.find((card) => card.slug === created.slug)?.image, image.publicUrl);
		await assert.rejects(deleteUpload(image.name), conflict);
		await updateDatabase((db) => { db.products.find((item) => item.id === created.id)!.image = '/media/uploads/previously-missing.png'; });
		await updateProduct(created.id, { ...product('legacy-product', '/media/uploads/previously-missing.png'), description: 'Edited' });
		await assert.rejects(updateProduct(created.id, product('legacy-product', '/media/uploads/newly-missing.png')), conflict);
		await deleteProduct(created.id); await deleteUpload(image.name);
	});
	it('fails closed for corrupt and symlinked catalogs without changing their contents', async () => {
		const image = await upload();
		const original = await readFile(DB_FILE);
		await writeFile(DB_FILE, '{invalid');
		await assert.rejects(deleteUpload(image.name), unavailable);
		assert.equal(await readFile(DB_FILE, 'utf8'), '{invalid');
		await rm(DB_FILE); await writeFile(path.join(root, 'target'), original); await symlink(path.join(root, 'target'), DB_FILE);
		await assert.rejects(deleteUpload(image.name), unavailable);
		assert.ok((await lstat(DB_FILE)).isSymbolicLink());
		await rm(DB_FILE); await writeFile(DB_FILE, original);
		await deleteUpload(image.name);
	});
	it('preserves existing database permissions during an atomic update', async () => {
		await chmod(DB_FILE, 0o640);
		await updateDatabase((db) => { db.counters.order += 1; });
		assert.equal((await stat(DB_FILE)).mode & 0o777, 0o640);
	});
	it('serializes concurrent commerce writers and safe initialization across processes', async () => {
		const dir = await mkdtemp(path.join(root, 'processes-'));
		const db = path.join(dir, 'commerce.json'); const lock = path.join(dir, 'builder.json');
		const moduleUrl = pathToFileURL(path.resolve('src/lib/commerce/db.ts')).href;
		const writer = `import {updateDatabase} from ${JSON.stringify(moduleUrl)}; for (let i=0;i<8;i++) await updateDatabase(async db=>{ const n=db.counters.order; await new Promise(r=>setTimeout(r,2)); db.counters.order=n+1; });`;
		const reader = `import {readDatabase} from ${JSON.stringify(moduleUrl)}; for (let i=0;i<12;i++) await readDatabase();`;
		const run = (script: string) => new Promise<void>((resolve, reject) => {
			const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { env: { ...process.env, COMMERCE_DB_FILE: db, BUILDER_DATA_FILE: lock, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
			let error = ''; child.stderr.on('data', (chunk) => { error += String(chunk); });
			child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error)));
		});
		await Promise.all([run(writer), run(writer), run(writer), run(reader), run(reader)]);
		const data = JSON.parse(await readFile(db, 'utf8')) as { counters: { order: number } };
		assert.equal(data.counters.order, 24);
		assert.deepEqual((await readdir(dir)).sort(), ['commerce.json']);
	});
});
