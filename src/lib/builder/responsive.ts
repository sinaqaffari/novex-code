import type { Breakpoint, BreakpointWidths, BuilderNode, CustomBreakpoint, CustomBreakpointId, NodeStyles, PageDocument } from './types.ts';

/** CSS viewport boundaries for the canonical document contract. */
export const BREAKPOINT_MAX_WIDTH = { tablet: 1023, mobile: 767 } as const;
export const MAX_CUSTOM_BREAKPOINTS = 8;
const CUSTOM_ID = /^bp_[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Validate all values before they can reach selectors or CSS media queries. */
export function normalizeBreakpointWidths(input: unknown): BreakpointWidths | undefined {
	if (input === undefined) return undefined;
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Breakpoint widths must be an object.');
	const value = input as Record<string, unknown>;
	if (Object.keys(value).some((key) => key !== 'mobile' && key !== 'tablet' && key !== 'custom')) throw new Error('Unsupported breakpoint property.');
	const { mobile, tablet } = value;
	if (typeof mobile !== 'number' || !Number.isInteger(mobile) || mobile < 320 || mobile > 1535 ||
		typeof tablet !== 'number' || !Number.isInteger(tablet) || tablet < 640 || tablet > 1920 || mobile >= tablet) {
		throw new Error('Breakpoint widths must be whole pixels: mobile 320–1535, tablet 640–1920, with mobile below tablet.');
	}
	if (value.custom === undefined) return { tablet, mobile };
	if (!Array.isArray(value.custom) || value.custom.length > MAX_CUSTOM_BREAKPOINTS) throw new Error(`At most ${MAX_CUSTOM_BREAKPOINTS} custom breakpoints are allowed.`);
	const ids = new Set<string>();
	const widths = new Set<number>([tablet, mobile]);
	const custom: CustomBreakpoint[] = value.custom.map((raw: unknown) => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Custom breakpoint must be an object.');
		const entry = raw as Record<string, unknown>;
		if (Object.keys(entry).some((key) => !['id', 'label', 'maxWidth'].includes(key))) throw new Error('Unsupported custom breakpoint property.');
		const { id, label, maxWidth } = entry;
		if (typeof id !== 'string' || id.length > 40 || !CUSTOM_ID.test(id) || ids.has(id)) throw new Error('Custom breakpoint ID must be unique and use the bp_ namespace.');
		if (typeof label !== 'string' || !label.trim() || label.trim().length > 40 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(label)) throw new Error('Custom breakpoint label must contain 1–40 characters.');
		if (typeof maxWidth !== 'number' || !Number.isInteger(maxWidth) || maxWidth < 240 || maxWidth > 2560 || widths.has(maxWidth)) throw new Error('Custom breakpoint width must be a unique whole pixel value from 240 to 2560.');
		ids.add(id); widths.add(maxWidth);
		return { id: id as CustomBreakpointId, label: label.trim(), maxWidth };
	});
	// Canonical order follows the cascade rather than the input order.
	custom.sort((a, b) => b.maxWidth - a.maxWidth);
	return { tablet, mobile, ...(custom.length ? { custom } : {}) };
}

export function breakpointWidths(document: Pick<PageDocument, 'breakpoints'>): BreakpointWidths {
	return normalizeBreakpointWidths(document.breakpoints) ?? { ...BREAKPOINT_MAX_WIDTH };
}

export interface BreakpointRange { id: Breakpoint; label: string; maxWidth: number | null }
/** Desktop is the unbounded base. Other ranges cascade in descending max-width order. */
export function breakpointRanges(document: Pick<PageDocument, 'breakpoints'>): BreakpointRange[] {
	const widths = breakpointWidths(document);
	return [
		{ id: 'desktop', label: 'رومیزی', maxWidth: null },
		...[
			{ id: 'tablet' as const, label: 'تبلت', maxWidth: widths.tablet },
			{ id: 'mobile' as const, label: 'موبایل', maxWidth: widths.mobile },
			...(widths.custom ?? []),
		].sort((a, b) => b.maxWidth - a.maxWidth),
	];
}

/** Styles inherit from the wider ranges; visibility remains independent. */
export function resolveNodeStyles(node: BuilderNode, breakpoint: Breakpoint, document: Pick<PageDocument, 'breakpoints'> = {}): NodeStyles {
	const result: NodeStyles = { ...node.styles };
	const ranges = breakpointRanges(document);
	const index = ranges.findIndex((entry) => entry.id === breakpoint);
	// A removed custom viewport can transiently remain selected during undo/redo.
	const end = Math.max(index, 0);
	for (const entry of ranges.slice(0, end + 1)) {
		const { hidden: _hidden, ...styles } = node.responsiveStyles?.[entry.id] ?? {};
		Object.assign(result, styles);
	}
	return result;
}

export function explicitNodeStyle<K extends keyof NodeStyles>(node: BuilderNode, breakpoint: Breakpoint, key: K): NodeStyles[K] {
	return breakpoint === 'desktop' ? (node.responsiveStyles?.desktop?.[key] ?? node.styles?.[key]) : node.responsiveStyles?.[breakpoint]?.[key];
}

export function resolveNodeStyle<K extends keyof NodeStyles>(node: BuilderNode, breakpoint: Breakpoint, key: K, document: Pick<PageDocument, 'breakpoints'> = {}): NodeStyles[K] {
	return resolveNodeStyles(node, breakpoint, document)[key];
}

/** Custom definitions used by a fragment; unused definitions need not be copied. */
export function customBreakpointIds(nodes: readonly BuilderNode[]): Set<CustomBreakpointId> {
	const ids = new Set<CustomBreakpointId>();
	function visit(node: BuilderNode) {
		for (const id of Object.keys(node.responsiveStyles ?? {})) if (id.startsWith('bp_')) ids.add(id as CustomBreakpointId);
		if (node.type === 'Container') node.children.forEach(visit);
	}
	nodes.forEach(visit);
	return ids;
}

/** Merge the definitions a fragment actually uses; conflicting semantics fail closed. */
export function mergeFragmentBreakpoints(target: PageDocument, source: PageDocument): BreakpointWidths | undefined {
	const used = customBreakpointIds(source.nodes);
	if (!used.size) return target.breakpoints;
	const destination = breakpointWidths(target);
	const available = source.breakpoints?.custom ?? [];
	const custom = [...(destination.custom ?? [])];
	for (const id of used) {
		const incoming = available.find((entry) => entry.id === id);
		if (!incoming) throw new Error(`Custom breakpoint ${id} is missing from the fragment.`);
		const existing = custom.find((entry) => entry.id === id);
		if (existing && existing.maxWidth !== incoming.maxWidth) throw new Error(`Custom breakpoint ${id} has a conflicting width.`);
		if (!existing) custom.push(incoming);
	}
	return normalizeBreakpointWidths({ ...destination, custom });
}
