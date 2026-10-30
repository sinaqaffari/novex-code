import { RichTextFields } from './RichTextFields.tsx';
import { useEffect, useState } from 'react';
import { createNodeId } from '../../lib/builder/operations.ts';
import type { AccordionItem, GalleryItem, ListItem } from '../../lib/builder/types.ts';

type Change = (value: unknown, group?: string) => void;

function newId(items: ReadonlyArray<{ id: string }>): string | null {
	for (let attempt = 0; attempt < 32; attempt++) {
		const id = createNodeId().replace(/^node_/, 'item_');
		if (!items.some((item) => item.id === id)) return id;
	}
	return null;
}

function move<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
	const next = [...items];
	const target = index + direction;
	if (target < 0 || target >= next.length) return next;
	[next[index], next[target]] = [next[target], next[index]];
	return next;
}

export function AccordionFields({ items, onChange }: { items: AccordionItem[]; onChange: Change }) {
	const [error, setError] = useState('');
	function addItem() {
		const id = newId(items);
		if (!id) { setError('شناسهٔ یکتا برای پرسش تازه ساخته نشد؛ دوباره تلاش کنید.'); return; }
		setError('');
		onChange([...items, { id, title: '', body: '' }]);
	}
	return <div className="builder-collection-field">
		{items.map((item, index) => <fieldset className="builder-collection-item" key={item.id} data-testid="accordion-item">
			<legend>پرسش {index + 1}</legend>
			<RichTextFields id={`builder-accordion-${item.id}-title`} label="عنوان پرسش" maxLength={240} allowLinks={false} linkDisabledMessage="پیوند در عنوان تعاملی مجاز نیست؛ آن را در متن قرار دهید." value={{ text: item.title, marks: item.titleMarks ?? [] }} onChange={(value, historyKey) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, title: value.text, titleMarks: value.marks } : entry), historyKey ? `${item.id}:title:${historyKey}` : undefined)} />
			<RichTextFields id={`builder-accordion-${item.id}-body`} label="پاسخ" maxLength={5000} value={{ text: item.body, marks: item.bodyMarks ?? [] }} onChange={(value, historyKey) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, body: value.text, bodyMarks: value.marks } : entry), historyKey ? `${item.id}:body:${historyKey}` : undefined)} />
			<div className="builder-collection-actions">
				<button type="button" aria-label={`انتقال پرسش ${index + 1} به بالا`} disabled={index === 0} onClick={() => onChange(move(items, index, -1))}>↑</button>
				<button type="button" aria-label={`انتقال پرسش ${index + 1} به پایین`} disabled={index === items.length - 1} onClick={() => onChange(move(items, index, 1))}>↓</button>
				<button type="button" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}>حذف پرسش</button>
			</div>
		</fieldset>)}
		{error ? <p role="alert">{error}</p> : null}
		<button type="button" disabled={items.length >= 24} onClick={addItem}>افزودن پرسش</button>
	</div>;
}

export function GalleryFields({ items, onChange, canReadMedia, onPickMedia }: { items: GalleryItem[]; onChange: Change; canReadMedia: boolean; onPickMedia: (id: string) => void }) {
	const [error, setError] = useState('');
	function addItem() {
		const id = newId(items);
		if (!id) { setError('شناسهٔ یکتا برای تصویر تازه ساخته نشد؛ دوباره تلاش کنید.'); return; }
		setError('');
		onChange([...items, { id, src: '', alt: '', caption: '' }]);
	}
	return <div className="builder-collection-field">
		{items.map((item, index) => <fieldset className="builder-collection-item" key={item.id} data-testid="gallery-item">
			<legend>تصویر {index + 1}</legend>
			<GallerySource value={item.src} onCommit={(src) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, src } : entry))} />
			<button className="builder-media-picker-trigger" type="button" disabled={!canReadMedia} title={canReadMedia ? 'انتخاب از کتابخانهٔ رسانه' : 'نقش شما اجازهٔ خواندن رسانه را ندارد'} onClick={() => onPickMedia(item.id)}>انتخاب تصویر از رسانه</button>
			<label className="builder-field"><span>متن جایگزین</span><input value={item.alt} maxLength={240} onChange={(event) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, alt: event.target.value } : entry), `${item.id}:alt`)} /></label>
			<label className="builder-field"><span>زیرنویس</span><input value={item.caption} maxLength={240} onChange={(event) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, caption: event.target.value } : entry), `${item.id}:caption`)} /></label>
			<div className="builder-collection-actions">
				<button type="button" aria-label={`انتقال تصویر ${index + 1} به بالا`} disabled={index === 0} onClick={() => onChange(move(items, index, -1))}>↑</button>
				<button type="button" aria-label={`انتقال تصویر ${index + 1} به پایین`} disabled={index === items.length - 1} onClick={() => onChange(move(items, index, 1))}>↓</button>
				<button type="button" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}>حذف تصویر</button>
			</div>
		</fieldset>)}
		{error ? <p role="alert">{error}</p> : null}
		<button type="button" disabled={items.length >= 24} onClick={addItem}>افزودن تصویر</button>
	</div>;
}

