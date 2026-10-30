import type { BuilderNode, VideoEmbedProps } from './types.ts';

export type ExtendedContentNode = Extract<BuilderNode, { type: 'Blockquote' | 'Accordion' | 'Tabs' | 'List' | 'ImageGallery' | 'VideoEmbed' }>;

export function isExtendedContentNode(node: BuilderNode): node is ExtendedContentNode {
	return node.type === 'Blockquote' || node.type === 'Accordion' || node.type === 'Tabs' || node.type === 'List' || node.type === 'ImageGallery' || node.type === 'VideoEmbed';
}

/** Only IDs, never user-supplied URLs, are interpolated into these fixed hosts. */
export function videoEmbedUrl(props: VideoEmbedProps): string | null {
	if (props.provider === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(props.youtubeId)) return `https://www.youtube-nocookie.com/embed/${props.youtubeId}`;
	if (props.provider === 'vimeo' && /^[1-9][0-9]{5,11}$/.test(props.vimeoId)) return `https://player.vimeo.com/video/${props.vimeoId}`;
	return null;
}
