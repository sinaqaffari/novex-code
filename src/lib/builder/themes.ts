import { BUILDER_THEME_IDS, type BuilderThemeId } from './types.ts';

export interface BuilderTheme {
	id: BuilderThemeId;
	label: string;
	description: string;
	variables: Readonly<Record<string, string>>;
}

export const BUILDER_THEMES: Record<BuilderThemeId, BuilderTheme> = {
	site: {
		id: 'site',
		label: 'هماهنگ با سایت',
		description: 'رنگ‌های اصلی طراحی فعلی نووکس.',
		variables: {},
	},
	ocean: {
		id: 'ocean',
		label: 'اقیانوس',
		description: 'آبی عمیق با سطح‌های خنک.',
		variables: {
			'--brand': '#087f8c',
			'--brand-hover': '#06636d',
			'--brand-soft': '#e4f5f5',
			'--brand-ink': '#06636d',
			'--brand-line': '#b6e1e4',
			'--ink': '#15333a',
			'--ink-soft': '#3a5960',
			'--muted': '#647f84',
			'--surface-2': '#eef6f6',
		},
	},
	warm: {
		id: 'warm',
		label: 'خاکی',
		description: 'رنگ‌های گرم و آرام برای صفحه‌های معرفی.',
		variables: {
			'--brand': '#a44d2d',
			'--brand-hover': '#813b23',
			'--brand-soft': '#fcf0e8',
			'--brand-ink': '#813b23',
			'--brand-line': '#eed0bd',
			'--ink': '#2e241e',
			'--ink-soft': '#5a493d',
			'--muted': '#79695d',
			'--surface-2': '#faf3ec',
		},
	},
};

export const BUILDER_THEME_LIST = BUILDER_THEME_IDS.map((id) => BUILDER_THEMES[id]);

export function themeVariables(themeId: BuilderThemeId): Readonly<Record<string, string>> {
	return BUILDER_THEMES[themeId].variables;
}

export function themeStyleText(themeId: BuilderThemeId): string | undefined {
	const entries = Object.entries(themeVariables(themeId));
	return entries.length ? entries.map(([name, value]) => `${name}:${value}`).join(';') : undefined;
}

export function isBuilderThemeId(value: unknown): value is BuilderThemeId {
	return typeof value === 'string' && (BUILDER_THEME_IDS as readonly string[]).includes(value);
}
