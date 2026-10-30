import type { BuilderNode, PageDocument } from './types.ts';

/** Rewrite managed-image references in a detached document without touching other properties. */
export function rewriteDocumentMedia(document: PageDocument, references: ReadonlyMap<string, string>): PageDocument {
	const rewriteNode = (node: BuilderNode): BuilderNode => {
		if (node.type === 'Container') return { ...node, children: node.children.map(rewriteNode) };
		if (node.type === 'Image') return { ...node, props: { ...node.props, src: references.get(node.props.src) ?? node.props.src } };
		if (node.type === 'ImageGallery') return { ...node, props: { ...node.props, items: node.props.items.map((item) => ({ ...item, src: references.get(item.src) ?? item.src })) } };
		return node;
	};
	return { ...document, nodes: document.nodes.map(rewriteNode) };
}
