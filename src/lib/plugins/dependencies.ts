/** Dependency planning for trusted bundled extensions. Nothing is auto-installed or executed here. */
export interface PluginDependencyEntry { id: string; requiresPlugins?: readonly string[] }
export interface PluginDependencyIssue {
	pluginId: string;
	code: 'missing_dependency' | 'dependency_cycle' | 'dependency_failed';
	dependency?: string;
}
export interface PluginDependencyPlan { order: string[]; issues: PluginDependencyIssue[] }

export function resolvePluginLoadOrder(entries: readonly PluginDependencyEntry[], activeIds: readonly string[]): PluginDependencyPlan {
	const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
	const active = new Set(activeIds);
	const state = new Map<string, 'visiting' | 'done' | 'failed'>();
	const stack: string[] = [];
	const order: string[] = [];
	const issues: PluginDependencyIssue[] = [];
	const report = (issue: PluginDependencyIssue) => {
		if (!issues.some((item) => item.pluginId === issue.pluginId && item.code === issue.code && item.dependency === issue.dependency)) issues.push(issue);
	};
	function visit(id: string): boolean {
		const known = state.get(id);
		if (known === 'done') return true;
		if (known === 'failed') return false;
		if (known === 'visiting') {
			for (const member of stack.slice(stack.indexOf(id))) report({ pluginId: member, code: 'dependency_cycle' });
			return false;
		}
		const entry = entriesById.get(id);
		if (!entry) { report({ pluginId: id, code: 'missing_dependency', dependency: id }); state.set(id, 'failed'); return false; }
		state.set(id, 'visiting'); stack.push(id);
		let valid = true;
		for (const dependency of entry.requiresPlugins ?? []) {
			if (!active.has(dependency) || !entriesById.has(dependency)) {
				report({ pluginId: id, code: 'missing_dependency', dependency }); valid = false;
			} else if (!visit(dependency)) {
				if (!issues.some((issue) => issue.pluginId === id && issue.code === 'dependency_cycle')) report({ pluginId: id, code: 'dependency_failed', dependency });
				valid = false;
			}
		}
		stack.pop();
		state.set(id, valid ? 'done' : 'failed');
		if (valid) order.push(id);
		return valid;
	}
	for (const id of [...active].sort()) visit(id);
	return { order, issues };
}