function GallerySource({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	return <label className="builder-field"><span>نشانی تصویر</span><input dir="ltr" value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)} onBlur={() => onCommit(draft)} /></label>;
}

export function TabsFields({ items, onChange }: { items: AccordionItem[]; onChange: Change }) {
	const [error, setError] = useState('');
	function addItem() {
		const id = newId(items);
		if (!id) { setError('شناسهٔ یکتا برای زبانه ساخته نشد؛ دوباره تلاش کنید.'); return; }
		setError(''); onChange([...items, { id, title: '', body: '' }]);
	}
	return <div className="builder-collection-field">
		{items.map((item, index) => <fieldset className="builder-collection-item" key={item.id} data-testid="tab-item">
			<legend>زبانه {index + 1}</legend>
			<RichTextFields id={`builder-tab-${item.id}-title`} label="عنوان زبانه" maxLength={240} allowLinks={false} linkDisabledMessage="پیوند در عنوان تعاملی مجاز نیست؛ آن را در متن قرار دهید." value={{ text: item.title, marks: item.titleMarks ?? [] }} onChange={(value, historyKey) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, title: value.text, titleMarks: value.marks } : entry), historyKey ? `${item.id}:title:${historyKey}` : undefined)} />
			<RichTextFields id={`builder-tab-${item.id}-body`} label="متن زبانه" maxLength={5000} value={{ text: item.body, marks: item.bodyMarks ?? [] }} onChange={(value, historyKey) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, body: value.text, bodyMarks: value.marks } : entry), historyKey ? `${item.id}:body:${historyKey}` : undefined)} />
			<div className="builder-collection-actions">
				<button type="button" aria-label={`انتقال زبانه ${index + 1} به بالا`} disabled={index === 0} onClick={() => onChange(move(items, index, -1))}>↑</button>
				<button type="button" aria-label={`انتقال زبانه ${index + 1} به پایین`} disabled={index === items.length - 1} onClick={() => onChange(move(items, index, 1))}>↓</button>
				<button type="button" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}>حذف زبانه</button>
			</div>
		</fieldset>)}
		{error ? <p role="alert">{error}</p> : null}
		<button type="button" disabled={items.length >= 24} onClick={addItem}>افزودن زبانه</button>
	</div>;
}

export function ListFields({ items, onChange }: { items: ListItem[]; onChange: Change }) {
	const [error, setError] = useState('');
	function addItem() {
		const id = newId(items);
		if (!id) { setError('شناسهٔ یکتا برای مورد ساخته نشد؛ دوباره تلاش کنید.'); return; }
		setError(''); onChange([...items, { id, text: '', href: '' }]);
	}
	return <div className="builder-collection-field">
		{items.map((item, index) => <fieldset className="builder-collection-item" key={item.id} data-testid="list-item">
			<legend>مورد {index + 1}</legend>
			<RichTextFields id={`builder-list-${item.id}`} label="متن مورد" maxLength={5000} allowLinks={!item.href} value={{ text: item.text, marks: item.marks ?? [] }} onChange={(value, historyKey) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, text: value.text, marks: value.marks } : entry), historyKey ? `${item.id}:${historyKey}` : undefined)} />
			<ListHref value={item.href} onCommit={(href) => {
				if (href && item.marks?.some((mark) => mark.kind === 'link')) { setError('ابتدا پیوندهای درون متن این مورد را حذف کنید.'); return; }
				setError(''); onChange(items.map((entry) => entry.id === item.id ? { ...entry, href } : entry));
			}} />
			<div className="builder-collection-actions"><button type="button" aria-label={`انتقال مورد ${index + 1} به بالا`} disabled={index === 0} onClick={() => onChange(move(items, index, -1))}>↑</button><button type="button" aria-label={`انتقال مورد ${index + 1} به پایین`} disabled={index === items.length - 1} onClick={() => onChange(move(items, index, 1))}>↓</button><button type="button" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}>حذف مورد</button></div>
		</fieldset>)}
		{error ? <p role="alert">{error}</p> : null}
		<button type="button" disabled={items.length >= 24} onClick={addItem}>افزودن مورد</button>
	</div>;
}

function ListHref({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	return <label className="builder-field"><span>پیوند اختیاری مورد</span><input dir="ltr" value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)} onBlur={() => onCommit(draft)} /></label>;
}
