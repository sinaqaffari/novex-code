import { validatePageDocument } from './document.ts';
import { COMPONENT_REGISTRY, isBuilderComponentType } from './registry.ts';
import type { BuilderComponentType, BuilderNode, ComponentPropsByType, NodeStyles, PageDocument } from './types.ts';

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
		return { ...node, props: { ...node.props, ...patch } } as BuilderNode;
	});
	if (!found) throw new Error(`Node '${id}' was not found.`);
	return validatePageDocument({ ...document, nodes }, document.slug);
}

export function updateNodeStyles(
	document: PageDocument,
	id: string,
	patch: Partial<NodeStyles>,
	breakpoint: 'desktop' | 'tablet' | 'mobile' = 'desktop',
): PageDocument {
	let found = false;
	const nodes = mapNode(document.nodes, id, (node) => {
		found = true;
		if (breakpoint === 'desktop') return { ...node, styles: { ...node.styles, ...patch } } as BuilderNode;
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
	breakpoint: 'desktop' | 'tablet' | 'mobile',
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
	const clone = cloneWithNewIds(target, idFactory);
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
