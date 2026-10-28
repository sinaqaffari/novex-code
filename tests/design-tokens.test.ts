import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BUILDER_THEMES, themeStyleText, themeVariables } from '../src/lib/builder/themes.ts';
import type { BuilderThemeId } from '../src/lib/builder/types.ts';

describe('Design tokens and themes', () => {
	it('exposes all registered theme IDs with variables', () => {
		const ids: BuilderThemeId[] = ['site', 'ocean', 'warm'];
		for (const id of ids) {
			const theme = BUILDER_THEMES[id];
			assert.equal(theme.id, id);
			assert.ok(theme.label);
			assert.ok(theme.description);
			assert.ok(theme.variables);
		}
	});

	it('site theme uses no custom variables (inherits site design system)', () => {
		const variables = themeVariables('site');
		assert.deepEqual(variables, {});
	});

	it('ocean theme provides brand-aligned CSS variables', () => {
		const text = themeStyleText('ocean');
		assert.ok(text);
		assert.match(text, /--brand:#087f8c/);
		assert.match(text, /--ink:#15333a/);
	});

	it('warm theme provides brand-aligned CSS variables', () => {
		const text = themeStyleText('warm');
		assert.ok(text);
		assert.match(text, /--brand:#a44d2d/);
		assert.match(text, /--ink:#2e241e/);
	});

	it('themeStyleText returns undefined for a theme without variables', () => {
		assert.equal(themeStyleText('site'), undefined);
	});

	it('theme variables are valid CSS declarations', () => {
		for (const theme of Object.values(BUILDER_THEMES)) {
			const text = themeStyleText(theme.id as BuilderThemeId);
			if (text) {
				const declarations = text.split(';').filter(Boolean);
				for (const decl of declarations) {
					assert.match(decl, /^--[a-zA-Z0-9-]+:/, `invalid declaration in ${theme.id}: ${decl}`);
				}
			}
		}
	});
});
