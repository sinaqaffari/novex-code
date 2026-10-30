import { BREAKPOINT_MAX_WIDTH } from './responsive.ts';
import type { BuilderNode, NodeStyles, PageDocument, ResponsiveNodeStyles } from './types.ts';

export function publicPagePath(slug: string): string {
	return `/pages/${encodeURIComponent(slug)}`;
}

export function controlledNodeStyle(styles: NodeStyles | undefined): string | undefined {
	if (!styles) return undefined;
	const declarations: string[] = [];
	if (styles.width) declarations.push(...widthDeclarations(styles.width));
	for (const key of [
		'marginBlockStart',
		'marginBlockEnd',
		'paddingBlockStart',
		'paddingBlockEnd',
		'paddingInlineStart',
		'paddingInlineEnd',
	] as const) {
		const value = styles[key];
		if (value !== undefined) declarations.push(`${kebab(key)}:${value}px`);
	}
	if (styles.borderRadius) declarations.push(`border-radius:${borderRadius(styles.borderRadius)}`);
	return declarations.length ? declarations.join(';') : undefined;
}

export function buildResponsiveCss(document: PageDocument): string {
	const rules: string[] = [];
	for (const node of flattenNodes(document.nodes)) {
		const desktopHidden = node.responsiveStyles?.desktop?.hidden === true;
		const tabletHidden = node.responsiveStyles?.tablet?.hidden === true;
		const mobileHidden = node.responsiveStyles?.mobile?.hidden === true;
		const selector = `[data-builder-id="${node.id}"]`;
		if (desktopHidden) rules.push(`${selector}{display:none!important}`);
		for (const breakpoint of ['tablet', 'mobile'] as const) {
			const styles = node.responsiveStyles?.[breakpoint];
			const declarations = styles ? responsiveDeclarations(styles) : [];
			const shouldResetVisibility = breakpoint === 'tablet'
				? desktopHidden || tabletHidden
				: desktopHidden || tabletHidden || mobileHidden;
			if (shouldResetVisibility) {
				const hidden = breakpoint === 'tablet' ? tabletHidden : mobileHidden;
				const display = node.type === 'Container' ? (node.props.layout === 'grid' ? 'grid' : 'flex') : node.type === 'PluginBlock' ? 'flex' : 'block';
				declarations.unshift(`display:${hidden ? 'none' : display}!important`);
			}
			if (!declarations.length) continue;
			const maxWidth = `${BREAKPOINT_MAX_WIDTH[breakpoint]}px`;
			rules.push(`@media (max-width:${maxWidth}){${selector}{${declarations.join(';')}}}`);
		}
	}
	return rules.join('\n');
}

function flattenNodes(nodes: BuilderNode[]): BuilderNode[] {
	return nodes.flatMap((node) => node.type === 'Container' ? [node, ...flattenNodes(node.children)] : [node]);
}

function responsiveDeclarations(styles: ResponsiveNodeStyles): string[] {
	const declarations: string[] = [];
	if (styles.width) declarations.push(...widthDeclarations(styles.width));
	for (const key of [
		'marginBlockStart',
		'marginBlockEnd',
		'paddingBlockStart',
		'paddingBlockEnd',
		'paddingInlineStart',
		'paddingInlineEnd',
	] as const) {
		const value = styles[key];
		if (value !== undefined) declarations.push(`${kebab(key)}:${value}px`);
	}
	if (styles.borderRadius) declarations.push(`border-radius:${borderRadius(styles.borderRadius)}`);
	// Published base styles are inline; breakpoint overrides must win over them.
	return declarations.map((declaration) => `${declaration}!important`);
}

function widthDeclarations(width: NonNullable<NodeStyles['width']>): string[] {
	switch (width) {
		case 'content': return ['width:max-content', 'max-width:100%'];
		case 'narrow': return ['width:min(100%,40rem)', 'max-width:100%'];
		case 'wide': return ['width:min(100%,72rem)', 'max-width:100%'];
		case 'full': return ['width:100%', 'max-width:none'];
	}
}

function borderRadius(value: NonNullable<NodeStyles['borderRadius']>): string {
	return { none: '0', sm: '.35rem', md: '.7rem', lg: '1.1rem' }[value];
}

function kebab(value: string): string {
	return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
