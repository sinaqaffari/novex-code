import {
	COMPONENT_REGISTRY,
	isBuilderComponentType,
	normalizeNodeStyles,
	normalizeProps,
	normalizeResponsiveStyles,
} from './registry.ts';
import {
	BREAKPOINTS,
	PAGE_DOCUMENT_SCHEMA_VERSION,
	type BuilderComponentType,
	type BuilderNode,
	type ComponentPropsByType,
	type ContainerNode,
	type PageDocument,
} from './types.ts';
import { isBuilderThemeId } from './themes.ts';

const MAX_NODES = 200;
const MAX_DEPTH = 8;
const MAX_PAGE_JSON_BYTES = 1024 * 1024;
const PAGE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_ID = /^node_[A-Za-z0-9_-]{6,80}$/;
const PAGE_ID = /^page_[a-z0-9-]{1,60}$/;

export class DocumentValidationError extends Error {
	readonly path: string;

	constructor(message: string, path = '') {
		super(path ? `${message} (${path})` : message);
		this.name = 'DocumentValidationError';
		this.path = path;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function requireText(value: unknown, key: string, min: number, max: number): string {
	if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
		throw new DocumentValidationError(`"${key}" must be ${min === 0 ? 'at most' : 'between'} ${min} and ${max} characters`, key);
	}
	return value;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) throw new DocumentValidationError(`Unsupported property "${key}"`, path);
	}
}

export function isValidPageSlug(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 60 && PAGE_SLUG.test(value);
}

export function createEmptyPageDocument(slug: string, title = 'صفحهٔ تازه'): PageDocument {
	if (!isValidPageSlug(slug)) throw new DocumentValidationError('Page slug must use lowercase ASCII letters, digits, and hyphens.', 'slug');
	return {
		schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
		id: `page_${slug}`,
		slug,
		title,
		description: '',
		themeId: 'site',
		nodes: [],
	};
}

/** Migrate known document versions before validating against the current schema. */
export function migratePageDocument(input: unknown): unknown {
	if (!isRecord(input)) throw new DocumentValidationError('Page document must be an object.');
	if (input.schemaVersion === PAGE_DOCUMENT_SCHEMA_VERSION) return input;
	if (input.schemaVersion === 1) return { ...input, schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION };
	if (input.schemaVersion !== 0) {
		throw new DocumentValidationError(`Unsupported page schema version: ${String(input.schemaVersion)}.`, 'schemaVersion');
	}

	const legacyNodes = Array.isArray(input.nodes) ? input.nodes : Array.isArray(input.blocks) ? input.blocks : [];
	return {
		schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
		id: typeof input.id === 'string' ? input.id : `page_${String(input.slug ?? 'untitled')}`,
		slug: input.slug,
		title: input.title,
		description: typeof input.description === 'string' ? input.description : '',
		themeId: input.themeId ?? 'site',
		nodes: legacyNodes.map((node) => migrateLegacyNode(node)),
	};
}

function migrateLegacyNode(input: unknown): unknown {
	if (!isRecord(input)) return input;
	const typeAliases: Record<string, BuilderComponentType> = {
		container: 'Container',
		heading: 'Heading',
		text: 'Text',
		image: 'Image',
		button: 'Button',
	};
	const rawType = typeof input.type === 'string' ? input.type : '';
	const type = typeAliases[rawType] ?? rawType;
	return {
		id: input.id,
		type,
		componentVersion: typeof input.componentVersion === 'number' ? input.componentVersion : 1,
		props: input.props ?? {},
		styles: input.styles ?? {},
		...(input.responsiveStyles ? { responsiveStyles: input.responsiveStyles } : {}),
		...(type === 'Container'
			? { children: (Array.isArray(input.children) ? input.children : []).map(migrateLegacyNode) }
			: {}),
	};
}

export function validatePageDocument(input: unknown, expectedSlug?: string): PageDocument {
	const migrated = migratePageDocument(input);
	if (!isRecord(migrated)) throw new DocumentValidationError('Page document must be an object.');
	assertOnlyKeys(migrated, ['schemaVersion', 'id', 'slug', 'title', 'description', 'themeId', 'nodes'], 'document');

	if (migrated.schemaVersion !== PAGE_DOCUMENT_SCHEMA_VERSION) {
		throw new DocumentValidationError('Page schema version is invalid.', 'schemaVersion');
	}
	const slug = requireText(migrated.slug, 'slug', 1, 60);
	if (!isValidPageSlug(slug)) throw new DocumentValidationError('Slug must use lowercase ASCII letters, digits, and hyphens.', 'slug');
	if (expectedSlug && slug !== expectedSlug) throw new DocumentValidationError('Document slug does not match the requested page.', 'slug');

	const id = requireText(migrated.id, 'id', 6, 68);
	if (!PAGE_ID.test(id)) throw new DocumentValidationError('Page ID is invalid.', 'id');
	const title = requireText(migrated.title, 'title', 1, 100).trim();
	if (!title) throw new DocumentValidationError('Title cannot be empty.', 'title');
	const description = requireText(migrated.description ?? '', 'description', 0, 200).trim();
	const themeId = migrated.themeId === undefined ? 'site' : migrated.themeId;
	if (!isBuilderThemeId(themeId)) throw new DocumentValidationError('Theme ID is not supported.', 'themeId');
	if (!Array.isArray(migrated.nodes) || migrated.nodes.length > MAX_NODES) {
		throw new DocumentValidationError(`Page must contain no more than ${MAX_NODES} top-level nodes.`, 'nodes');
	}

	const seenIds = new Set<string>();
	let nodeCount = 0;
	const nodes = migrated.nodes.map((node, index) => normalizeNode(node, `nodes[${index}]`, 1, seenIds, (count) => {
		nodeCount += count;
	}));
	if (nodeCount > MAX_NODES) throw new DocumentValidationError(`Page may contain no more than ${MAX_NODES} nodes.`, 'nodes');
	return { schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION, id, slug, title, description, themeId, nodes };
}

