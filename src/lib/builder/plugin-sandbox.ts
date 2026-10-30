import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateWasmModuleBase64 } from './plugin-wasm.ts';

export type PluginSandboxErrorCode = 'sandbox_unavailable' | 'sandbox_busy' | 'sandbox_timeout' | 'sandbox_invalid_module' | 'sandbox_execution_failed';
export class PluginSandboxError extends Error {
	readonly code: PluginSandboxErrorCode;
	readonly status: number;
	constructor(code: PluginSandboxErrorCode, status: number, message: string) { super(message); this.name = 'PluginSandboxError'; this.code = code; this.status = status; }
}

// Only this host-owned bootstrap is interpreted as JavaScript. Uploaded bytes are
// compiled exclusively as import-free WebAssembly inside the isolated process.
const WORKER = String.raw`
'use strict';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', part => { input += part; if (input.length > 100000) process.exit(4); });
process.stdin.on('end', () => {
  try {
    if (!process.permission || process.permission.has('fs.read') || process.permission.has('fs.write') || process.permission.has('child') || process.permission.has('worker')) throw new Error('permission');
    const request = JSON.parse(input);
    const module = new WebAssembly.Module(Buffer.from(request.module, 'base64'));
    if (WebAssembly.Module.imports(module).length !== 0) throw new Error('imports');
    const instance = new WebAssembly.Instance(module, {});
    const run = instance.exports.run;
    if (typeof run !== 'function' || run.length !== 4) throw new Error('abi');
    const result = run(...request.inputs);
    if (typeof result !== 'number' || !Number.isInteger(result) || result < -2147483648 || result > 2147483647) throw new Error('result');
    process.stdout.write(JSON.stringify({ ok: true, value: result }));
  } catch { process.stdout.write(JSON.stringify({ ok: false })); }
});`;

// A private mount/user/PID/network namespace, read-only runtime libraries, an
// otherwise empty chroot, dropped capabilities and no-new-privileges are all
// required. There is deliberately no fallback to the application process.
const LAUNCH = String.raw`
set -eu
root="$1"
node_binary="$2"
worker="$3"
/usr/bin/mount --make-rprivate /
/usr/bin/mount -t tmpfs -o size=12m,nosuid,nodev tmpfs "$root"
mkdir -p "$root/bin" "$root/lib" "$root/lib64"
: > "$root/bin/node"
: > "$root/bin/setpriv"
/usr/bin/mount --bind "$node_binary" "$root/bin/node"
/usr/bin/mount -o remount,bind,ro "$root/bin/node"
/usr/bin/mount --bind /usr/bin/setpriv "$root/bin/setpriv"
/usr/bin/mount -o remount,bind,ro "$root/bin/setpriv"
/usr/bin/mount --bind /lib "$root/lib"
/usr/bin/mount -o remount,bind,ro "$root/lib"
/usr/bin/mount --bind /lib64 "$root/lib64"
/usr/bin/mount -o remount,bind,ro "$root/lib64"
exec /usr/bin/prlimit --as=1073741824:1073741824 --cpu=3:3 --fsize=0:0 --nofile=64:64 \
  /usr/sbin/chroot "$root" /bin/setpriv --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
  /bin/node --experimental-permission --max-old-space-size=32 -e "$worker"
`;

const MAX_PARALLEL = 2;
const TIMEOUT_MS = 2200;
let running = 0;

/** Execute a numeric plugin in a Linux OS sandbox, or fail closed if unavailable. */
export async function runSandboxedWasmProcessor(moduleBase64: string, inputs: number[]): Promise<number> {
	try { validateWasmModuleBase64(moduleBase64); } catch { throw new PluginSandboxError('sandbox_invalid_module', 422, 'ساختار ماژول افزونه معتبر نیست.'); }
	if (inputs.length !== 4 || inputs.some((n) => !Number.isInteger(n) || n < -2147483648 || n > 2147483647)) throw new PluginSandboxError('sandbox_invalid_module', 422, 'ورودی پردازشگر معتبر نیست.');
	if (process.platform !== 'linux') throw new PluginSandboxError('sandbox_unavailable', 503, 'محیط ایزولهٔ افزونه در این سامانه در دسترس نیست.');
	if (running >= MAX_PARALLEL) throw new PluginSandboxError('sandbox_busy', 429, 'محیط ایزوله مشغول است؛ کمی بعد دوباره تلاش کنید.');
	running++;
	let root: string | undefined;
	try {
		root = await mkdtemp(path.join(os.tmpdir(), 'novex-plugin-sandbox-'));
		return await new Promise<number>((resolve, reject) => {
			let stdout = '';
			let timedOut = false;
			let overflow = false;
			let settled = false;
			const child = spawn('/usr/bin/unshare', ['--user', '--map-root-user', '--mount', '--net', '--pid', '--fork', '--kill-child=SIGKILL', '/bin/sh', '-c', LAUNCH, 'novex-sandbox', root!, process.execPath, WORKER], {
				stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: { PATH: '/usr/bin:/bin', LANG: 'C' },
			});
			const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } } };
			const timer = setTimeout(() => { timedOut = true; kill(); }, TIMEOUT_MS);
			const finish = (error?: PluginSandboxError, value?: number) => {
				if (settled) return; settled = true; clearTimeout(timer);
				if (error) reject(error); else resolve(value!);
			};
			child.stdout.setEncoding('utf8');
			child.stdout.on('data', (chunk: string) => { stdout += chunk; if (stdout.length > 2048) { overflow = true; kill(); } });
			// Never expose sandbox startup diagnostics, paths or process output to clients.
			child.stderr.on('data', () => undefined);
			child.on('error', () => finish(new PluginSandboxError('sandbox_unavailable', 503, 'محیط ایزولهٔ افزونه در دسترس نیست.')));
			child.on('close', (code) => {
				if (timedOut) return finish(new PluginSandboxError('sandbox_timeout', 504, 'زمان اجرای افزونه تمام شد.'));
				if (code !== 0 || overflow) return finish(new PluginSandboxError('sandbox_unavailable', 503, 'راه‌اندازی ایمن افزونه ممکن نشد.'));
				let result: unknown; try { result = JSON.parse(stdout); } catch { return finish(new PluginSandboxError('sandbox_unavailable', 503, 'پاسخ محیط ایزوله معتبر نیست.')); }
				if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true || !('value' in result) || typeof result.value !== 'number' || !Number.isInteger(result.value) || result.value < -2147483648 || result.value > 2147483647) return finish(new PluginSandboxError('sandbox_execution_failed', 422, 'اجرای پردازشگر افزونه ممکن نشد.'));
				finish(undefined, result.value);
			});
			child.stdin.on('error', () => undefined);
			child.stdin.end(JSON.stringify({ module: moduleBase64, inputs }));
		});
	} catch (error) {
		if (error instanceof PluginSandboxError) throw error;
		throw new PluginSandboxError('sandbox_unavailable', 503, 'راه‌اندازی ایمن افزونه ممکن نشد.');
	} finally {
		running--;
		if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined);
	}
}
