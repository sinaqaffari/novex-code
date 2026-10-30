export const PAGE_DOCUMENT_SCHEMA_VERSION = 5 as const;
export const COMPONENT_VERSION = 1 as const;

import type { ProductGridBinding } from '../commerce/types.ts';

export const BUILDER_COMPONENT_TYPES = ['Container', 'Heading', 'Text', 'Image', 'Button', 'Spacer', 'Divider', 'Blockquote', 'Accordion', 'Tabs', 'List', 'ImageGallery', 'VideoEmbed', 'CodeWidget', 'GlobalCode', 'ProductGrid', 'PluginBlock'] as const;
export type BuilderComponentType = (typeof BUILDER_COMPONENT_TYPES)[number];

export const BREAKPOINTS = ['desktop', 'tablet', 'mobile'] as const;
export type BuiltinBreakpoint = (typeof BREAKPOINTS)[number];
/** Custom IDs occupy a reserved namespace and are validated against the document. */
export type CustomBreakpointId = `bp_${string}`;
export type Breakpoint = BuiltinBreakpoint | CustomBreakpointId;
export interface CustomBreakpoint { id: CustomBreakpointId; label: string; maxWidth: number }
/** Per-document maximum widths, including a bounded set of author-defined ranges. */
export interface BreakpointWidths { tablet: number; mobile: number; custom?: CustomBreakpoint[] }

export const BUILDER_THEME_IDS = ['site', 'ocean', 'warm'] as const;
export type BuilderThemeId = (typeof BUILDER_THEME_IDS)[number];

export const SPACING_STEPS = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;
export type SpacingStep = (typeof SPACING_STEPS)[number];

export type TextAlign = 'start' | 'center' | 'end';
export type ThemeColor = 'ink' | 'muted' | 'brand' | 'surface' | 'soft';

export interface ContainerProps {
	layout: 'stack' | 'row' | 'grid';
	maxWidth: 'sm' | 'md' | 'lg' | 'full';
	gap: SpacingStep;
	padding: SpacingStep;
	background: 'none' | 'surface' | 'soft' | 'brand';
}

export interface HeadingProps {
	text: string;
	marks?: TextMark[];
	level: 1 | 2 | 3 | 4;
	align: TextAlign;
	color: ThemeColor;
	size: 'sm' | 'md' | 'lg' | 'xl';
}

export type TextMark =
	| { kind: 'bold' | 'italic'; start: number; end: number }
	| { kind: 'link'; start: number; end: number; href: string };

export interface TextProps {
	text: string;
	/** UTF-16 ranges over text; absent on legacy and unformatted paragraphs. */
	marks?: TextMark[];
	align: TextAlign;
	color: ThemeColor;
	size: 'sm' | 'md' | 'lg';
}

export interface ImageProps {
	src: string;
	alt: string;
	caption: string;
	aspectRatio: 'auto' | 'wide' | 'square' | 'portrait';
	fit: 'cover' | 'contain';
}

export interface ButtonProps {
	label: string;
	href: string;
	variant: 'primary' | 'outline';
	align: TextAlign;
}

export interface SpacerProps { size: number }
export interface DividerProps {
	thickness: 1 | 2 | 4;
	lineStyle: 'solid' | 'dashed' | 'dotted';
	color: 'muted' | 'ink' | 'brand';
}

/** Content collections use stable IDs scoped to their owning node. */
export interface AccordionItem { id: string; title: string; body: string; titleMarks?: TextMark[]; bodyMarks?: TextMark[] }
export interface AccordionProps { items: AccordionItem[] }
export interface TabsProps { items: AccordionItem[] }
export interface ListItem { id: string; text: string; href: string; marks?: TextMark[] }
export interface ListProps { kind: 'ordered' | 'unordered'; items: ListItem[] }
export interface GalleryItem { id: string; src: string; alt: string; caption: string }
export interface ImageGalleryProps { items: GalleryItem[]; columns: 1 | 2 | 3 | 4 }
export interface BlockquoteProps { text: string; marks?: TextMark[]; author: string; role: string }
/** Executable author content, isolated to an opaque-origin browser frame. */
export interface CodeWidgetProps {
	title: string;
	html: string;
	css: string;
	javascript: string;
	height: number;
}

/** Privileged author code executed in the published page's origin, not a plugin. */
export interface GlobalCodeProps { title: string; css: string; javascript: string }

export interface VideoEmbedProps {
	provider: 'youtube' | 'vimeo';
	youtubeId: string;
	vimeoId: string;
	title: string;
}

export interface ProductGridProps {
	heading: string;
	emptyMessage: string;
	binding: ProductGridBinding;
}

/** Persisted declarative component snapshot; contains data, never executable code. */
export interface PluginBlockField { key: string; label: string; kind: 'text' | 'textarea' | 'url'; value: string; maxLength: number }
export interface PluginBlockPart { type: 'heading' | 'text' | 'button'; textKey: string; hrefKey?: string }
export interface PluginBlockProps {
	pluginId: string;
	componentId: string;
	pluginVersion: string;
	label: string;
	fields: PluginBlockField[];
	parts: PluginBlockPart[];
}

