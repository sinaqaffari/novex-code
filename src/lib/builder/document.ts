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
	type Breakpoint,
	type BuilderComponentType,
	type BuilderNode,
	type ComponentPropsByType,
	type ContainerNode,
	type PageDocument,
	type SharedSectionReference,
} from './types.ts';
import { isBuilderThemeId } from './themes.ts';
import { normalizeBreakpointWidths } from './responsive.ts';

const MAX_NODES = 200;
const MAX_DEPTH = 8;
const MAX_PAGE_JSON_BYTES = 1024 * 1024;
const PAGE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_ID = /^node_[A-Za-z0-9_-]{6,80}$/;
const PAGE_ID = /^page_[a-z0-9-]{1,60}$/;

export class DocumentValidationError extends Error {
	readonly path: string;
	readonly code: string;

	constructor(message: string, path = '', code = 'invalid_document') {
		super(path ? `${message} (${path})` : message);
		this.name = 'DocumentValidationError';
		this.path = path;
		this.code = code;
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

/** Each step produces the next version without mutating the original. Stored
 * revisions are never rewritten on read, so the original file remains the backup. */
type Migration = (input: Record<string, unknown>) => Record<string, unknown>;
const DOCUMENT_MIGRATIONS: Readonly<Record<number, Migration>> = {
	0: migrateVersionZero,
	1: (input) => ({ ...input, schemaVersion: 2 }),
	2: (input) => {
		// The old version did not accept custom thresholds; reject ambiguous data.
		assertOnlyKeys(input, ['schemaVersion', 'id', 'slug', 'title', 'description', 'themeId', 'nodes'], 'document');
		assertVersionTwoNodes(input.nodes);
		return { ...input, schemaVersion: 3 };
	},
	3: (input) => {
		assertOnlyKeys(input, ['schemaVersion', 'id', 'slug', 'title', 'description', 'themeId', 'breakpoints', 'nodes'], 'document');
		if (isRecord(input.breakpoints)) assertOnlyKeys(input.breakpoints, ['tablet', 'mobile'], 'breakpoints');
		assertVersionThreeNodes(input.nodes);
		return { ...input, schemaVersion: 4 };
	},
	4: (input) => {
		// Formatting ranges did not exist in v4; do not reinterpret foreign data.
		assertVersionFourNodes(input.nodes);
		return { ...input, schemaVersion: 5 };
	},
};

function assertVersionFourNodes(nodes: unknown, depth = 1, count = { value: 0 }): void {
	if (!Array.isArray(nodes)) return;
	if (depth > MAX_DEPTH) throw new DocumentValidationError('Legacy node nesting is too deep.', 'nodes');
	for (const node of nodes) {
		if (++count.value > MAX_NODES) throw new DocumentValidationError('Legacy page has too many nodes.', 'nodes');
		if (!isRecord(node)) continue;
		if ((node.type === 'Text' || node.type === 'Heading' || node.type === 'Blockquote') && isRecord(node.props) && Object.hasOwn(node.props, 'marks')) throw new DocumentValidationError('Text formatting is not part of schema v4.', 'nodes');
		if (node.type === 'List' && isRecord(node.props) && Array.isArray(node.props.items) && node.props.items.some((item: unknown) => isRecord(item) && Object.hasOwn(item, 'marks'))) throw new DocumentValidationError('List formatting is not part of schema v4.', 'nodes');
		if ((node.type === 'Accordion' || node.type === 'Tabs') && isRecord(node.props) && Array.isArray(node.props.items) && node.props.items.some((item: unknown) => isRecord(item) && (Object.hasOwn(item, 'titleMarks') || Object.hasOwn(item, 'bodyMarks')))) throw new DocumentValidationError('Collection formatting is not part of schema v4.', 'nodes');
		if (Array.isArray(node.children)) assertVersionFourNodes(node.children, depth + 1, count);
	}
}

/** Version three only knew the three built-in responsive keys. */
function assertVersionThreeNodes(nodes: unknown, depth = 1, count = { value: 0 }): void {
	if (!Array.isArray(nodes)) return;
	if (depth > MAX_DEPTH) throw new DocumentValidationError('Legacy node nesting is too deep.', 'nodes');
	for (const node of nodes) {
		if (++count.value > MAX_NODES) throw new DocumentValidationError('Legacy page has too many nodes.', 'nodes');
		if (!isRecord(node)) continue;
		if (node.type === 'GlobalCode' || node.type === 'Tabs' || node.type === 'List') throw new DocumentValidationError('This component is not part of schema v3.', 'nodes');
		if (isRecord(node.responsiveStyles)) assertOnlyKeys(node.responsiveStyles, BREAKPOINTS, 'responsiveStyles');
		if (Array.isArray(node.children)) assertVersionThreeNodes(node.children, depth + 1, count);
	}
}

function assertVersionTwoNodes(nodes: unknown, depth = 1, count = { value: 0 }): void {
	if (!Array.isArray(nodes)) return; // Current validation reports malformed children.
	if (depth > MAX_DEPTH) throw new DocumentValidationError('Legacy node nesting is too deep.', 'nodes');
	for (const node of nodes) {
		if (++count.value > MAX_NODES) throw new DocumentValidationError('Legacy page has too many nodes.', 'nodes');
		if (!isRecord(node)) continue;
		assertOnlyKeys(node, ['id', 'type', 'componentVersion', 'props', 'styles', 'responsiveStyles', 'children'], 'node');
		if (node.type === 'CodeWidget' || node.type === 'GlobalCode') throw new DocumentValidationError('Code widgets are not part of schema v2.', 'nodes');
		if (Array.isArray(node.children)) assertVersionTwoNodes(node.children, depth + 1, count);
	}
}

export function migratePageDocument(input: unknown): unknown {
	if (!isRecord(input)) throw new DocumentValidationError('Page document must be an object.');
	let current = input;
	while (current.schemaVersion !== PAGE_DOCUMENT_SCHEMA_VERSION) {
		const version = current.schemaVersion;
		const migration = typeof version === 'number' && Number.isInteger(version) ? DOCUMENT_MIGRATIONS[version] : undefined;
		if (!migration) throw new DocumentValidationError(`Unsupported page schema version: ${String(version)}.`, 'schemaVersion', 'unsupported_document_version');
		const next = migration(current);
		if (next.schemaVersion !== (version as number) + 1) throw new DocumentValidationError('Document migration did not advance one version.', 'schemaVersion');
		current = next;
	}
	return current;
}

function migrateVersionZero(input: Record<string, unknown>): Record<string, unknown> {
	// Reject rather than silently discard fields that this migration cannot map.
	assertOnlyKeys(input, ['schemaVersion', 'id', 'slug', 'title', 'description', 'themeId', 'nodes', 'blocks'], 'document');
	if (input.nodes !== undefined && input.blocks !== undefined) throw new DocumentValidationError('Legacy document contains both nodes and blocks.', 'document');
	if (input.id !== undefined && typeof input.id !== 'string') throw new DocumentValidationError('Legacy page ID is invalid.', 'id');
	if (input.description !== undefined && typeof input.description !== 'string') throw new DocumentValidationError('Legacy description is invalid.', 'description');
	if (input.themeId === null) throw new DocumentValidationError('Legacy theme is invalid.', 'themeId');
	const legacyNodes = input.nodes !== undefined ? input.nodes : input.blocks !== undefined ? input.blocks : [];
	if (!Array.isArray(legacyNodes)) throw new DocumentValidationError('Legacy nodes must be an array.', 'nodes');
	let count = 0;
	const ancestors = new WeakSet<object>();
	function migrateLegacyNode(node: unknown, depth: number): unknown {
		if (!isRecord(node)) return node;
		if (depth > MAX_DEPTH) throw new DocumentValidationError(`Layout nesting cannot exceed ${MAX_DEPTH} levels.`, 'nodes');
		if (++count > MAX_NODES) throw new DocumentValidationError(`Page may contain no more than ${MAX_NODES} nodes.`, 'nodes');
		if (ancestors.has(node)) throw new DocumentValidationError('Cyclic node references are not allowed.', 'nodes', 'cyclic_tree');
		ancestors.add(node);
		assertOnlyKeys(node, ['id', 'type', 'componentVersion', 'props', 'styles', 'responsiveStyles', 'children'], 'node');
		if (node.type === 'CodeWidget' || node.type === 'GlobalCode') throw new DocumentValidationError('Code widgets are not part of schema v2.', 'nodes');
		const aliases: Record<string, BuilderComponentType> = { container: 'Container', heading: 'Heading', text: 'Text', image: 'Image', button: 'Button' };
		const rawType = typeof node.type === 'string' ? node.type : '';
		const type = aliases[rawType] ?? rawType;
		const children = node.children;
		const result = {
			id: node.id,
			type,
			componentVersion: node.componentVersion === undefined ? 1 : node.componentVersion,
			props: node.props === undefined ? {} : node.props,
			styles: node.styles === undefined ? {} : node.styles,
			...(node.responsiveStyles !== undefined ? { responsiveStyles: node.responsiveStyles } : {}),
			...(children !== undefined ? { children: Array.isArray(children) ? children.map((child) => migrateLegacyNode(child, depth + 1)) : children } : type === 'Container' ? { children: [] } : {}),
		};
		ancestors.delete(node);
		return result;
	}
	return {
		schemaVersion: 1,
		id: typeof input.id === 'string' ? input.id : `page_${String(input.slug ?? 'untitled')}`,
		slug: input.slug,
		title: input.title,
		description: input.description ?? '',
		themeId: input.themeId ?? 'site',
		nodes: legacyNodes.map((node) => migrateLegacyNode(node, 1)),
	};
}

export function validatePageDocument(input: unknown, expectedSlug?: string): PageDocument {
	const migrated = migratePageDocument(input);
	if (!isRecord(migrated)) throw new DocumentValidationError('Page document must be an object.');
	assertOnlyKeys(migrated, ['schemaVersion', 'id', 'slug', 'title', 'description', 'themeId', 'breakpoints', 'nodes'], 'document');

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
	let breakpoints;
	try { breakpoints = normalizeBreakpointWidths(migrated.breakpoints); }
	catch (error) { throw new DocumentValidationError(error instanceof Error ? error.message : 'Invalid breakpoints.', 'breakpoints', 'invalid_breakpoints'); }
	if (!Array.isArray(migrated.nodes) || migrated.nodes.length > MAX_NODES) {
		throw new DocumentValidationError(`Page must contain no more than ${MAX_NODES} top-level nodes.`, 'nodes');
	}

	const seenIds = new Set<string>();
	const allowedBreakpoints: Breakpoint[] = [...BREAKPOINTS, ...(breakpoints?.custom ?? []).map((entry) => entry.id)];
	let nodeCount = 0;
	const nodes = migrated.nodes.map((node, index) => normalizeNode(node, `nodes[${index}]`, 1, seenIds, (count) => {
		nodeCount += count;
		if (nodeCount > MAX_NODES) throw new DocumentValidationError(`Page may contain no more than ${MAX_NODES} nodes.`, 'nodes');
	}, allowedBreakpoints));
	return { schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION, id, slug, title, description, themeId, ...(breakpoints ? { breakpoints } : {}), nodes };
}

function normalizeNode(
	input: unknown,
	path: string,
	depth: number,
	seenIds: Set<string>,
	addCount: (count: number) => void,
	allowedBreakpoints: readonly Breakpoint[],
	insideShared = false,
): BuilderNode {
	if (!isRecord(input)) throw new DocumentValidationError('Node must be an object.', path);
	if (depth > MAX_DEPTH) throw new DocumentValidationError(`Layout nesting cannot exceed ${MAX_DEPTH} levels.`, path);
	assertOnlyKeys(input, ['id', 'type', 'componentVersion', 'props', 'styles', 'responsiveStyles', 'children', 'sharedSection'], path);

	const id = requireText(input.id, 'node.id', 10, 90);
	if (!NODE_ID.test(id)) throw new DocumentValidationError('Node ID is invalid.', `${path}.id`);
	if (seenIds.has(id)) throw new DocumentValidationError('Node IDs must be unique.', `${path}.id`, 'duplicate_node_id');
	seenIds.add(id);

	if (!isBuilderComponentType(input.type)) throw new DocumentValidationError('Unknown component type.', `${path}.type`, 'unknown_component');
	const type = input.type;
	const definition = COMPONENT_REGISTRY[type];
	if (input.componentVersion !== definition.version) {
		throw new DocumentValidationError(
			`Unsupported ${type} component version ${String(input.componentVersion)}; supported version is ${definition.version}.`,
			`${path}.componentVersion`,
			'unsupported_component_version',
		);
	}

	let props: ComponentPropsByType[typeof type];
	try {
		props = normalizeProps(type, input.props) as ComponentPropsByType[typeof type];
	} catch (error) {
		throw new DocumentValidationError(error instanceof Error ? error.message : 'Invalid component properties.', `${path}.props`, 'invalid_component_property');
	}
	let styles;
	let responsiveStyles;
	try {
		styles = normalizeNodeStyles(input.styles);
		responsiveStyles = normalizeResponsiveStyles(input.responsiveStyles, allowedBreakpoints);
	} catch (error) {
		throw new DocumentValidationError(error instanceof Error ? error.message : 'Invalid styles.', `${path}.styles`, 'invalid_style');
	}

	if (type === 'GlobalCode' && (depth !== 1 || Object.keys(styles).length > 0 || responsiveStyles)) {
		throw new DocumentValidationError('Global code must be a top-level, non-responsive component.', path, 'invalid_global_code');
	}
	addCount(1);
	let sharedSection: SharedSectionReference | undefined;
	if (input.sharedSection !== undefined) {
		const ref = input.sharedSection;
		if (type !== 'Container' || insideShared || !isRecord(ref)) throw new DocumentValidationError('Shared sections must be non-nested containers.', `${path}.sharedSection`, 'invalid_shared_section');
		assertOnlyKeys(ref, ['id', 'revision', 'baselineHash'], `${path}.sharedSection`);
		if (typeof ref.id !== 'string' || !/^section_[a-f0-9-]{36}$/.test(ref.id) || !Number.isSafeInteger(ref.revision) || (ref.revision as number) < 1 || typeof ref.baselineHash !== 'string' || !/^[a-f0-9]{64}$/.test(ref.baselineHash)) {
			throw new DocumentValidationError('Shared section reference is invalid.', `${path}.sharedSection`, 'invalid_shared_section');
		}
		sharedSection = { id: ref.id, revision: ref.revision as number, baselineHash: ref.baselineHash };
	}
	if (type === 'Container') {
		const childrenInput = input.children ?? [];
		if (!Array.isArray(childrenInput)) throw new DocumentValidationError('Container children must be an array.', `${path}.children`);
		const children = childrenInput.map((child, index) => {
			const normalized = normalizeNode(child, `${path}.children[${index}]`, depth + 1, seenIds, addCount, allowedBreakpoints, insideShared || Boolean(sharedSection));
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
			...(sharedSection ? { sharedSection } : {}),
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

export function hiddenAtBreakpoint(node: BuilderNode, breakpoint: Breakpoint): boolean {
	return node.responsiveStyles?.[breakpoint]?.hidden === true;
}
