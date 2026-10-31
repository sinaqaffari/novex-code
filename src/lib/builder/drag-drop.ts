import { findNode, findNodeLocation } from './operations.ts';
import type { MovePlacement, NodeLocation } from './operations.ts';
import type { BuilderNode, PageDocument } from './types.ts';

/** Calculate a visible insertion edge; the middle of a container accepts children. */
export function dropPlacement(node: BuilderNode, top: number, height: number, pointerY: number): MovePlacement {
	if (!Number.isFinite(top) || !Number.isFinite(height) || !Number.isFinite(pointerY) || height <= 0) {
		return node.type === 'Container' ? 'inside' : 'after';
	}
	const offset = Math.max(0, Math.min(height, pointerY - top));
	if (node.type !== 'Container') return offset < height / 2 ? 'before' : 'after';
	const edge = Math.min(48, height / 4);
	if (offset < edge) return 'before';
	if (offset > height - edge) return 'after';
	return 'inside';
}

/** Resolve palette insertion against the current tree, never against a stale selection. */
export function dropInsertionPoint(document: PageDocument, targetId: string | null, placement: MovePlacement = 'after'): NodeLocation {
	if (targetId === null) return { parentId: null, index: document.nodes.length };
	const target = findNode(document.nodes, targetId);
	const location = findNodeLocation(document.nodes, targetId);
	if (!target || !location) throw new Error('مقصد رها کردن دیگر در صفحه وجود ندارد.');
	if (placement === 'inside') {
		if (target.type !== 'Container') throw new Error('فقط داخل بخش می‌توان مؤلفه قرار داد.');
		return { parentId: target.id, index: target.children.length };
	}
	return { parentId: location.parentId, index: location.index + (placement === 'after' ? 1 : 0) };
}
