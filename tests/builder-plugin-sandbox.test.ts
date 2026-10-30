import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import wabtInit from 'wabt';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../src/lib/builder/operations.ts';
import { validateDeclarativePluginPackage } from '../src/lib/builder/declarative-plugin-package.ts';
import { validateWasmModuleBase64 } from '../src/lib/builder/plugin-wasm.ts';
import { PluginSandboxError, runSandboxedWasmProcessor } from '../src/lib/builder/plugin-sandbox.ts';
import { changeDeclarativePluginPackage, installDeclarativePluginPackage, listDeclarativePluginPackages } from '../src/lib/builder/store.ts';

const wabt = await wabtInit();
function wasm(source: string): string {
	const module = wabt.parseWat('test.wat', source);
	try { return Buffer.from(module.toBinary({}).buffer).toString('base64'); } finally { module.destroy(); }
}
const multiply = wasm('(module (func (export "run") (param i32 i32 i32 i32) (result i32) local.get 0 local.get 1 i32.mul))');
const infinite = wasm('(module (func (export "run") (param i32 i32 i32 i32) (result i32) (loop br 0) i32.const 0))');
function plugin(moduleBase64 = multiply) {
	let document = addNode(createEmptyPageDocument('processor-preset'), 'Heading', { id: 'node_calc_heading' });
	document = updateNodeProps(document, 'node_calc_heading', { text: 'محاسبه' });
	return {
		schemaVersion: 3, id: 'data-calc', name: 'محاسبه', version: '1.0.0', description: '', components: [],
		presets: [{ id: 'data-calc-result', label: 'نتیجه', description: '', document, parameters: [{ key: 'result', label: 'نتیجه', nodeId: 'node_calc_heading', property: 'text', defaultValue: '', maxLength: 100 }] }],
		processors: [{ id: 'data-calc-multiply', label: 'ضرب', description: 'محاسبهٔ دو عدد', presetId: 'data-calc-result', outputParameter: 'result', prefix: 'نتیجه: ', suffix: '', inputs: [{ key: 'first', label: 'عدد اول', min: 0, max: 100, defaultValue: 3 }, { key: 'second', label: 'عدد دوم', min: 0, max: 100, defaultValue: 2 }], moduleBase64 }],
	};
}
async function isolated(run: () => Promise<void>) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-sandbox-tests-'));
	const previous = process.env.BUILDER_DATA_FILE;
	process.env.BUILDER_DATA_FILE = path.join(dir, 'builder.json');
	try { await run(); } finally { if (previous === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = previous; await rm(dir, { recursive: true, force: true }); }
}
function request(input: unknown): Request { return new Request('http://local/cms/api/builder/plugin-processors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); }

describe('isolated numeric plugin runtime', () => {
	it('accepts only bounded import-free modules and forbids JS, start functions, tables and unsafe memory', () => {
		assert.equal(validateWasmModuleBase64(multiply), multiply);
		for (const source of [
			'(module (import "env" "fetch" (func)) (func (export "run") (param i32 i32 i32 i32) (result i32) i32.const 0))',
			'(module (table 1 2 funcref) (func (export "run") (param i32 i32 i32 i32) (result i32) i32.const 0))',
			'(module (func $start) (start $start) (func (export "run") (param i32 i32 i32 i32) (result i32) i32.const 0))',
			'(module (memory 1) (func (export "run") (param i32 i32 i32 i32) (result i32) i32.const 0))',
			'(module (memory 1 5) (func (export "run") (param i32 i32 i32 i32) (result i32) i32.const 0))',
		]) assert.throws(() => validateWasmModuleBase64(wasm(source)));
		assert.throws(() => validateWasmModuleBase64(Buffer.from('require("node:fs")').toString('base64')));
		assert.throws(() => validateWasmModuleBase64(`${multiply}  `));
		assert.throws(() => validateWasmModuleBase64(Buffer.alloc(65537).toString('base64')));
		assert.equal(validateDeclarativePluginPackage(plugin()).processors?.length, 1);
		assert.throws(() => validateDeclarativePluginPackage({ ...plugin(), javascript: 'require("fs")' }));
		assert.throws(() => validateDeclarativePluginPackage({ ...plugin(), processors: [{ ...plugin().processors[0], code: 'evil' }] }));
		assert.throws(() => validateDeclarativePluginPackage({ ...plugin(), processors: [{ ...plugin().processors[0], presetId: 'foreign' }] }));
		assert.throws(() => validateDeclarativePluginPackage({ ...plugin(), processors: [{ ...plugin().processors[0], inputs: [{ key: 'a', label: 'A', min: 2, max: 1, defaultValue: 1 }] }] }));
	});
	it('runs a calculation inside the OS sandbox and terminates infinite work', { timeout: 10_000 }, async (t) => {
		try { assert.equal(await runSandboxedWasmProcessor(multiply, [6, 7, 0, 0]), 42); }
		catch (error) {
			if (error instanceof PluginSandboxError && error.code === 'sandbox_unavailable' && process.env.NOVEX_EXPECT_WASM_SANDBOX !== '1') { t.skip('OS isolation is unavailable; execution correctly failed closed'); return; }
			throw error;
		}
		await assert.rejects(runSandboxedWasmProcessor(infinite, [0, 0, 0, 0]), (error: unknown) => error instanceof PluginSandboxError && error.code === 'sandbox_timeout');
		const wrongAbi = wasm('(module (func (export "run") (param i32) (result i32) i32.const 0))');
		await assert.rejects(runSandboxedWasmProcessor(wrongAbi, [0, 0, 0, 0]), (error: unknown) => error instanceof PluginSandboxError && error.code === 'sandbox_execution_failed');
		const trap = wasm('(module (func (export "run") (param i32 i32 i32 i32) (result i32) unreachable))');
		await assert.rejects(runSandboxedWasmProcessor(trap, [0, 0, 0, 0]), (error: unknown) => error instanceof PluginSandboxError && error.code === 'sandbox_execution_failed');
	});
	it('authorizes installed active versions, validates inputs and returns only a native fragment', { timeout: 10_000 }, async (t) => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/plugin-processors.ts');
		await installDeclarativePluginPackage(plugin(), 'install');
		const payload = { packageId: 'data-calc', processorId: 'data-calc-multiply', expectedRevision: 1, inputs: { first: 9, second: 7 }, confirm: true };
		const call = (body: unknown, role = 'editor') => POST({ locals: { cmsUser: { role } }, request: request(body) } as never);
		assert.equal((await call(payload, 'subscriber')).status, 403);
		assert.equal((await call({ ...payload, confirm: false })).status, 400);
		assert.equal((await call({ ...payload, moduleBase64: multiply })).status, 400);
		assert.equal((await call({ ...payload, inputs: { first: 101, second: 7 } })).status, 422);
		assert.equal((await call({ ...payload, inputs: { first: 4, second: 7, extra: 1 } })).status, 422);
		assert.equal((await call({ ...payload, expectedRevision: 2 })).status, 409);
		const response = await call(payload);
		if (response.status === 503 && process.env.NOVEX_EXPECT_WASM_SANDBOX !== '1') { t.skip('OS isolation is unavailable; execution correctly failed closed'); return; }
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(body.ok, true);
		assert.equal(body.document.nodes[0].type, 'Heading');
		assert.equal(body.document.nodes[0].props.text, 'نتیجه: 63');
		assert.doesNotMatch(JSON.stringify(body.document), /moduleBase64|WebAssembly|javascript/);
		await changeDeclarativePluginPackage('data-calc', 1, false);
		assert.equal((await call(payload)).status, 409);
		assert.equal((await listDeclarativePluginPackages())[0].active, false);
	}));
});
