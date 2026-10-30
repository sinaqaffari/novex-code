import { breakpointRanges, breakpointWidths, resolveNodeStyles } from './responsive.ts';
import { normalizeNodeStyles } from './registry.ts';
import type { BuilderNode, NodeStyles, PageDocument, ResponsiveNodeStyles } from './types.ts';

export function publicPagePath(slug: string): string {
	return `/pages/${encodeURIComponent(slug)}`;
}

type Declaration = readonly [property: string, value: string];

/** Single, validated style resolution path used by React and Astro. */
export function nodeStyleDeclarations(input: NodeStyles | undefined): Declaration[] {
	const styles = normalizeNodeStyles(input);
	const declarations: Declaration[] = [];
	if (styles.width) {
		switch (styles.width) {
			case 'content': declarations.push(['width', 'max-content'], ['max-width', '100%']); break;
			case 'narrow': declarations.push(['width', 'min(100%,40rem)'], ['max-width', '100%']); break;
			case 'wide': declarations.push(['width', 'min(100%,72rem)'], ['max-width', '100%']); break;
			case 'full': declarations.push(['width', '100%'], ['max-width', 'none']); break;
			default: declarations.push(['width', styles.width]);
		}
	}
	for (const key of ['height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
		const value = styles[key];
		if (value !== undefined) declarations.push([kebab(key), value]);
	}
	for (const key of ['marginBlockStart', 'marginBlockEnd', 'paddingBlockStart', 'paddingBlockEnd', 'paddingInlineStart', 'paddingInlineEnd'] as const) {
		const value = styles[key];
		if (value !== undefined) declarations.push([kebab(key), `${value}px`]);
	}
	if (styles.borderRadius) declarations.push(['border-radius', { none: '0', sm: '.35rem', md: '.7rem', lg: '1.1rem' }[styles.borderRadius]]);
	if (styles.layout) declarations.push(['display', styles.layout]);
	if (styles.direction) declarations.push(['flex-direction', styles.direction]);
	if (styles.columns) declarations.push(['grid-template-columns', `repeat(${styles.columns},minmax(0,1fr))`]);
	if (styles.gap !== undefined) declarations.push(['gap', `${styles.gap}px`]);
	if (styles.alignItems) declarations.push(['align-items', styles.alignItems]);
	if (styles.justifyContent) declarations.push(['justify-content', styles.justifyContent]);
	if (styles.overflow) declarations.push(['overflow', styles.overflow]);
	return declarations;
}

export function nodeStyleObject(styles: NodeStyles | undefined): Record<string, string> {
	return Object.fromEntries(nodeStyleDeclarations(styles).map(([key, value]) => [key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
}

export function controlledNodeStyle(styles: NodeStyles | undefined): string | undefined {
	const declarations = nodeStyleDeclarations(styles);
	return declarations.length ? declarations.map(([key, value]) => `${key}:${value}`).join(';') : undefined;
}

export function buildResponsiveCss(document: PageDocument): string {
	const widths = breakpointWidths(document);
	const ranges = breakpointRanges(document);
	// Intrinsic row behavior follows the document's mobile boundary.
	const rules: string[] = [`@media (max-width:${widths.mobile}px){:where(.nvx-page) .nvx-builder-container[data-layout='row']{flex-direction:column}:where(.nvx-page) .nvx-builder-container{width:100%}}`];
	for (const node of flattenNodes(document.nodes)) {
		const selector = `[data-builder-id="${node.id}"]`;
		const anyHidden = Object.values(node.responsiveStyles ?? {}).some((entry) => entry?.hidden === true);
		if (node.responsiveStyles?.desktop?.hidden === true) rules.push(`${selector}{display:none!important}`);
		for (const range of ranges.slice(1)) {
			const styles = node.responsiveStyles?.[range.id];
			let declarations = styles ? responsiveDeclarations(styles) : [];
			if (anyHidden) {
				const fallback = node.type === 'Container' ? (node.props.layout === 'grid' ? 'grid' : 'flex') : node.type === 'PluginBlock' || node.type === 'Button' ? 'flex' : 'block';
				const display = resolveNodeStyles(node, range.id, document).layout ?? fallback;
				// Each named range has independent visibility; restore display on the next range.
				declarations = declarations.filter((declaration) => !declaration.startsWith('display:'));
				declarations.push(`display:${styles?.hidden === true ? 'none' : display}!important`);
			}
			if (declarations.length) rules.push(`@media (max-width:${range.maxWidth}px){${selector}{${declarations.join(';')}}}`);
		}
	}
	return rules.join('\n');
}

function flattenNodes(nodes: BuilderNode[]): BuilderNode[] {
	return nodes.flatMap((node) => node.type === 'Container' ? [node, ...flattenNodes(node.children)] : [node]);
}

function responsiveDeclarations(styles: ResponsiveNodeStyles): string[] {
	const { hidden: _hidden, ...surface } = styles;
	return nodeStyleDeclarations(surface).map(([key, value]) => `${key}:${value}!important`);
}

function kebab(value: string): string {
	return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