function normalizeNode(
	input: unknown,
	path: string,
	depth: number,
	seenIds: Set<string>,
	addCount: (count: number) => void,
): BuilderNode {
	if (!isRecord(input)) throw new DocumentValidationError('Node must be an object.', path);
	if (depth > MAX_DEPTH) throw new DocumentValidationError(`Layout nesting cannot exceed ${MAX_DEPTH} levels.`, path);
	assertOnlyKeys(input, ['id', 'type', 'componentVersion', 'props', 'styles', 'responsiveStyles', 'children'], path);

	const id = requireText(input.id, 'node.id', 10, 90);
	if (!NODE_ID.test(id)) throw new DocumentValidationError('Node ID is invalid.', `${path}.id`);
	if (seenIds.has(id)) throw new DocumentValidationError('Node IDs must be unique.', `${path}.id`);
	seenIds.add(id);

	if (!isBuilderComponentType(input.type)) throw new DocumentValidationError('Unknown component type.', `${path}.type`);
	const type = input.type;
	const definition = COMPONENT_REGISTRY[type];
	if (input.componentVersion !== definition.version) {
		throw new DocumentValidationError(
			`Unsupported ${type} component version ${String(input.componentVersion)}; supported version is ${definition.version}.`,
			`${path}.componentVersion`,
		);
	}

	let props: ComponentPropsByType[typeof type];
	try {
		props = normalizeProps(type, input.props) as ComponentPropsByType[typeof type];
	} catch (error) {
		throw new DocumentValidationError(error instanceof Error ? error.message : 'Invalid component properties.', `${path}.props`);
	}
	let styles;
	let responsiveStyles;
	try {
		styles = normalizeNodeStyles(input.styles);
		responsiveStyles = normalizeResponsiveStyles(input.responsiveStyles);
	} catch (error) {
		throw new DocumentValidationError(error instanceof Error ? error.message : 'Invalid styles.', `${path}.styles`);
	}

	addCount(1);
	if (type === 'Container') {
		const childrenInput = input.children ?? [];
		if (!Array.isArray(childrenInput)) throw new DocumentValidationError('Container children must be an array.', `${path}.children`);
		const children = childrenInput.map((child, index) => {
			const normalized = normalizeNode(child, `${path}.children[${index}]`, depth + 1, seenIds, addCount);
			if (!(definition.allowedChildren as readonly BuilderComponentType[]).includes(normalized.type)) {
				throw new DocumentValidationError(`${normalized.type} is not allowed inside a container.`, `${path}.children[${index}]`);
			}
			return normalized;
		});
		return {
			id,
			type,
			componentVersion: definition.version,
			props: props as ComponentPropsByType['Container'],
			...(Object.keys(styles).length ? { styles } : {}),
			...(responsiveStyles ? { responsiveStyles } : {}),
			children,
		} satisfies ContainerNode;
	}

	if (input.children !== undefined) throw new DocumentValidationError(`${type} cannot contain child nodes.`, `${path}.children`);
	return {
		id,
		type,
		componentVersion: definition.version,
		props,
		...(Object.keys(styles).length ? { styles } : {}),
		...(responsiveStyles ? { responsiveStyles } : {}),
	} as BuilderNode;
}

/** Stable key order is used for autosave equality, revision snapshots, and tests. */
export function serializePageDocument(document: PageDocument): string {
	const validated = validatePageDocument(document, document.slug);
	return JSON.stringify(validated);
}

export function exportPageDocument(document: PageDocument): string {
	return `${serializePageDocument(document)}\n`;
}

export function importPageDocument(json: string, expectedSlug?: string): PageDocument {
	if (new TextEncoder().encode(json).byteLength > MAX_PAGE_JSON_BYTES) {
		throw new DocumentValidationError('Page document exceeds the 1 MiB import limit.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new DocumentValidationError('Page document is not valid JSON.');
	}
	return validatePageDocument(parsed, expectedSlug);
}

export function hiddenAtBreakpoint(node: BuilderNode, breakpoint: (typeof BREAKPOINTS)[number]): boolean {
	return node.responsiveStyles?.[breakpoint]?.hidden === true;
}
