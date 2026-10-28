import { asBoolean, asText } from './http';
import type { PostInput } from './posts';

/** Map a raw form/JSON payload onto the post store's input shape. */
export function toPostInput(payload: Record<string, unknown>): PostInput {
	return {
		title: asText(payload.title),
		description: asText(payload.description),
		slug: asText(payload.slug),
		pubDate: asText(payload.pubDate),
		heroImage: asText(payload.heroImage),
		tags: (payload.tags as string | string[] | undefined) ?? '',
		draft: asBoolean(payload.draft),
		body: asText(payload.body),
	};
}
