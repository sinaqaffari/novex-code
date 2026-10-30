import { RichTextRuns } from './RichTextRuns.tsx';
import { useEffect, useState, type KeyboardEvent } from 'react';
import type { TabsNode } from '../../lib/builder/types.ts';
import { resolveBuilderImageSource } from '../../lib/builder/media-reference.ts';
import { videoEmbedUrl, type ExtendedContentNode } from '../../lib/builder/extended-content.ts';

/** Editor/read-only preview of the same host-owned primitives used by Astro. */
export function ExtendedContent({ node }: { node: ExtendedContentNode }) {
	if (node.type === 'Blockquote') return (
		<blockquote className="nvx-builder-quote">
			<p><RichTextRuns text={node.props.text} marks={node.props.marks} /></p>
			{node.props.author || node.props.role ? <footer>{node.props.author ? <cite>{node.props.author}</cite> : null}{node.props.author && node.props.role ? ' · ' : null}{node.props.role}</footer> : null}
		</blockquote>
	);
	if (node.type === 'Accordion') return (
		<div className="nvx-builder-accordion">
			{node.props.items.map((item) => <details key={item.id}><summary>{item.title ? <RichTextRuns text={item.title} marks={item.titleMarks} /> : 'پرسش بدون عنوان'}</summary><p><RichTextRuns text={item.body} marks={item.bodyMarks} /></p></details>)}
			{node.props.items.length ? null : <p className="nvx-builder-empty">هنوز پرسشی ثبت نشده است.</p>}
		</div>
	);
	if (node.type === 'Tabs') return <InteractiveTabs node={node} />;
	if (node.type === 'List') {
		const items = node.props.items.map((item) => <li key={item.id}>{item.href ? <a href={item.href} onClick={(event) => event.preventDefault()}><RichTextRuns text={item.text} marks={item.marks} /></a> : <RichTextRuns text={item.text} marks={item.marks} />}</li>);
		return node.props.kind === 'ordered' ? <ol className="nvx-builder-list">{items}</ol> : <ul className="nvx-builder-list">{items}</ul>;
	}
	if (node.type === 'ImageGallery') return (
		<div className="nvx-builder-gallery" data-columns={node.props.columns}>
			{node.props.items.map((item) => <figure className="nvx-builder-gallery__item" key={item.id}>
				<div className="nvx-builder-gallery__frame">{item.src ? <PreviewGalleryImage src={resolveBuilderImageSource(item.src)} alt={item.alt} /> : <span className="nvx-builder-image__empty" role="img" aria-label={item.alt || 'تصویر انتخاب نشده است'}>تصویر انتخاب نشده است</span>}</div>
				{item.caption ? <figcaption>{item.caption}</figcaption> : null}
			</figure>)}
			{node.props.items.length ? null : <p className="nvx-builder-empty">هنوز تصویری ثبت نشده است.</p>}
		</div>
	);
	const url = videoEmbedUrl(node.props);
	return <div className="nvx-builder-video"><div className="nvx-builder-video__placeholder">{url ? `پیش‌نمایش ${node.props.provider === 'youtube' ? 'YouTube' : 'Vimeo'}؛ ویدئو در صفحهٔ منتشرشده بارگیری می‌شود.` : 'شناسهٔ معتبر ویدئو هنوز ثبت نشده است.'}</div></div>;
}

function PreviewGalleryImage({ src, alt }: { src: string; alt: string }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [src]);
	return failed ? <span className="nvx-builder-image__empty" role="img" aria-label={alt || 'تصویر در دسترس نیست'}>فایل تصویر پیدا نشد</span> : <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function InteractiveTabs({ node }: { node: TabsNode }) {
	const [selected, setSelected] = useState(node.props.items[0]?.id ?? '');
	const active = node.props.items.some((item) => item.id === selected) ? selected : node.props.items[0]?.id;
	const tabId = (id: string) => `${node.id}-${id}-tab`;
	const panelId = (id: string) => `${node.id}-${id}-panel`;
	function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
		const direction = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
		const target = event.key === 'Home' ? 0 : event.key === 'End' ? node.props.items.length - 1 : direction ? (index + direction + node.props.items.length) % node.props.items.length : -1;
		if (target < 0) return;
		event.preventDefault(); setSelected(node.props.items[target].id);
		(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[target])?.focus();
	}
	if (!node.props.items.length) return <p className="nvx-builder-empty">هنوز زبانه‌ای ثبت نشده است.</p>;
	return <div className="nvx-builder-tabs" data-ready="true">
		<div className="nvx-builder-tabs__list" role="tablist" aria-label="زبانه‌های محتوا">{node.props.items.map((item, index) => <button type="button" role="tab" key={item.id} id={tabId(item.id)} aria-controls={panelId(item.id)} aria-selected={item.id === active} tabIndex={item.id === active ? 0 : -1} onClick={() => setSelected(item.id)} onKeyDown={(event) => keyDown(event, index)}>{item.title ? <RichTextRuns text={item.title} marks={item.titleMarks} /> : 'زبانهٔ بدون عنوان'}</button>)}</div>
		{node.props.items.map((item) => <section className="nvx-builder-tabs__panel" role="tabpanel" key={item.id} id={panelId(item.id)} aria-labelledby={tabId(item.id)} hidden={item.id !== active} tabIndex={0}><h3 className="nvx-builder-tab-fallback">{item.title ? <RichTextRuns text={item.title} marks={item.titleMarks} /> : 'زبانهٔ بدون عنوان'}</h3><p><RichTextRuns text={item.body} marks={item.bodyMarks} /></p></section>)}
	</div>;
}
