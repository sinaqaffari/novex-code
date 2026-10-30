import type { Breakpoint, BuilderNode, NodeStyles } from './types.ts';

/** CSS viewport boundaries for the current, version-one document contract. */
export const BREAKPOINT_MAX_WIDTH = { tablet: 1023, mobile: 767 } as const;

/** Styles cascade from desktop to tablet to mobile. Visibility is per breakpoint. */
export function resolveNodeStyles(node: BuilderNode, breakpoint: Breakpoint): NodeStyles {
	return {
		...node.styles,
		...(breakpoint !== 'desktop' ? node.responsiveStyles?.tablet : undefined),
		...(breakpoint === 'mobile' ? node.responsiveStyles?.mobile : undefined),
	};
}

export function explicitNodeStyle<K extends keyof NodeStyles>(node: BuilderNode, breakpoint: Breakpoint, key: K): NodeStyles[K] {
	return breakpoint === 'desktop' ? node.styles?.[key] : node.responsiveStyles?.[breakpoint]?.[key];
}

export function resolveNodeStyle<K extends keyof NodeStyles>(node: BuilderNode, breakpoint: Breakpoint, key: K): NodeStyles[K] {
	return resolveNodeStyles(node, breakpoint)[key];
}
