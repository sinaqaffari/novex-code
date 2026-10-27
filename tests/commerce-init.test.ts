import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('commerce store initialization', () => {
	it('coalesces concurrent first reads without losing the initial database file', () => {
		const directory = mkdtempSync(join(tmpdir(), 'novex-commerce-init-'));
		const databaseFile = join(directory, 'commerce.json');
		const moduleUrl = new URL('../src/lib/commerce/db.ts', import.meta.url).href;
		const script = `
			import assert from 'node:assert/strict';
			import { readDatabase } from ${JSON.stringify(moduleUrl)};
			const snapshots = await Promise.all(Array.from({ length: 24 }, () => readDatabase()));
			assert.ok(snapshots.every((db) => db.products.length === 0 && db.orders.length === 0));
		`;

		try {
			execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
				cwd: process.cwd(),
				env: { ...process.env, COMMERCE_DB_FILE: databaseFile },
				encoding: 'utf8',
				timeout: 10_000,
			});

			assert.deepEqual(JSON.parse(readFileSync(databaseFile, 'utf8')), {
				version: 1,
				counters: { order: 0 },
				products: [],
				orders: [],
				customers: [],
				discounts: [],
			});
			assert.deepEqual(readdirSync(directory), ['commerce.json']);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
