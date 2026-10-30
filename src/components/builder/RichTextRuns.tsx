import { textRuns } from '../../lib/builder/rich-text.ts';
import type { TextMark } from '../../lib/builder/types.ts';

/** React preview uses the same validated runs as the public Astro renderer. */
export function RichTextRuns({ text, marks }: { text: string; marks?: TextMark[] }) {
	return textRuns(text, marks).map((run, index) => {
		let content = <>{run.text}</>;
		if (run.italic) content = <em>{content}</em>;
		if (run.bold) content = <strong>{content}</strong>;
		return run.href ? <a key={index} href={run.href} onClick={(event) => event.preventDefault()}>{content}</a> : <span key={index}>{content}</span>;
	});
}
