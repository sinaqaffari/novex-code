import { useState } from 'react';
import { sandboxedCodeDocument } from '../../lib/builder/sandboxed-code.ts';
import type { CodeWidgetProps } from '../../lib/builder/types.ts';

/** Preview executes only after explicit action and never in the editor origin. */
export function CodeWidgetPreview({ props }: { props: CodeWidgetProps }) {
	const [source, setSource] = useState<string | null>(null);
	return <div className="nvx-builder-code-preview">
		<p>کد فقط در قاب جدا اجرا می‌شود. پیش از انتشار آن را بازبینی کنید.</p>
		<button type="button" onClick={(event) => { event.stopPropagation(); setSource(sandboxedCodeDocument(props)); }}>اجرای پیش‌نمایش مستقل</button>
		{source ? <><button type="button" onClick={(event) => { event.stopPropagation(); setSource(null); }}>بستن پیش‌نمایش کد</button><iframe title={props.title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={source} style={{ height: props.height }} /></> : null}
	</div>;
}
