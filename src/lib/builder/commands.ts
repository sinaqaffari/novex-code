import {
	addNode, deleteNode, duplicateNode, insertDocumentFragment, moveNode, moveNodeBy, removeCustomBreakpoint, replaceNode, setNodeHiddenAtBreakpoint,
	updateNodeProps, updateNodeStyles, updatePageMetadata, type MovePlacement,
} from './operations.ts';
import { DocumentValidationError, validatePageDocument } from './document.ts';
import type { Breakpoint, CustomBreakpointId, BuilderComponentType, BuilderNode, NodeStyles, PageDocument } from './types.ts';

/** Commands are document-only: save, preview and publish stay in their authorized UI/API owners. */
export type DocumentCommand =
	| { type: 'insert'; component: BuilderComponentType; parentId?: string | null; index?: number; id?: string; props?: Record<string, unknown> }
	| { type: 'delete'; id: string }
	| { type: 'duplicate'; id: string; idFactory?: () => string }
	| { type: 'move'; id: string; targetId: string; placement: MovePlacement }
	| { type: 'reorder'; id: string; direction: -1 | 1 }
	| { type: 'replace'; id: string; node: BuilderNode }
	| { type: 'replace-document'; document: PageDocument }
	| { type: 'insert-fragment'; fragment: PageDocument; targetId: string | null }
	| { type: 'props'; id: string; patch: Record<string, unknown> }
	| { type: 'styles'; id: string; patch: Partial<NodeStyles>; breakpoint: Breakpoint }
	| { type: 'visibility'; id: string; breakpoint: Breakpoint; hidden: boolean }
	| { type: 'remove-breakpoint'; id: CustomBreakpointId }
	| { type: 'metadata'; patch: Partial<Pick<PageDocument, 'title' | 'description' | 'themeId' | 'breakpoints'>> };

export type CommandResult =
	| { ok: true; document: PageDocument; selectedId?: string | null }
	| { ok: false; error: { code: 'invalid_document' | 'invalid_operation'; message: string; path?: string; command: DocumentCommand['type'] } };

/** A failed command never modifies the input or returns a partially updated document. */
export function executeDocumentCommand(document: PageDocument, command: DocumentCommand): CommandResult {
	try {
		switch (command.type) {
			case 'insert': {
				const inserted = addNode(document, command.component, command);
				// Callers provide an ID when selecting an inserted node or applying initial props.
				if (command.props && !command.id) throw new Error('An ID is required when inserting with properties.');
				const next = command.props && command.id ? updateNodeProps(inserted, command.id, command.props) : inserted;
				return { ok: true, document: next, ...(command.id ? { selectedId: command.id } : {}) };
			}
			case 'delete': return { ok: true, document: deleteNode(document, command.id), selectedId: null };
			case 'duplicate': {
				const result = duplicateNode(document, command.id, command.idFactory);
				return { ok: true, document: result.document, selectedId: result.newId };
			}
			case 'move': return { ok: true, document: moveNode(document, command.id, command.targetId, command.placement), selectedId: command.id };
			case 'reorder': return { ok: true, document: moveNodeBy(document, command.id, command.direction) };
			case 'replace': return { ok: true, document: replaceNode(document, command.id, command.node), selectedId: command.node.id };
			case 'replace-document': {
				const next = validatePageDocument(command.document, document.slug);
				if (next.id !== document.id) throw new Error('The page identity cannot be changed by a document replacement.');
				return { ok: true, document: next, selectedId: null };
			}
			case 'insert-fragment': {
				const result = insertDocumentFragment(document, command.fragment, command.targetId);
				return { ok: true, document: result.document, selectedId: result.firstId };
			}
			case 'props': return { ok: true, document: updateNodeProps(document, command.id, command.patch) };
			case 'styles': return { ok: true, document: updateNodeStyles(document, command.id, command.patch, command.breakpoint) };
			case 'visibility': return { ok: true, document: setNodeHiddenAtBreakpoint(document, command.id, command.breakpoint, command.hidden) };
			case 'remove-breakpoint': return { ok: true, document: removeCustomBreakpoint(document, command.id) };
			case 'metadata': return { ok: true, document: updatePageMetadata(document, command.patch) };
		}
	} catch (error) {
		return { ok: false, error: {
			code: error instanceof DocumentValidationError ? 'invalid_document' : 'invalid_operation',
			message: error instanceof Error ? error.message : 'Document operation failed.',
			...(error instanceof DocumentValidationError && error.path ? { path: error.path } : {}),
			command: command.type,
		} };
	}
}
