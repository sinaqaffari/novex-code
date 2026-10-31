import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretsDir = path.join(root, '.novex-secrets');
const files = [path.join(secretsDir, 'postgres-password'), path.join(secretsDir, 'backend-token')];
const action = process.argv[2] ?? 'up';
if (!['up', 'down', 'dev', 'migrate-commerce', 'export-commerce', 'docker-migrate-commerce', 'docker-export-commerce', 'migrate-builder', 'export-builder', 'docker-migrate-builder', 'docker-export-builder'].includes(action)) throw new Error('Unsupported full-stack action.');
if (['migrate-commerce', 'docker-migrate-commerce', 'migrate-builder', 'docker-migrate-builder'].includes(action)) {
	const options = process.argv.slice(3);
	if (!options.includes('--confirm-offline') || options.some((item) => !['--confirm-offline', '--allow-empty'].includes(item))) throw new Error('Stop all app instances and pass --confirm-offline; --allow-empty is optional.');
	if (action === 'migrate-commerce' && !process.env.COMMERCE_DB_FILE?.trim()) throw new Error('Set COMMERCE_DB_FILE to the exact local store file before migrating.');
	if (action === 'migrate-builder' && !process.env.BUILDER_DATA_FILE?.trim()) throw new Error('Set BUILDER_DATA_FILE to the exact local builder file before migrating.');
}
if (action === 'export-commerce' && (!process.env.COMMERCE_DB_FILE?.trim() || process.argv.length !== 5 || process.argv[3] !== '--output' || !path.isAbsolute(process.argv[4]))) throw new Error('Set COMMERCE_DB_FILE and pass --output with an absolute, new file path.');
if (action === 'export-builder' && (!process.env.BUILDER_DATA_FILE?.trim() || process.argv.length !== 5 || process.argv[3] !== '--output' || !path.isAbsolute(process.argv[4]))) throw new Error('Set BUILDER_DATA_FILE and pass --output with an absolute, new file path.');
if ((action === 'docker-export-commerce' || action === 'docker-export-builder') && (process.argv.length !== 5 || process.argv[3] !== '--output' || !/^\/app\/data\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.json$/.test(process.argv[4]) || process.argv[4].includes('..'))) throw new Error('Pass --output with a new JSON filename inside /app/data.');
async function verifyDirectory() {
	try {
		const entry = await lstat(secretsDir);
		if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Secret path must be a real directory, not a symlink.');
	} catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function readSecret(file) {
	let handle;
	try {
		handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const entry = await handle.stat();
		if (!entry.isFile() || (entry.mode & 0o077) !== 0) throw new Error('Secret files must be private regular files (mode 0600).');
		return await handle.readFile('utf8');
	} catch (error) { if (error.code === 'ENOENT') return null; throw error; }
	finally { if (handle) await handle.close(); }
}
let password = process.env.POSTGRES_PASSWORD;
let token = process.env.NOVEX_BACKEND_TOKEN;
if (Boolean(password) !== Boolean(token)) throw new Error('Set both POSTGRES_PASSWORD and NOVEX_BACKEND_TOKEN, or neither.');
if (!password || !token) {
	await verifyDirectory();
	const found = await Promise.all(files.map(readSecret));
	if (found.some(Boolean) && !found.every(Boolean)) throw new Error('One full-stack secret is missing. Restore it from backup; existing database credentials must not be reset.');
	if (found.every(Boolean)) [password, token] = found.map((value) => value.trim());
	else {
		if (action === 'down' || action === 'export-commerce' || action === 'docker-export-commerce' || action === 'export-builder' || action === 'docker-export-builder') throw new Error('Full-stack secrets were not found; refusing to change existing volumes.');
		await mkdir(secretsDir, { recursive: true, mode: 0o700 });
		await verifyDirectory();
		const values = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
		for (let index = 0; index < files.length; index++) {
			const handle = await open(files[index], 'wx', 0o600);
			try { await handle.writeFile(`${values[index]}\n`, 'utf8'); } finally { await handle.close(); }
		}
		[password, token] = values;
		console.log('Created private full-stack secrets in .novex-secrets. Back up this directory securely.');
	}
}
if (!password || password.length < 32 || !token || token.length < 32) throw new Error('Full-stack credentials are invalid.');
const portText = process.env.NOVEX_BACKEND_PORT || '8081';
if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw new Error('NOVEX_BACKEND_PORT must be a valid TCP port.');
const childEnv = { ...process.env, POSTGRES_PASSWORD: password, NOVEX_BACKEND_TOKEN: token, NOVEX_BACKEND_PORT: portText };
const args = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.fullstack.yml'];
if (action === 'dev' || action === 'migrate-commerce' || action === 'migrate-builder') args.push('-f', 'docker-compose.local-backend.yml');
args.push(action === 'down' ? 'down' : 'up');
if (action !== 'down') args.push('--build', '-d'); // down intentionally never removes volumes.
if (action === 'dev' || action === 'migrate-commerce' || action === 'migrate-builder') args.push('backend'); // Start only Go and PostgreSQL; local Astro keeps its existing files.
async function run(command, commandArgs, env) {
	const child = spawn(command, commandArgs, { cwd: root, env, stdio: 'inherit' });
	const forwardInt = () => child.kill('SIGINT');
	const forwardTerm = () => child.kill('SIGTERM');
	process.on('SIGINT', forwardInt);
	process.on('SIGTERM', forwardTerm);
	try {
		return await new Promise((resolve, reject) => {
			child.once('error', reject);
			child.once('exit', (code, signal) => resolve({ code, signal }));
		});
	} finally { process.off('SIGINT', forwardInt); process.off('SIGTERM', forwardTerm); }
}
const devEnv = { ...childEnv, NOVEX_BACKEND_URL: `http://127.0.0.1:${portText}` };
delete devEnv.POSTGRES_PASSWORD; // Astro needs only the internal API token, never the database password.
const compose = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.fullstack.yml'];
async function runningDockerApp() {
	const child = spawn('docker', [...compose, 'ps', '--services', '--status', 'running', 'app'], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'inherit'] });
	let output = '';
	child.stdout.on('data', (chunk) => { output += chunk.toString(); });
	const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
	if (result.signal || result.code !== 0) throw new Error('Could not verify whether the Docker app is stopped.');
	return Boolean(output.trim());
}
if (action === 'docker-migrate-commerce' || action === 'docker-migrate-builder') {
	if (await runningDockerApp()) throw new Error('Stop the Docker app first with npm run docker:fullstack:down; its volumes will be retained.');
	const started = await run('docker', [...compose, 'up', '--build', '-d', 'backend'], childEnv);
	if (started.signal || started.code !== 0) process.exitCode = started.code || 1;
	else {
		const builder = action === 'docker-migrate-builder';
		const result = await run('docker', [...compose, 'run', '--rm', '--no-deps', '--build', '--entrypoint', 'node', '-e', builder ? 'BUILDER_DATA_FILE=/app/data/builder-pages.json' : 'COMMERCE_DB_FILE=/app/data/commerce.json', 'app', '--experimental-strip-types', builder ? 'scripts/migrate-builder.ts' : 'scripts/migrate-commerce.ts', ...process.argv.slice(3)], childEnv);
		process.exitCode = result.signal ? 1 : (result.code ?? 1);
	}
} else if (action === 'docker-export-commerce' || action === 'docker-export-builder') {
	const builder = action === 'docker-export-builder';
	const result = await run('docker', [...compose, 'run', '--rm', '--no-deps', '--build', '--entrypoint', 'node', '-e', builder ? 'BUILDER_DATA_FILE=/app/data/builder-pages.json' : 'COMMERCE_DB_FILE=/app/data/commerce.json', '-e', builder ? 'NOVEX_BUILDER_STORE=postgres' : 'NOVEX_COMMERCE_STORE=postgres', 'app', '--experimental-strip-types', builder ? 'scripts/export-builder.ts' : 'scripts/export-commerce.ts', ...process.argv.slice(3)], childEnv);
	process.exitCode = result.signal ? 1 : (result.code ?? 1);
} else if (action === 'export-commerce' || action === 'export-builder') {
	// Backups use the already-running local backend and never restart containers.
	const builder = action === 'export-builder';
	if (builder) devEnv.NOVEX_BUILDER_STORE = 'postgres'; else devEnv.NOVEX_COMMERCE_STORE = 'postgres';
	const result = await run(process.execPath, ['--experimental-strip-types', builder ? 'scripts/export-builder.ts' : 'scripts/export-commerce.ts', ...process.argv.slice(3)], devEnv);
	process.exitCode = result.signal ? 1 : (result.code ?? 1);
} else {
	const composeResult = await run('docker', args, childEnv);
	if (composeResult.signal || composeResult.code !== 0) process.exitCode = composeResult.code || 1;
	else if (action === 'dev' || action === 'migrate-commerce' || action === 'migrate-builder') {
		let result;
		if (action === 'dev') {
			console.log('Go and PostgreSQL are running; Astro will use your configured local CMS and shop stores.');
			const devHost = process.env.NOVEX_DEV_HOST || '0.0.0.0';
			result = await run('npm', ['run', 'dev', '--', '--host', devHost, ...process.argv.slice(3)], devEnv);
		} else {
			result = await run(process.execPath, ['--experimental-strip-types', action === 'migrate-builder' ? 'scripts/migrate-builder.ts' : 'scripts/migrate-commerce.ts', ...process.argv.slice(3)], devEnv);
		}
		process.exitCode = result.signal ? 1 : (result.code ?? 1);
	}
}
