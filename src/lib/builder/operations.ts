import { validatePageDocument } from './document.ts';
import { mergeFragmentBreakpoints } from './responsive.ts';
import { adjustTextMarks } from './rich-text.ts';
import { COMPONENT_REGISTRY, isBuilderComponentType } from './registry.ts';
import type { Breakpoint, BuilderComponentType, BuilderNode, ComponentPropsByType, NodeStyles, PageDocument, ResponsiveNodeStyles } from './types.ts';

export function createNodeId(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (uuid) return `node_${uuid}`;
	return `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export function createBuilderNode<T extends BuilderComponentType>(type: T, id = createNodeId()): Extract<BuilderNode, { type: T }> {
	if (!isBuilderComponentType(type)) throw new Error('Unknown builder component.');
	const definition = COMPONENT_REGISTRY[type];
	const common = {
		id,
		type,
		componentVersion: definition.version,
		props: structuredClone(definition.defaultProps) as ComponentPropsByType[T],
	};
	if (type === 'Container') {
		return { ...common, children: [] } as unknown as Extract<BuilderNode, { type: T }>;
	}
	return common as unknown as Extract<BuilderNode, { type: T }>;
}

export function findNode(nodes: readonly BuilderNode[], id: string): BuilderNode | null {
	for (const node of nodes) {
		if (node.id === id) return node;
		if (node.type === 'Container') {
			const nested = findNode(node.children, id);
			if (nested) return nested;
		}
	}
	return null;
}

/** Visit the canonical tree in document order without exposing a mutable parent. */
export function traversePageNodes(document: PageDocument, visit: (node: BuilderNode, parentId: string | null, index: number) => void): void {
	function walk(nodes: readonly BuilderNode[], parentId: string | null): void {
		nodes.forEach((node, index) => {
			visit(node, parentId, index);
			if (node.type === 'Container') walk(node.children, node.id);
		});
	}
	walk(document.nodes, null);
}

/** Clone by validation, not by sharing nested property objects with the source. */
export function clonePageDocument(document: PageDocument): PageDocument {
	return validatePageDocument(structuredClone(document), document.slug);
}

export function updatePageMetadata(document: PageDocument, patch: Partial<Pick<PageDocument, 'title' | 'description' | 'themeId' | 'breakpoints'>>): PageDocument {
	return validatePageDocument({ ...document, ...patch }, document.slug);
}

/** Explicitly remove a custom range and its node overrides as a single undoable edit. */
export function removeCustomBreakpoint(document: PageDocument, id: import('./types.ts').CustomBreakpointId): PageDocument {
	const widths = document.breakpoints;
	if (!widths?.custom?.some((entry) => entry.id === id)) throw new Error('Custom breakpoint was not found.');
	function strip(node: BuilderNode): BuilderNode {
		const responsiveStyles = node.responsiveStyles ? { ...node.responsiveStyles } : undefined;
		if (responsiveStyles) delete responsiveStyles[id];
		const next = { ...node, responsiveStyles };
		return node.type === 'Container' ? { ...next, children: node.children.map(strip) } as BuilderNode : next as BuilderNode;
	}
	const custom = widths.custom.filter((entry) => entry.id !== id);
	return validatePageDocument({ ...document, breakpoints: { ...widths, custom }, nodes: document.nodes.map(strip) }, document.slug);
}

/** Replace an entire content tree as one validated edit (e.g. a confirmed import). */
export function replacePageNodes(document: PageDocument, nodes: readonly BuilderNode[]): PageDocument {
	return validatePageDocument({ ...document, nodes }, document.slug);
}

/** Replace a node atomically; IDs, type and nesting are revalidated in context. */
export function replaceNode(document: PageDocument, id: string, replacement: BuilderNode): PageDocument {
	let found = false;
	const nodes = mapNode(document.nodes, id, () => { found = true; return structuredClone(replacement); });
	if (!found) throw new Error(`Node '${id}' was not found.`);
	return validatePageDocument({ ...document, nodes }, document.slug);
}

function freshIdAllocator(document: PageDocument, idFactory: () => string): () => string {
	const used = new Set<string>();
	traversePageNodes(document, (node) => used.add(node.id));
	return () => {
		// A broken or adversarial ID generator cannot hang the editor.
		for (let attempt = 0; attempt < 32; attempt++) {
			const id = idFactory();
			if (!used.has(id)) { used.add(id); return id; }
		}
		throw new Error('Could not allocate a unique component ID.');
	};
}

export interface NodeLocation {
	parentId: string | null;
	index: number;
}

export function findNodeLocation(nodes: readonly BuilderNode[], id: string, parentId: string | null = null): NodeLocation | null {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (node.id === id) return { parentId, index };
		if (node.type === 'Container') {
			const nested = findNodeLocation(node.children, id, node.id);
			if (nested) return nested;
		}
	}
	return null;
}

/**
 * Returns the path of nodes from the root level down to the node with `id`,
 * including the target node itself. Returns null if the node is not found.
 * Useful for rendering a selection breadcrumb in the editor.
 */
export function findNodePath(
	nodes: readonly BuilderNode[],
	id: string,
	path: BuilderNode[] = []
): BuilderNode[] | null {
	for (const node of nodes) {
		const nextPath = [...path, node];
		if (node.id === id) return nextPath;
		if (node.type === 'Container') {
			const nested = findNodePath(node.children, id, nextPath);
			if (nested) return nested;
		}
	}
	return null;
}

export function addNode(
	document: PageDocument,
	type: BuilderComponentType,
	options: { parentId?: string | null; index?: number; id?: string } = {},
): PageDocument {
	const node = createBuilderNode(type, options.id);
	const parentId = options.parentId ?? null;
	const updated = insertAtParent(document.nodes, parentId, node, options.index);
	return validatePageDocument({ ...document, nodes: updated }, document.slug);
}

/** Insert independent copies of validated fragment nodes at the current selection. */
export function insertDocumentFragment(
	document: PageDocument,
	fragment: PageDocument,
	selectedId: string | null,
	idFactory: () => string = createNodeId,
): { document: PageDocument; firstId: string | null } {
	const source = validatePageDocument(fragment);
	const target = validatePageDocument(document);
	const selected = selectedId ? findNode(target.nodes, selectedId) : null;
	if (selectedId && !selected) throw new Error('Selected component was not found.');
	const location = selected ? findNodeLocation(target.nodes, selected.id) : null;
	const parentId = selected?.type === 'Container' ? selected.id : location?.parentId ?? null;
	let index = selected?.type === 'Container' ? selected.children.length : location ? location.index + 1 : target.nodes.length;
	const allocateId = freshIdAllocator(target, idFactory);
	function copy(node: BuilderNode): BuilderNode {
		const id = allocateId();
		if (node.type === 'Container') return { ...node, id, children: node.children.map(copy) };
		return { ...node, id };
	}
	const copies = source.nodes.map(copy);
	let nodes = target.nodes;
	for (const node of copies) nodes = insertAtParent(nodes, parentId, node, index++);
	const breakpoints = mergeFragmentBreakpoints(target, source);
	return { document: validatePageDocument({ ...target, breakpoints, nodes }, target.slug), firstId: copies[0]?.id ?? null };
}

function insertAtParent(
	nodes: readonly BuilderNode[],
	parentId: string | null,
	inserted: BuilderNode,
	index?: number,
): BuilderNode[] {
	if (parentId === null) {
		const next = [...nodes];
		next.splice(clampIndex(index ?? next.length, next.length), 0, inserted);
		return next;
	}
	const result = insertWithin(nodes, parentId, inserted, index);
	if (!result.found) throw new Error(`Container '${parentId}' was not found.`);
	return result.nodes;
}

function insertWithin(
	nodes: readonly BuilderNode[],
	parentId: string,
	inserted: BuilderNode,
	index?: number,
): { nodes: BuilderNode[]; found: boolean } {
	let found = false;
	const next = nodes.map((node) => {
		if (node.id === parentId) {
			if (node.type !== 'Container') throw new Error('Only a Container can receive child components.');
			if (!(COMPONENT_REGISTRY[node.type].allowedChildren as readonly BuilderComponentType[]).includes(inserted.type)) {
				throw new Error(`${inserted.type} cannot be added to this Container.`);
			}
			const children = [...node.children];
			children.splice(clampIndex(index ?? children.length, children.length), 0, inserted);
			found = true;
			return { ...node, children };
		}
		if (node.type === 'Container') {
			const nested = insertWithin(node.children, parentId, inserted, index);
			if (nested.found) {
				found = true;
				return { ...node, children: nested.nodes };
			}
		}
		return node;
	});
	return { nodes: found ? next : nodes as BuilderNode[], found };
}

function clampIndex(index: number, length: number): number {
	return Math.max(0, Math.min(length, Math.trunc(index)));
}

export function updateNodeProps(document: PageDocument, id: string, patch: Record<string, unknown>): PageDocument {
	let found = false;
	const nodes = mapNode(document.nodes, id, (node) => {
		found = true;
		const adjusted = (node.type === 'Text' || node.type === 'Heading' || node.type === 'Blockquote') && typeof patch.text === 'string' && !Object.hasOwn(patch, 'marks')
			? { ...patch, marks: adjustTextMarks(node.props.text, patch.text, node.props.marks) }
			: patch;
		return { ...node, props: { ...node.props, ...adjusted } } as BuilderNode;
	});
	if (!found) throw new Error(`Node '${id}' was not found.`);
	return validatePageDocument({ ...document, nodes }, document.slug);
}

export function updateNodeStyles(
	document: PageDocument,
	id: string,
	patch: Partial<NodeStyles>,
	breakpoint: Breakpoint = 'desktop',
): PageDocument {
	let found = false;
	const nodes = mapNode(document.nodes, id, (node) => {
		found = true;
		if (breakpoint === 'desktop') {
			// Old documents may have desktop overrides. Move only the edited keys to
			// the base surface so stale overrides cannot shadow the user's change.
			const desktop: ResponsiveNodeStyles = { ...node.responsiveStyles?.desktop };
			for (const key of Object.keys(patch) as (keyof NodeStyles)[]) delete desktop[key];
			return { ...node, styles: { ...node.styles, ...patch }, responsiveStyles: { ...node.responsiveStyles, desktop } } as BuilderNode;
		}
		return {
			...node,
			responsiveStyles: {
				...node.responsiveStyles,
				[breakpoint]: { ...node.responsiveStyles?.[breakpoint], ...patch },
			},
		} as BuilderNode;
	});
	if (!found) throw new Error(`Node '${id}' was not found.`);
	return validatePageDocument({ ...document, nodes }, document.slug);
}

export function setNodeHiddenAtBreakpoint(
	document: PageDocument,
	id: string,
	breakpoint: Breakpoint,
	hidden: boolean,
): PageDocument {
	let found = false;
	const nodes = mapNode(document.nodes, id, (node) => {
		found = true;
		return {
			...node,
			responsiveStyles: {
				...node.responsiveStyles,
				[breakpoint]: { ...node.responsiveStyles?.[breakpoint], hidden },
			},
		} as BuilderNode;
	});
	if (!found) throw new Error(`Node '${id}' was not found.`);
	return validatePageDocument({ ...document, nodes }, document.slug);
}

export function deleteNode(document: PageDocument, id: string): PageDocument {
	const result = removeNode(document.nodes, id);
	if (!result.removed) throw new Error(`Node '${id}' was not found.`);
	return validatePageDocument({ ...document, nodes: result.nodes }, document.slug);
}

export function duplicateNode(
	document: PageDocument,
	id: string,
	idFactory: () => string = createNodeId,
): { document: PageDocument; newId: string } {
	const target = findNode(document.nodes, id);
	if (!target) throw new Error(`Node '${id}' was not found.`);
	const clone = cloneWithNewIds(target, freshIdAllocator(document, idFactory));
	const inserted = insertAdjacent(document.nodes, id, clone, 'after');
	if (!inserted.found) throw new Error(`Node '${id}' was not found.`);
	return {
		document: validatePageDocument({ ...document, nodes: inserted.nodes }, document.slug),
		newId: clone.id,
	};
}

export type MovePlacement = 'before' | 'after' | 'inside';

export function moveNode(document: PageDocument, sourceId: string, targetId: string, placement: MovePlacement): PageDocument {
	if (sourceId === targetId) return document;
	const source = findNode(document.nodes, sourceId);
	const target = findNode(document.nodes, targetId);
	if (!source || !target) throw new Error('Source or destination node was not found.');
	if (placement === 'inside' && target.type !== 'Container') throw new Error('Components can only be dropped inside a Container.');
	if (containsNode(source, targetId)) throw new Error('A component cannot be moved relative to itself or one of its descendants.');
	if (placement === 'inside' && !(COMPONENT_REGISTRY[target.type].allowedChildren as readonly BuilderComponentType[]).includes(source.type)) {
		throw new Error(`${source.type} is not allowed inside ${target.type}.`);
	}

	const removed = removeNode(document.nodes, sourceId);
	if (!removed.removed) throw new Error(`Node '${sourceId}' was not found.`);
	const inserted = placement === 'inside'
		? insertInside(removed.nodes, targetId, removed.removed)
		: insertAdjacent(removed.nodes, targetId, removed.removed, placement);
	if (!inserted.found) throw new Error(`Destination '${targetId}' was not found after removing the source.`);
	return validatePageDocument({ ...document, nodes: inserted.nodes }, document.slug);
}

export function moveNodeBy(document: PageDocument, id: string, direction: -1 | 1): PageDocument {
	const result = moveInList(document.nodes, id, direction);
	if (!result.found) throw new Error(`Node '${id}' was not found.`);
	return result.changed ? validatePageDocument({ ...document, nodes: result.nodes }, document.slug) : document;
}

function mapNode(nodes: readonly BuilderNode[], id: string, update: (node: BuilderNode) => BuilderNode): BuilderNode[] {
	let changed = false;
	const next = nodes.map((node) => {
		if (node.id === id) {
			changed = true;
			return update(node);
		}
		if (node.type === 'Container') {
			const children = mapNode(node.children, id, update);
			if (children !== node.children) {
				changed = true;
				return { ...node, children };
			}
		}
		return node;
	});
	return changed ? next : nodes as BuilderNode[];
}

function removeNode(nodes: readonly BuilderNode[], id: string): { nodes: BuilderNode[]; removed: BuilderNode | null } {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (node.id === id) return { nodes: [...nodes.slice(0, index), ...nodes.slice(index + 1)], removed: node };
		if (node.type === 'Container') {
			const nested = removeNode(node.children, id);
			if (nested.removed) {
				const next = [...nodes];
				next[index] = { ...node, children: nested.nodes };
				return { nodes: next, removed: nested.removed };
			}
		}
	}
	return { nodes: nodes as BuilderNode[], removed: null };
}

function insertAdjacent(
	nodes: readonly BuilderNode[],
	targetId: string,
	inserted: BuilderNode,
	placement: 'before' | 'after',
): { nodes: BuilderNode[]; found: boolean } {
	const next: BuilderNode[] = [];
	let found = false;
	for (const node of nodes) {
		if (node.id === targetId) {
			found = true;
			if (placement === 'before') next.push(inserted);
			next.push(node);
			if (placement === 'after') next.push(inserted);
			continue;
		}
		if (node.type === 'Container') {
			const nested = insertAdjacent(node.children, targetId, inserted, placement);
			if (nested.found) {
				found = true;
				next.push({ ...node, children: nested.nodes });
				continue;
			}
		}
		next.push(node);
	}
	return { nodes: found ? next : nodes as BuilderNode[], found };
}

function insertInside(
	nodes: readonly BuilderNode[],
	parentId: string,
	inserted: BuilderNode,
): { nodes: BuilderNode[]; found: boolean } {
	let found = false;
	const next = nodes.map((node) => {
		if (node.id === parentId) {
			if (node.type !== 'Container') throw new Error('Only a Container can receive child components.');
			found = true;
			return { ...node, children: [...node.children, inserted] };
		}
		if (node.type === 'Container') {
			const nested = insertInside(node.children, parentId, inserted);
			if (nested.found) {
				found = true;
				return { ...node, children: nested.nodes };
			}
		}
		return node;
	});
	return { nodes: found ? next : nodes as BuilderNode[], found };
}

function moveInList(nodes: readonly BuilderNode[], id: string, direction: -1 | 1): { nodes: BuilderNode[]; found: boolean; changed: boolean } {
	for (let index = 0; index < nodes.length; index += 1) {
		if (nodes[index].id === id) {
			const target = index + direction;
			if (target < 0 || target >= nodes.length) return { nodes: nodes as BuilderNode[], found: true, changed: false };
			const next = [...nodes];
			[next[index], next[target]] = [next[target], next[index]];
			return { nodes: next, found: true, changed: true };
		}
		const node = nodes[index];
		if (node.type === 'Container') {
			const nested = moveInList(node.children, id, direction);
			if (nested.found) {
				if (!nested.changed) return { nodes: nodes as BuilderNode[], found: true, changed: false };
				const next = [...nodes];
				next[index] = { ...node, children: nested.nodes };
				return { nodes: next, found: true, changed: true };
			}
		}
	}
	return { nodes: nodes as BuilderNode[], found: false, changed: false };
}

function containsNode(node: BuilderNode, id: string): boolean {
	return node.id === id || (node.type === 'Container' && node.children.some((child) => containsNode(child, id)));
}

function cloneWithNewIds(node: BuilderNode, idFactory: () => string): BuilderNode {
	if (node.type === 'Container') {
		return { ...node, id: idFactory(), children: node.children.map((child) => cloneWithNewIds(child, idFactory)) };
	}
	return { ...node, id: idFactory() };
}
