import type { InspectorField } from './types.ts';

/** UI visibility only. Switching modes must not transform the document. */
export function fieldVisibleInMode(field: InspectorField, mode: 'simple' | 'pro'): boolean {
	return mode === 'pro' || !field.key.startsWith('styles.');
}