export interface ComponentPropsByType {
	Container: ContainerProps;
	Heading: HeadingProps;
	Text: TextProps;
	Image: ImageProps;
	Button: ButtonProps;
	Spacer: SpacerProps;
	Divider: DividerProps;
	Blockquote: BlockquoteProps;
	Accordion: AccordionProps;
	Tabs: TabsProps;
	List: ListProps;
	ImageGallery: ImageGalleryProps;
	VideoEmbed: VideoEmbedProps;
	CodeWidget: CodeWidgetProps;
	GlobalCode: GlobalCodeProps;
	ProductGrid: ProductGridProps;
	PluginBlock: PluginBlockProps;
}

/** A controlled, token-based style surface. No raw CSS is accepted. */
export interface NodeStyles {
	width?: string; // validated tokens or CSS lengths by normalizeLayoutLength
	height?: string;
	minWidth?: string;
	maxWidth?: string;
	minHeight?: string;
	maxHeight?: string;
	layout?: 'block' | 'flex' | 'grid' | 'inline-block';
	direction?: 'row' | 'column';
	columns?: 1 | 2 | 3 | 4 | 6;
	gap?: SpacingStep;
	alignItems?: 'start' | 'center' | 'end' | 'stretch';
	justifyContent?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
	overflow?: 'visible' | 'hidden' | 'auto';
	marginBlockStart?: SpacingStep;
	marginBlockEnd?: SpacingStep;
	paddingBlockStart?: SpacingStep;
	paddingBlockEnd?: SpacingStep;
	paddingInlineStart?: SpacingStep;
	paddingInlineEnd?: SpacingStep;
	borderRadius?: 'none' | 'sm' | 'md' | 'lg';
}

export interface ResponsiveNodeStyles extends Partial<NodeStyles> {
	hidden?: boolean;
}

interface NodeBase<T extends BuilderComponentType> {
	id: string;
	type: T;
	componentVersion: number;
	props: ComponentPropsByType[T];
	styles?: NodeStyles;
	responsiveStyles?: Partial<Record<Breakpoint, ResponsiveNodeStyles>>;
}

export interface SharedSectionReference { id: string; revision: number; baselineHash: string }

/** A linked section always carries its own renderable snapshot. */
export interface ContainerNode extends NodeBase<'Container'> {
	sharedSection?: SharedSectionReference;
	children: BuilderNode[];
}

export interface HeadingNode extends NodeBase<'Heading'> {
	children?: never;
}

export interface TextNode extends NodeBase<'Text'> {
	children?: never;
}

export interface ImageNode extends NodeBase<'Image'> {
	children?: never;
}

export interface ButtonNode extends NodeBase<'Button'> {
	children?: never;
}

export interface SpacerNode extends NodeBase<'Spacer'> { children?: never }
export interface DividerNode extends NodeBase<'Divider'> { children?: never }
export interface BlockquoteNode extends NodeBase<'Blockquote'> { children?: never }
export interface AccordionNode extends NodeBase<'Accordion'> { children?: never }
export interface TabsNode extends NodeBase<'Tabs'> { children?: never }
export interface ListNode extends NodeBase<'List'> { children?: never }
export interface ImageGalleryNode extends NodeBase<'ImageGallery'> { children?: never }
export interface VideoEmbedNode extends NodeBase<'VideoEmbed'> { children?: never }
export interface CodeWidgetNode extends NodeBase<'CodeWidget'> { children?: never }
export interface GlobalCodeNode extends NodeBase<'GlobalCode'> { children?: never }

export interface ProductGridNode extends NodeBase<'ProductGrid'> {
	children?: never;
}

export interface PluginBlockNode extends NodeBase<'PluginBlock'> { children?: never }

export type BuilderNode = ContainerNode | HeadingNode | TextNode | ImageNode | ButtonNode | SpacerNode | DividerNode | BlockquoteNode | AccordionNode | TabsNode | ListNode | ImageGalleryNode | VideoEmbedNode | CodeWidgetNode | GlobalCodeNode | ProductGridNode | PluginBlockNode;

export interface PageDocument {
	schemaVersion: typeof PAGE_DOCUMENT_SCHEMA_VERSION;
	id: string;
	slug: string;
	title: string;
	description: string;
	themeId: BuilderThemeId;
	breakpoints?: BreakpointWidths;
	nodes: BuilderNode[];
}

export type InspectorFieldKind = 'text' | 'textarea' | 'select' | 'number' | 'url' | 'length' | 'toggle' | 'identifier' | 'accordion-items' | 'tab-items' | 'list-items' | 'gallery-items' | 'rich-text';

export interface InspectorField {
	key: string;
	label: string;
	kind: InspectorFieldKind;
	options?: readonly { value: string | number; label: string }[];
	maxLength?: number;
	min?: number;
	max?: number;
	group: 'content' | 'layout' | 'style' | 'responsive';
}

export interface ComponentDefinition<T extends BuilderComponentType = BuilderComponentType> {
	type: T;
	version: number;
	label: string;
	category: 'layout' | 'content' | 'media' | 'action' | 'commerce';
	description: string;
	documentation: string;
	example: string;
	defaultProps: ComponentPropsByType[T];
	fields: readonly InspectorField[];
	allowedChildren: readonly BuilderComponentType[];
	supportsChildren: boolean;
	previewRenderer: 'container' | 'heading' | 'text' | 'image' | 'button' | 'spacer' | 'divider' | 'blockquote' | 'accordion' | 'tabs' | 'list' | 'imageGallery' | 'videoEmbed' | 'codeWidget' | 'globalCode' | 'productGrid' | 'pluginBlock';
	productionRenderer: 'BuilderNode.astro';
}
