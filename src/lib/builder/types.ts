export const PAGE_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const COMPONENT_VERSION = 1 as const;

import type { ProductGridBinding } from '../commerce/types.ts';

export const BUILDER_COMPONENT_TYPES = ['Container', 'Heading', 'Text', 'Image', 'Button', 'ProductGrid'] as const;
export type BuilderComponentType = (typeof BUILDER_COMPONENT_TYPES)[number];

export const BREAKPOINTS = ['desktop', 'tablet', 'mobile'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

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
	level: 1 | 2 | 3 | 4;
	align: TextAlign;
	color: ThemeColor;
	size: 'sm' | 'md' | 'lg' | 'xl';
}

export interface TextProps {
	text: string;
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

export interface ProductGridProps {
	heading: string;
	emptyMessage: string;
	binding: ProductGridBinding;
}

export interface ComponentPropsByType {
	Container: ContainerProps;
	Heading: HeadingProps;
	Text: TextProps;
	Image: ImageProps;
	Button: ButtonProps;
	ProductGrid: ProductGridProps;
}

/** A controlled, token-based style surface. No raw CSS is accepted. */
export interface NodeStyles {
	width?: 'content' | 'full' | 'narrow' | 'wide';
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

export interface ContainerNode extends NodeBase<'Container'> {
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

export interface ProductGridNode extends NodeBase<'ProductGrid'> {
	children?: never;
}

export type BuilderNode = ContainerNode | HeadingNode | TextNode | ImageNode | ButtonNode | ProductGridNode;

export interface PageDocument {
	schemaVersion: typeof PAGE_DOCUMENT_SCHEMA_VERSION;
	id: string;
	slug: string;
	title: string;
	description: string;
	themeId: BuilderThemeId;
	nodes: BuilderNode[];
}

export type InspectorFieldKind = 'text' | 'textarea' | 'select' | 'number' | 'url' | 'toggle';

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
	previewRenderer: 'container' | 'heading' | 'text' | 'image' | 'button' | 'productGrid';
	productionRenderer: 'BuilderNode.astro';
}
