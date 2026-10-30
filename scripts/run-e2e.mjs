import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'novex-code-e2e-'));
const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const uploadLog = path.join(dataDirectory, 'test-uploads.txt');
// Blog writes in browser tests must never touch the user's source content.
await cp(path.join(root, 'src/content/blog'), path.join(dataDirectory, 'blog'), { recursive: true });
// Serve bundled fixtures from a private asset directory. Tests never create or
// clean up files in the user's media library, including content-addressed kits.
await mkdir(path.join(dataDirectory, 'assets', 'uploads'), { recursive: true });
for (const name of ['blog-placeholder-1.jpg', 'blog-placeholder-2.jpg', 'blog-placeholder-3.jpg', 'blog-placeholder-4.jpg', 'blog-placeholder-5.jpg', 'blog-placeholder-about.jpg']) {
	await cp(path.join(root, 'src/assets', name), path.join(dataDirectory, 'assets', name));
}

// The browser suite uses one clearly labelled fixture product in its isolated data directory.
await writeFile(path.join(dataDirectory, 'commerce.json'), `${JSON.stringify({
	version: 1,
	counters: { order: 0 },
	products: [{
		id: 'e2e_product_internal_id',
		name: 'محصول آزمایشی',
		slug: 'e2e-test-product',
		sku: 'E2E-TEST-ONLY',
		price: 123000,
		compareAtPrice: 150000,
		stock: 2,
		category: 'دستهٔ آزمایشی',
		description: 'این محصول فقط در داده‌های موقت آزمون مرورگر وجود دارد.',
		image: '/media/blog-placeholder-1.jpg',
		status: 'active',
		featured: true,
		createdAt: '2026-10-28T12:00:00.000Z',
		updatedAt: '2026-10-28T12:00:00.000Z',
	}, {
		id: 'e2e_draft_internal_id',
		name: 'پیش‌نویس آزمایشی',
		slug: 'e2e-draft-product',
		sku: 'E2E-DRAFT-ONLY',
		price: 1,
		stock: 1,
		category: 'آزمایش',
		description: '',
		image: '',
		status: 'draft',
		featured: true,
		createdAt: '2026-10-28T12:00:00.000Z',
		updatedAt: '2026-10-28T12:00:00.000Z',
	}],
	orders: [],
	customers: [],
	discounts: [],
}, null, 2)}\n`, { mode: 0o600 });
const args = process.argv.slice(2);

try {
	const child = spawn(process.execPath, [cli, 'test', ...args], {
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, NOVEX_E2E_DATA_DIR: dataDirectory, NOVEX_E2E_UPLOAD_LOG: uploadLog },
	});
	const result = await new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	if (result.signal) process.exitCode = 1;
	else process.exitCode = result.code ?? 1;
} finally {
	await rm(dataDirectory, { recursive: true, force: true });
}
