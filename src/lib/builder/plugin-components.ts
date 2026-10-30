import { normalizeProps } from './registry.ts';
import type { PluginBlockProps } from './types.ts';

export type PluginRenderPart = { type: 'heading'; text: string } | { type: 'text'; text: string } | { type: 'button'; text: string; href: string };

/** Resolve a validated, persisted snapshot using host-owned display primitives only. */
export function resolvePluginParts(input: PluginBlockProps): PluginRenderPart[] {
	const props = normalizeProps('PluginBlock', input);
	const values = new Map(props.fields.map((field) => [field.key, field.value]));
	return props.parts.map((part) => part.type === 'button'
		? { type: 'button', text: values.get(part.textKey)!, href: values.get(part.hrefKey!)! }
		: { type: part.type, text: values.get(part.textKey)! });
}

/** Reject malformed contributions individually; duplicate plugin/component identities fail closed. */
export function collectPluginComponents(value: unknown): { components: PluginBlockProps[]; rejected: number } {
	if (!Array.isArray(value)) return { components: [], rejected: 1 };
	const components: PluginBlockProps[] = [];
	const ids = new Set<string>();
	let rejected = Math.max(0, value.length - 50);
	for (const item of value.slice(0, 50)) {
		try {
			const props = normalizeProps('PluginBlock', item);
			const id = `${props.pluginId}/${props.componentId}`;
			if (ids.has(id)) throw new Error('Duplicate plugin component.');
			ids.add(id); components.push(props);
		} catch { rejected++; }
	}
	return { components, rejected };
}

/** Enforce registration ownership and the active manifest version on new contributions. */
export function collectOwnedPluginComponents(
	contributions: ReadonlyArray<{ owner: string; value: unknown }>,
	manifestVersion: (owner: string) => string | undefined,
): { components: PluginBlockProps[]; rejected: number } {
	const components: PluginBlockProps[] = [];
	const ids = new Set<string>();
	let rejected = Math.max(0, contributions.length - 500);
	for (const contribution of contributions.slice(0, 500)) {
		try {
			const props = normalizeProps('PluginBlock', contribution.value);
			const version = manifestVersion(contribution.owner);
			if (!version || props.pluginId !== contribution.owner || props.pluginVersion !== version) throw new Error('Plugin ownership or version mismatch.');
			const id = `${props.pluginId}/${props.componentId}`;
			if (ids.has(id)) throw new Error('Duplicate plugin component.');
			if (components.length >= 50) throw new Error('Component limit reached.');
			ids.add(id);
			components.push(props);
		} catch { rejected++; }
	}
	return { components, rejected };
}
