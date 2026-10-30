import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolvePluginLoadOrder } from '../src/lib/plugins/dependencies.ts';
import { addFilter, collectOwnedBuilderComponents, removePluginHooks } from '../src/lib/plugins/hooks.ts';

describe('plugin dependency lifecycle planning', () => {
	it('orders active dependencies ahead of dependents', () => {
		const plan = resolvePluginLoadOrder([{ id: 'z-base' }, { id: 'a-dependent', requiresPlugins: ['z-base'] }], ['a-dependent', 'z-base']);
		assert.deepEqual(plan.order, ['z-base', 'a-dependent']);
		assert.deepEqual(plan.issues, []);
	});
	it('rejects missing, disabled and cyclic dependencies without blocking unrelated plugins', () => {
		const plan = resolvePluginLoadOrder([
			{ id: 'a', requiresPlugins: ['b'] }, { id: 'b', requiresPlugins: ['a'] },
			{ id: 'c', requiresPlugins: ['disabled'] }, { id: 'disabled' }, { id: 'ok' },
		], ['a', 'b', 'c', 'ok']);
		assert.deepEqual(plan.order, ['ok']);
		assert.ok(plan.issues.some((issue) => issue.pluginId === 'a' && issue.code === 'dependency_cycle'));
		assert.ok(plan.issues.some((issue) => issue.pluginId === 'b' && issue.code === 'dependency_cycle'));
		assert.ok(plan.issues.some((issue) => issue.pluginId === 'c' && issue.code === 'missing_dependency'));
	});
	it('validates contributions for the activating owner without executing peer hooks', async () => {
		let peerInvocations = 0;
		try {
			addFilter('builder.components', () => [{ id: 'one' }], 10, 'one');
			addFilter('builder.components', () => { peerInvocations++; return []; }, 10, 'peer');
			const result = await collectOwnedBuilderComponents('one');
			assert.equal(result.contributions.length, 1);
			assert.equal(result.contributions[0].owner, 'one');
			assert.equal(peerInvocations, 0);
		} finally { removePluginHooks('one'); removePluginHooks('peer'); }
	});
});
