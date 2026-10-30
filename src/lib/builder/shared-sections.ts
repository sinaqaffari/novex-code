import { createHash } from 'node:crypto';
import { createEmptyPageDocument, validatePageDocument } from './document.ts';
import { createNodeId, replaceNode, traversePageNodes } from './operations.ts';
import { customBreakpointIds, mergeFragmentBreakpoints, normalizeBreakpointWidths } from './responsive.ts';
import type { BreakpointWidths, BuilderNode, ContainerNode, PageDocument, SharedSectionReference } from './types.ts';

/** Server-owned source; revisions store hashes, not executable or remote content. */
export interface SharedSectionRecord {
	id: string;
	name: string;
	revision: number;
	updatedAt: string;
	node: ContainerNode;
	/** Context for custom responsive overrides in the source snapshot. */
	breakpoints?: BreakpointWidths;
	versions: Array<{ revision: number; hash: string }>;
}

export function isSharedSectionId(id: string): boolean {
	return /^section_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
}

/** Validate one non-nested, bounded section snapshot through the canonical document. */
export function normalizeSectionNode(input: unknown, breakpoints?: unknown): ContainerNode {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('بخش مشترک معتبر نیست.');
	const raw = { ...(input as Record<string, unknown>) };
	delete raw.sharedSection; // The library owns the source rather than linking to itself.
	const document = validatePageDocument({ ...createEmptyPageDocument('shared-section'), breakpoints, nodes: [raw] });
	const root = document.nodes[0];
	if (root?.type !== 'Container') throw new Error('فقط یک بخش Container می‌تواند مشترک شود.');
	let nested = false;
	traversePageNodes(document, (node) => { if (node.type === 'Container' && node.sharedSection) nested = true; });
	if (nested) throw new Error('بخش مشترک تو‌در‌تو پشتیبانی نمی‌شود.');
	if (new TextEncoder().encode(JSON.stringify(root)).byteLength > 128 * 1024) throw new Error('حجم بخش مشترک نباید بیش از ۱۲۸ کیلوبایت باشد.');
	return root;
}

/** Content identity ignores node IDs so independent instances remain comparable. */
export function sectionHash(input: ContainerNode, breakpoints?: BreakpointWidths): string {
	const normalized = normalizeSectionNode(input, breakpoints);
	function project(node: BuilderNode): unknown {
		if (node.type === 'Container') {
			const { id: _id, children, sharedSection: _reference, ...value } = node;
			return { ...value, children: children.map(project) };
		}
		const { id: _id, ...value } = node;
		return value;
	}
	const used = customBreakpointIds([normalized]);
	const widths = normalizeBreakpointWidths(breakpoints)?.custom?.filter((entry) => used.has(entry.id)).map(({ id, maxWidth }) => ({ id, maxWidth })) ?? [];
	const projection = project(normalized);
	// Keep hashes of legacy sources byte-for-byte stable when no custom range is used.
	return createHash('sha256').update(JSON.stringify(widths.length ? { node: projection, widths } : projection)).digest('hex');
}

export function sectionReference(section: SharedSectionRecord): SharedSectionReference {
	return { id: section.id, revision: section.revision, baselineHash: sectionHash(section.node, section.breakpoints) };
}

/** A fragment contains the complete snapshot; publication never resolves a live reference. */
export function sectionFragment(section: SharedSectionRecord): PageDocument {
	return validatePageDocument({ ...createEmptyPageDocument('shared-section', section.name), breakpoints: section.breakpoints, nodes: [{ ...section.node, sharedSection: sectionReference(section) }] });
}

/** Update through the same validated tree operation, retaining root identity. */
export function replaceSectionInstance(document: PageDocument, targetId: string, section: SharedSectionRecord): PageDocument {
	const used = new Set<string>();
	traversePageNodes(document, (node) => used.add(node.id));
	function nextId(): string {
		for (let attempt = 0; attempt < 32; attempt++) {
			const id = createNodeId();
			if (!used.has(id)) { used.add(id); return id; }
		}
		throw new Error('شناسهٔ یکتا برای مؤلفهٔ بخش ساخته نشد.');
	}
	function copy(node: BuilderNode, root = false): BuilderNode {
		const id = root ? targetId : nextId();
		if (node.type === 'Container') return { ...node, id, ...(root ? { sharedSection: sectionReference(section) } : {}), children: node.children.map((child) => copy(child)) };
		return { ...node, id };
	}
	const breakpoints = mergeFragmentBreakpoints(document, sectionFragment(section));
	return replaceNode({ ...document, breakpoints }, targetId, copy(section.node, true));
}
