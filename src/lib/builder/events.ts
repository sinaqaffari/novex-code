import type { PageDocument } from './types.ts';

/** Editor-scoped events; no plugin code is given this private dispatcher. */
export interface EditorEventPayloads {
	'document.changed': { document: PageDocument; reason: 'edit' | 'undo' | 'redo' };
	'node.inserted': { nodeId: string };
	'node.removed': { nodeId: string };
	'node.updated': { nodeId: string };
	'selection.changed': { nodeId: string | null };
	'template.installed': { templateId: string; mode: 'copy' | 'replace' };
	'migration.completed': { source: 'elementor' | 'wordpress'; warnings: number };
	'publish.completed': { slug: string; revision: number };
}

type Listener = (payload: unknown) => void;

export class EditorEvents {
	private readonly listeners = new Map<keyof EditorEventPayloads, Set<Listener>>();

	on<K extends keyof EditorEventPayloads>(type: K, listener: (payload: EditorEventPayloads[K]) => void): () => void {
		const listeners = this.listeners.get(type) ?? new Set<Listener>();
		listeners.add(listener as Listener);
		this.listeners.set(type, listeners);
		return () => { listeners.delete(listener as Listener); if (!listeners.size) this.listeners.delete(type); };
	}

	/** Faults are returned to the owner; one listener cannot prevent its peers. */
	emit<K extends keyof EditorEventPayloads>(type: K, payload: EditorEventPayloads[K]): Error[] {
		const failures: Error[] = [];
		for (const listener of [...(this.listeners.get(type) ?? [])]) {
			try { listener(payload); }
			catch (error) { failures.push(error instanceof Error ? error : new Error(String(error))); }
		}
		return failures;
	}
}
