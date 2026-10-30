import { useRef, useState } from 'react';
import { adjustTextMarks, clearTextMark, setTextMark } from '../../lib/builder/rich-text.ts';
import type { TextMark } from '../../lib/builder/types.ts';

export interface RichTextFieldValue { text: string; marks: TextMark[] }

/** Textarea selection offsets are the same UTF-16 offsets used by the document. */
export function RichTextFields({ value, onChange, label, maxLength, id = 'builder-field-text', allowLinks = true, linkDisabledMessage = 'برای پیوندهای درون متن، ابتدا پیوند کل مورد را پاک کنید.' }: { value: RichTextFieldValue; onChange: (value: RichTextFieldValue, historyKey?: string) => void; label: string; maxLength: number; id?: string; allowLinks?: boolean; linkDisabledMessage?: string }) {
	const textarea = useRef<HTMLTextAreaElement>(null);
	const [selection, setSelection] = useState({ start: 0, end: 0 });
	const [href, setHref] = useState('');
	const [error, setError] = useState('');
	function rememberSelection(element: HTMLTextAreaElement) {
		setSelection({ start: element.selectionStart, end: element.selectionEnd });
	}
	function apply(kind: TextMark['kind'], remove = false) {
		try {
			const active = textarea.current && document.activeElement === textarea.current ? { start: textarea.current.selectionStart, end: textarea.current.selectionEnd } : selection;
			const next = remove ? clearTextMark(value.text, value.marks, active.start, active.end, kind) : setTextMark(value.text, value.marks, active.start, active.end, kind, href);
			onChange({ text: value.text, marks: next });
			setError('');
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'قالب‌بندی معتبر نیست.');
		}
	}
	return <div className="builder-rich-text">
		<label className="builder-field" htmlFor={id}><span>{label}</span>
			<textarea id={id} ref={textarea} value={value.text} maxLength={maxLength} rows={maxLength <= 240 ? 2 : 5} onSelect={(event) => rememberSelection(event.currentTarget)} onBlur={(event) => rememberSelection(event.currentTarget)} onChange={(event) => {
				const next = event.target.value;
				try {
					onChange({ text: next, marks: adjustTextMarks(value.text, next, value.marks) }, 'typing');
					rememberSelection(event.currentTarget);
					setError('');
				} catch (cause) { setError(cause instanceof Error ? cause.message : 'ویرایش متن ممکن نیست.'); }
			}} />
		</label>
		<p className="builder-field-hint">بخشی از متن را انتخاب و سپس قالب‌بندی یا پیوند را اعمال کنید. متن و پیوندها ایمن ذخیره می‌شوند.</p>
		<div className="builder-rich-text__actions" role="group" aria-label="قالب‌بندی متن">
			<button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => apply('bold')}>پررنگ</button>
			<button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => apply('italic')}>کج</button>
			{allowLinks ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => apply('link', true)}>حذف پیوند</button> : null}
		</div>
		{allowLinks ? <><label className="builder-field" htmlFor={`${id}-link`}><span>نشانی پیوند</span><input id={`${id}-link`} dir="ltr" type="text" value={href} maxLength={500} placeholder="/about" onChange={(event) => setHref(event.target.value)} /></label>
		<button type="button" onClick={() => apply('link')}>اعمال پیوند به انتخاب</button></> : <p className="builder-field-hint">{linkDisabledMessage}</p>}
		{error ? <p className="builder-rich-text__error" role="alert">{error}</p> : null}
	</div>;
}
