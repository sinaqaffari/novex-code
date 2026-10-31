import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'novex-code-unit-'));
try {
	const assets = path.join(temp, 'assets');
	const blog = path.join(temp, 'blog');
	await mkdir(path.join(assets, 'uploads'), { recursive: true });
	await mkdir(blog, { recursive: true });
	// Copy only bundled fixtures; never touch or copy a user's uploads.
	for (const name of ['blog-placeholder-1.jpg', 'blog-placeholder-2.jpg', 'blog-placeholder-3.jpg', 'blog-placeholder-4.jpg', 'blog-placeholder-5.jpg', 'blog-placeholder-about.jpg']) {
		await cp(path.join(root, 'src/assets', name), path.join(assets, name));
	}
	const suites = (await Promise.all(['tests', 'tests/e2e'].map(async (dir) =>
		(await readdir(path.join(root, dir))).filter((name) => name.endsWith('.test.ts')).sort().map((name) => path.join(dir, name)),
	))).flat();
	const args = process.argv.slice(2);
	const requestedFiles = args.filter((arg) => arg.endsWith('.test.ts'));
	const options = args.filter((arg) => !arg.endsWith('.test.ts'));
	const env = {
		...process.env,
		BUILDER_DATA_FILE: path.join(temp, 'builder.json'),
		CMS_BLOG_DIR: blog,
		CMS_ASSETS_DIR: assets,
		COMMERCE_DB_FILE: path.join(temp, 'commerce.json'),
		CMS_SETTINGS_FILE: path.join(temp, 'cms-settings.json'),
		CMS_USERS_FILE: path.join(temp, 'users.json'),
		PLUGIN_STATE_FILE: path.join(temp, 'plugins.json'),
	};
	delete env.SITE_URL;
	delete env.NOVEX_BACKEND_URL;
	delete env.NOVEX_BACKEND_TOKEN;
	delete env.NOVEX_COMMERCE_STORE;
	delete env.NOVEX_BUILDER_STORE;
	const child = spawn(process.execPath, ['--experimental-strip-types', '--test', ...options, ...(requestedFiles.length ? requestedFiles : suites)], { cwd: root, env, stdio: 'inherit' });
	const result = await new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	process.exitCode = result.signal ? 1 : (result.code ?? 1);
} finally {
	await rm(temp, { recursive: true, force: true });
}
