import { createElement, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, CSSProperties, DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { COMPONENT_LIST, getComponentDefinition } from '../../lib/builder/registry.ts';
import {
	AutosaveConflictError,
	AutosaveController,
	type AutosaveStatus,
} from '../../lib/builder/autosave.ts';
import { exportPageDocument, hiddenAtBreakpoint, importPageDocument, validatePageDocument } from '../../lib/builder/document.ts';
import { resolveBuilderImageSource } from '../../lib/builder/media-reference.ts';
import {
	addNode,
	createNodeId,
	deleteNode,
	duplicateNode,
	findNode,
	findNodeLocation,
	moveNode,
	moveNodeBy,
	setNodeHiddenAtBreakpoint,
	updateNodeProps,
	updateNodeStyles,
} from '../../lib/builder/operations.ts';
import { commitDocument, createDocumentHistory, redoDocument, undoDocument } from '../../lib/builder/history.ts';
import { BUILDER_THEME_LIST, themeVariables } from '../../lib/builder/themes.ts';
import { applyTemplate, listStarterTemplates } from '../../lib/builder/templates.ts';
import { productGridApiPath } from '../../lib/commerce/product-binding.ts';
import { faMoney } from '../../lib/cms/fa.ts';
import type { ProductGridBinding, PublicProductCard } from '../../lib/commerce/types.ts';
import type {
	Breakpoint,
	BuilderComponentType,
	BuilderThemeId,
	BuilderNode,
	InspectorField,
	NodeStyles,
	PageDocument,
	ResponsiveNodeStyles,
} from '../../lib/builder/types.ts';
import '../../styles/builder.css';
import '../../styles/builder-editor.css';

interface Props {
	initialDocument: PageDocument;
	initialRevision: number;
	publishedAt: string | null;
	slug: string;
	canPublish: boolean;
	canReadMedia: boolean;
	canUploadMedia: boolean;
}

interface RevisionSummary {
	revision: number;
	savedAt: string;
	title: string;
	nodeCount: number;
}

interface TemplateSummary {
	id: string;
	name: string;
	description: string;
	source: 'starter' | 'saved';
	document?: PageDocument;
}

interface MediaPickerItem {
	name: string;
	assetRef: string;
	publicUrl: string;
	previewUrl: string;
	bytes: number;
	modifiedAt: string;
	builtin: boolean;
}

const BREAKPOINT_LABELS: Record<Breakpoint, string> = {
	desktop: 'رومیزی',
	tablet: 'تبلت',
	mobile: 'موبایل',
};

const STATUS_LABELS: Record<AutosaveStatus, string> = {
	saved: 'همهٔ تغییرات ذخیره شد',
	dirty: 'تغییرات ذخیره‌نشده',
	saving: 'در حال ذخیره…',
	error: 'ذخیره ناموفق بود',
	conflict: 'تعارض نسخه',
};

export default function BuilderEditor({ initialDocument, initialRevision, publishedAt, slug, canPublish, canReadMedia, canUploadMedia }: Props) {
	const [history, setHistory] = useState(() => createDocumentHistory(initialDocument));
	const historyRef = useRef(history);
	const [revision, setRevision] = useState(initialRevision);
	const revisionRef = useRef(initialRevision);
	const [isPublished, setIsPublished] = useState(Boolean(publishedAt));
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [viewport, setViewport] = useState<Breakpoint>('desktop');
	const [status, setStatus] = useState<AutosaveStatus>('saved');
	const [saveError, setSaveError] = useState('');
	const [message, setMessage] = useState('');
	const [titleDraft, setTitleDraft] = useState(initialDocument.title);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
	const [revisionLoading, setRevisionLoading] = useState(false);
	const historyOpenRef = useRef(false);
	const revisionHistoryRequestRef = useRef(0);
	const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
	const [templateItems, setTemplateItems] = useState<TemplateSummary[]>([]);
	const [templateLoading, setTemplateLoading] = useState(false);
	const [templateSaveOpen, setTemplateSaveOpen] = useState(false);
	const [templateName, setTemplateName] = useState('');
	const [templateSaving, setTemplateSaving] = useState(false);
	const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
	const [mediaItems, setMediaItems] = useState<MediaPickerItem[]>([]);
	const [mediaLoading, setMediaLoading] = useState(false);
	const [mediaUploading, setMediaUploading] = useState(false);
	const [mediaError, setMediaError] = useState('');
	const [publishBusy, setPublishBusy] = useState(false);
	const controllerRef = useRef<AutosaveController | null>(null);
	const importInputRef = useRef<HTMLInputElement | null>(null);
	const mediaFileRef = useRef<HTMLInputElement | null>(null);
	const mediaTargetRef = useRef<string | null>(null);
	const document = history.present;
	const selectedNode = selectedId ? findNode(document.nodes, selectedId) : null;

	async function refreshRevisionHistory(): Promise<void> {
		const requestId = ++revisionHistoryRequestRef.current;
		setRevisionLoading(true);
		try {
			const response = await fetch(`/cms/api/builder/pages/${encodeURIComponent(slug)}/history`, { headers: { accept: 'application/json' } });
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'خواندن تاریخچه ممکن نشد.');
			if (requestId === revisionHistoryRequestRef.current) setRevisions(Array.isArray(result.revisions) ? result.revisions : []);
		} catch (error) {
			if (requestId === revisionHistoryRequestRef.current) setMessage(error instanceof Error ? error.message : 'خواندن تاریخچه ممکن نشد.');
		} finally {
			if (requestId === revisionHistoryRequestRef.current) setRevisionLoading(false);
		}
	}

	useEffect(() => {
		const controller = new AutosaveController(
			async (nextDocument) => {
				const response = await fetch(`/cms/api/builder/pages/${encodeURIComponent(slug)}`, {
					method: 'PUT',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({ expectedRevision: revisionRef.current, document: nextDocument }),
				});
				const result = await readResponse(response);
				if (!response.ok) {
					if (result.code === 'revision_conflict') throw new AutosaveConflictError(result.message || 'نسخهٔ دیگری ذخیره شده است.');
					throw new Error(result.message || 'ذخیرهٔ صفحه ناموفق بود.');
				}
				if (typeof result.revision !== 'number') throw new Error('پاسخ ذخیره نسخهٔ تازه را برنگرداند.');
				revisionRef.current = result.revision;
				setRevision(result.revision);
				if (historyOpenRef.current) void refreshRevisionHistory();
				setSaveError('');
			},
			(nextStatus, error) => {
				setStatus(nextStatus);
				if (error instanceof Error) setSaveError(error.message);
				else if (nextStatus === 'saved') setSaveError('');
			},
			650,
		);
		controllerRef.current = controller;
		controller.initialize(initialDocument);
		return () => {
			controller.cancel();
			controllerRef.current = null;
		};
	}, [initialDocument, slug]);

	useEffect(() => {
		setTitleDraft(document.title);
	}, [document.title]);

	useEffect(() => {
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!controllerRef.current?.isDirty()) return;
			event.preventDefault();
		};
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	}, []);

	useEffect(() => {
		const handleShortcut = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (event.key === 'Escape') {
				if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
				setSelectedId(null);
				return;
			}
			if (!(event.metaKey || event.ctrlKey)) return;
			if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
			if (event.key.toLowerCase() === 'z') {
				event.preventDefault();
				if (event.shiftKey) redo();
				else undo();
			} else if (event.key.toLowerCase() === 'y') {
				event.preventDefault();
				redo();
			} else if (event.key.toLowerCase() === 's') {
				event.preventDefault();
				void saveNow();
			}
		};
		window.addEventListener('keydown', handleShortcut);
		return () => window.removeEventListener('keydown', handleShortcut);
	});

	function applyDocument(nextDocument: PageDocument): void {
		const current = historyRef.current;
		const next = commitDocument(current, nextDocument);
		if (next === current) return;
		historyRef.current = next;
		setHistory(next);
		controllerRef.current?.schedule(next.present);
		setMessage('');
	}

	function applyTitle(value: string): void {
		setTitleDraft(value);
		if (!value.trim() || value.length > 100) return;
		applyDocument({ ...historyRef.current.present, title: value });
	}

	function undo(): void {
		const current = historyRef.current;
		const next = undoDocument(current);
		if (next === current) return;
		historyRef.current = next;
		setHistory(next);
		controllerRef.current?.schedule(next.present);
		if (selectedId && !findNode(next.present.nodes, selectedId)) setSelectedId(null);
	}

	function redo(): void {
		const current = historyRef.current;
		const next = redoDocument(current);
		if (next === current) return;
		historyRef.current = next;
		setHistory(next);
		controllerRef.current?.schedule(next.present);
		if (selectedId && !findNode(next.present.nodes, selectedId)) setSelectedId(null);
	}

	async function saveNow(): Promise<void> {
		const controller = controllerRef.current;
		if (!controller) return;
		try {
			await controller.flush();
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : 'ذخیرهٔ صفحه ناموفق بود.');
			throw error;
		}
	}

	async function retrySave(): Promise<void> {
		try {
			await controllerRef.current?.retry();
			setSaveError('');
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : 'تلاش دوباره ناموفق بود.');
		}
	}

	function reloadServerVersion(): void {
		if (controllerRef.current?.isDirty() && !window.confirm('تغییرات محلی کنار گذاشته و آخرین نسخهٔ ذخیره‌شده بارگیری شود؟ ابتدا می‌توانید از سند محلی خروجی بگیرید.')) return;
		void (async () => {
			try {
				const response = await fetch(`/cms/api/builder/pages/${encodeURIComponent(slug)}`, { headers: { accept: 'application/json' } });
				const result = await readResponse(response);
				if (!response.ok) throw new Error(result.message || 'بارگیری نسخهٔ تازه ممکن نشد.');
				const nextDocument = validatePageDocument(result.document, slug);
				const nextHistory = createDocumentHistory(nextDocument);
				historyRef.current = nextHistory;
				setHistory(nextHistory);
				revisionRef.current = result.revision;
				setRevision(result.revision);
				if (historyOpenRef.current) void refreshRevisionHistory();
				setIsPublished(Boolean(result.publishedAt));
				controllerRef.current?.initialize(nextDocument);
				setSelectedId(null);
				setSaveError('');
				setMessage('آخرین نسخهٔ ذخیره‌شده بارگیری شد.');
			} catch (error) {
				setMessage(error instanceof Error ? error.message : 'بارگیری نسخهٔ تازه ممکن نشد.');
			}
		})();
	}

	function downloadDocument(): void {
		const blob = new Blob([exportPageDocument(historyRef.current.present)], { type: 'application/json;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = window.document.createElement('a');
		anchor.href = url;
		anchor.download = `${slug}-builder.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async function downloadTemplate(item: TemplateSummary): Promise<void> {
		try {
			let templateDocument = item.document;
			if (!templateDocument) {
				const response = await fetch(`/cms/api/builder/templates/${encodeURIComponent(item.id)}`, { headers: { accept: 'application/json' } });
				const result = await readResponse(response);
				if (!response.ok || !result.template?.document) throw new Error(result.message || 'قالب برای خروجی آماده نشد.');
				templateDocument = result.template.document as PageDocument;
			}
			const json = exportPageDocument(validatePageDocument(templateDocument));
			const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const anchor = window.document.createElement('a');
			anchor.href = url;
			anchor.download = `novex-template-${item.id.replace(/[^a-z0-9_-]/gi, '-')}.json`;
			anchor.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'خروجی قالب آماده نشد.');
		}
	}

	async function importDocument(file: File): Promise<void> {
		if (file.size > 1024 * 1024) {
			setMessage('حداکثر اندازهٔ سند واردشده ۱ مگابایت است.');
			return;
		}
		if (controllerRef.current?.isDirty() && !window.confirm('محتوای فعلی با سند واردشده جایگزین شود؟')) return;
		try {
			const imported = importPageDocument(await file.text(), slug);
			const current = historyRef.current.present;
			const next = validatePageDocument({ ...imported, id: current.id, slug: current.slug }, slug);
			applyDocument(next);
			setSelectedId(null);
			setMessage('سند JSON بارگیری شد؛ ذخیرهٔ تغییرات به‌صورت خودکار انجام می‌شود.');
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'بارگیری سند JSON انجام نشد.');
		}
	}

	function addComponent(type: BuilderComponentType, initialProps: Record<string, unknown> = {}): void {
		try {
			const current = historyRef.current.present;
			const selected = selectedId ? findNode(current.nodes, selectedId) : null;
			let parentId: string | null = null;
			let index = current.nodes.length;
			if (selected?.type === 'Container') {
				parentId = selected.id;
				index = selected.children.length;
			} else if (selected) {
				const location = findNodeLocation(current.nodes, selected.id);
				if (location) {
					parentId = location.parentId;
					index = location.index + 1;
				}
			}
			const id = createNodeId();
			let next = addNode(current, type, { parentId, index, id });
			if (Object.keys(initialProps).length) next = updateNodeProps(next, id, initialProps);
			applyDocument(next);
			setSelectedId(id);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'افزودن مؤلفه انجام نشد.');
		}
	}

	function updateField(node: BuilderNode, field: InspectorField, rawValue: unknown): void {
		try {
			if (field.key.startsWith('styles.')) {
				const key = field.key.slice('styles.'.length) as keyof NodeStyles;
				const patch = { [key]: rawValue === '' ? undefined : rawValue } as Partial<NodeStyles>;
				applyDocument(updateNodeStyles(historyRef.current.present, node.id, patch, viewport));
				return;
			}
			if (field.key.startsWith('binding.') && node.type === 'ProductGrid') {
				const key = field.key.slice('binding.'.length) as keyof ProductGridBinding;
				const binding: Record<string, unknown> = { ...node.props.binding, [key]: rawValue };
				if (key === 'selection' && rawValue !== 'category') delete binding.category;
				applyDocument(updateNodeProps(historyRef.current.present, node.id, { binding }));
				return;
			}
			applyDocument(updateNodeProps(historyRef.current.present, node.id, { [field.key]: rawValue }));
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'مقدار واردشده معتبر نیست.');
		}
	}

	function updateInlineText(id: string, value: string): void {
		try {
			applyDocument(updateNodeProps(historyRef.current.present, id, { text: value }));
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'ویرایش متن ذخیره نشد.');
		}
	}

	function updatePageDescription(value: string): void {
		try {
			applyDocument({ ...historyRef.current.present, description: value });
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'توضیحات صفحه معتبر نیست.');
		}
	}

	function duplicateSelected(): void {
		if (!selectedId) return;
		try {
			const result = duplicateNode(historyRef.current.present, selectedId);
			applyDocument(result.document);
			setSelectedId(result.newId);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'رونوشت‌برداری انجام نشد.');
		}
	}

	function removeSelected(): void {
		if (!selectedId) return;
		if (!window.confirm('این مؤلفه و فرزندانش حذف شوند؟')) return;
		try {
			applyDocument(deleteNode(historyRef.current.present, selectedId));
			setSelectedId(null);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'حذف مؤلفه انجام نشد.');
		}
	}

	function moveSelected(direction: -1 | 1): void {
		if (!selectedId) return;
		try {
			applyDocument(moveNodeBy(historyRef.current.present, selectedId, direction));
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'جابجایی مؤلفه انجام نشد.');
		}
	}

	async function loadMediaForPicker(): Promise<void> {
		if (!canReadMedia) {
			setMediaItems([]);
			setMediaError('نقش شما اجازهٔ مشاهدهٔ کتابخانهٔ رسانه را ندارد.');
			return;
		}
		setMediaLoading(true);
		setMediaError('');
		try {
			const response = await fetch('/cms/api/media', { headers: { accept: 'application/json' } });
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'خواندن کتابخانهٔ رسانه ممکن نشد.');
			const items = Array.isArray(result.media)
				? result.media.filter((item: MediaPickerItem) => typeof item.assetRef === 'string' && typeof item.previewUrl === 'string')
				: [];
			setMediaItems(items);
		} catch (error) {
			setMediaError(error instanceof Error ? error.message : 'خواندن کتابخانهٔ رسانه ممکن نشد.');
		} finally {
			setMediaLoading(false);
		}
	}

	function openMediaPicker(node: BuilderNode): void {
		if (node.type !== 'Image') return;
		mediaTargetRef.current = node.id;
		setMediaPickerOpen(true);
		void loadMediaForPicker();
	}

	function selectMedia(item: MediaPickerItem): void {
		const targetId = mediaTargetRef.current;
		const target = targetId ? findNode(historyRef.current.present.nodes, targetId) : null;
		if (!target || target.type !== 'Image') {
			setMediaError('مؤلفهٔ تصویر انتخاب‌شده دیگر در صفحه نیست.');
			return;
		}
		try {
			applyDocument(updateNodeProps(historyRef.current.present, target.id, { src: item.assetRef }));
			setSelectedId(target.id);
			setMediaPickerOpen(false);
			setMediaError('');
			setMessage(`تصویر «${item.name}» به سند پیوند شد.`);
		} catch (error) {
			setMediaError(error instanceof Error ? error.message : 'انتخاب تصویر انجام نشد.');
		}
	}

	async function uploadPickerImage(file: File): Promise<void> {
		if (!canUploadMedia) {
			setMediaError('نقش شما اجازهٔ بارگذاری تصویر را ندارد.');
			return;
		}
		setMediaUploading(true);
		setMediaError('');
		try {
			const body = new FormData();
			body.append('files', file);
			const response = await fetch('/cms/api/media/upload', {
				method: 'POST',
				headers: { accept: 'application/json' },
				body,
			});
			const result = await readResponse(response);
			const item = Array.isArray(result.files) ? result.files[0] as MediaPickerItem | undefined : undefined;
			if (!response.ok || !item?.assetRef) throw new Error(result.message || 'بارگذاری تصویر انجام نشد.');
			setMediaItems((current) => [item, ...current.filter((candidate) => candidate.assetRef !== item.assetRef)]);
			selectMedia(item);
		} catch (error) {
			setMediaError(error instanceof Error ? error.message : 'بارگذاری تصویر انجام نشد.');
		} finally {
			setMediaUploading(false);
		}
	}

	function handleDrop(event: DragEvent<HTMLElement>, target: BuilderNode): void {
		event.preventDefault();
		event.stopPropagation();
		const sourceId = event.dataTransfer.getData('text/novex-builder-node');
		if (!sourceId || sourceId === target.id) return;
		try {
			const placement = target.type === 'Container' ? 'inside' : 'after';
			const next = moveNode(historyRef.current.present, sourceId, target.id, placement);
			applyDocument(next);
			setSelectedId(sourceId);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'جابجایی مؤلفه انجام نشد.');
		}
	}

	async function toggleHistory(): Promise<void> {
		const open = !historyOpen;
		historyOpenRef.current = open;
		setHistoryOpen(open);
		if (open) await refreshRevisionHistory();
	}

	async function restoreRevision(revisionNumber: number): Promise<void> {
		if (controllerRef.current?.isDirty() && !window.confirm('تغییرات ذخیره‌نشده با نسخهٔ انتخابی جایگزین شوند؟')) return;
		try {
			const response = await fetch(`/cms/api/builder/pages/${encodeURIComponent(slug)}/history?revision=${revisionNumber}`, { headers: { accept: 'application/json' } });
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'نسخهٔ انتخابی بارگیری نشد.');
			const restored = validatePageDocument(result.document, slug);
			applyDocument(restored);
			setSelectedId(null);
			setMessage(`محتوای نسخهٔ ${revisionNumber} بارگیری شد؛ برای ثبت آن در تاریخچه، ذخیره را انجام دهید.`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'بازیابی نسخه انجام نشد.');
		}
	}

	async function openTemplateLibrary(): Promise<void> {
		const starters = listStarterTemplates().map((template) => ({
			id: template.id,
			name: template.label,
			description: template.description,
			source: 'starter' as const,
			document: template.document,
		}));
		setTemplateItems(starters);
		setTemplateDialogOpen(true);
		setTemplateLoading(true);
		try {
			const response = await fetch('/cms/api/builder/templates', { headers: { accept: 'application/json' } });
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'خواندن قالب‌ها ممکن نشد.');
			const saved = Array.isArray(result.templates) ? result.templates.filter((item: TemplateSummary) => item.source === 'saved') : [];
			setTemplateItems([...starters, ...saved]);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'خواندن قالب‌ها ممکن نشد.');
		} finally {
			setTemplateLoading(false);
		}
	}

	async function useTemplate(item: TemplateSummary): Promise<void> {
		if (historyRef.current.present.nodes.length && !window.confirm('محتوای فعلی با قالب جایگزین می‌شود. ادامه می‌دهید؟')) return;
		try {
			let templateDocument = item.document;
			if (!templateDocument) {
				const response = await fetch(`/cms/api/builder/templates/${encodeURIComponent(item.id)}`, { headers: { accept: 'application/json' } });
				const result = await readResponse(response);
				if (!response.ok || !result.template?.document) throw new Error(result.message || 'قالب ذخیره‌شده بارگیری نشد.');
				templateDocument = result.template.document as PageDocument;
			}
			const next = applyTemplate(templateDocument, historyRef.current.present);
			applyDocument(next);
			setSelectedId(null);
			setTemplateDialogOpen(false);
			setMessage(`قالب «${item.name}» روی صفحه اعمال شد.`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'اعمال قالب انجام نشد.');
		}
	}

	async function duplicateTemplate(item: TemplateSummary): Promise<void> {
		try {
			let templateDocument = item.document;
			if (!templateDocument) {
				const readResponseValue = await fetch(`/cms/api/builder/templates/${encodeURIComponent(item.id)}`, { headers: { accept: 'application/json' } });
				const result = await readResponse(readResponseValue);
				if (!readResponseValue.ok || !result.template?.document) throw new Error(result.message || 'قالب برای رونوشت آماده نشد.');
				templateDocument = result.template.document as PageDocument;
			}
			const name = `${item.name.slice(0, 52)} (نسخه)`;
			const response = await fetch('/cms/api/builder/templates', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ name, document: validatePageDocument(templateDocument) }),
			});
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'رونوشت قالب ذخیره نشد.');
			setMessage(`رونوشت «${name}» به کتابخانه افزوده شد.`);
			await openTemplateLibrary();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'رونوشت قالب انجام نشد.');
		}
	}

	async function saveAsTemplate(): Promise<void> {
		const name = templateName.trim();
		if (!name || templateSaving) return;
		setTemplateSaving(true);
		try {
			const response = await fetch('/cms/api/builder/templates', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ name, document: historyRef.current.present }),
			});
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'ذخیرهٔ قالب انجام نشد.');
			setTemplateSaveOpen(false);
			setTemplateName('');
			setMessage(`قالب «${name}» ذخیره شد و در کتابخانه در دسترس است.`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'ذخیرهٔ قالب انجام نشد.');
		} finally {
			setTemplateSaving(false);
		}
	}

	async function publish(): Promise<void> {
		if (!canPublish || publishBusy) return;
		setPublishBusy(true);
		setMessage('');
		try {
			await saveNow();
			const response = await fetch(`/cms/api/builder/pages/${encodeURIComponent(slug)}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ expectedRevision: revisionRef.current, document: historyRef.current.present }),
			});
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'انتشار صفحه انجام نشد.');
			revisionRef.current = result.revision;
			setRevision(result.revision);
			if (historyOpenRef.current) void refreshRevisionHistory();
			setIsPublished(true);
			setMessage(`صفحه منتشر شد. نشانی عمومی: ${result.publicUrl}`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'انتشار صفحه انجام نشد.');
		} finally {
			setPublishBusy(false);
		}
	}

	return (
		<div className="builder-shell" dir="rtl">
			<header className="builder-toolbar">
				<div className="builder-toolbar__start">
					<a className="builder-back" href="/cms/pages" aria-label="بازگشت به صفحه‌ها">‹ صفحه‌ها</a>
					<label className="builder-title-input">
						<span className="sr-only">عنوان صفحه</span>
						<input value={titleDraft} maxLength={100} onChange={(event) => applyTitle(event.target.value)} onBlur={() => { if (!titleDraft.trim()) setTitleDraft(document.title); }} />
						<small>پیش‌نویس · نسخهٔ {revision.toLocaleString('fa-IR')}</small>
					</label>
				</div>
				<div className="builder-toolbar__center">
					<div className={`builder-save-state builder-save-state--${status}`} role="status" aria-live="polite">
						<span className="builder-save-state__dot" />{STATUS_LABELS[status]}
					</div>
					{status === 'error' ? <button className="builder-link-button" type="button" onClick={() => void retrySave()}>تلاش دوباره</button> : null}
					{status === 'conflict' ? <button className="builder-link-button" type="button" onClick={reloadServerVersion}>بارگیری نسخهٔ تازه</button> : null}
				</div>
				<div className="builder-toolbar__actions">
					<button className="builder-icon-button" type="button" title="واگرد (Ctrl/⌘ Z)" aria-label="واگرد" data-testid="undo" disabled={!history.past.length} onClick={undo}>↶</button>
					<button className="builder-icon-button" type="button" title="ازنو (Ctrl/⌘ Shift Z)" aria-label="ازنو" data-testid="redo" disabled={!history.future.length} onClick={redo}>↷</button>
					<button className="builder-toolbar-button" type="button" data-testid="save-page" onClick={() => void saveNow().catch(() => undefined)}>ذخیره</button>
					{canPublish ? <button className="builder-toolbar-button builder-toolbar-button--publish" type="button" data-testid="publish-page" disabled={publishBusy} onClick={() => void publish()}>{publishBusy ? 'در حال انتشار…' : 'انتشار'}</button> : null}
					{isPublished ? <a className="builder-toolbar-button builder-toolbar-button--quiet" href={`/pages/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">نمایش منتشرشده</a> : <button className="builder-toolbar-button builder-toolbar-button--quiet" type="button" disabled title="پس از انتشار در دسترس است">پس از انتشار</button>}
				</div>
			</header>

			{status === 'error' || status === 'conflict' ? (
				<div className={`builder-alert builder-alert--${status}`} role="alert">
					<span>{saveError || (status === 'conflict' ? 'نسخهٔ ذخیره‌شده تغییر کرده است.' : 'تغییرات روی همین دستگاه نگه داشته شده‌اند.')}</span>
					<div className="builder-alert__actions">
						<button type="button" onClick={downloadDocument}>خروجی از تغییرات محلی</button>
						{status === 'error' ? <button type="button" onClick={() => void retrySave()}>تلاش دوباره</button> : <button type="button" onClick={reloadServerVersion}>بارگیری نسخهٔ تازه</button>}
					</div>
				</div>
			) : null}
			{message ? <div className="builder-message" role="status">{message}</div> : null}

			<div className="builder-workspace">
				<aside className="builder-panel builder-panel--library" aria-label="افزودن و ساختار صفحه">
					<div className="builder-panel__heading">
						<div><h2>ساختار</h2><p>مؤلفه‌ها را اضافه یا مرتب کنید.</p></div>
					</div>
					<div className="builder-library">
						{COMPONENT_LIST.map((definition) => (
							<button className="builder-component-card" type="button" key={definition.type} data-testid={`add-component-${definition.type.toLowerCase()}`} onClick={() => addComponent(definition.type)} title={definition.documentation}>
								<span className="builder-component-card__icon">{componentIcon(definition.type)}</span>
								<span><strong>{definition.label}</strong><small>{definition.description}</small></span>
								<span className="builder-component-card__add">+</span>
							</button>
						))}
						<button className="builder-component-card" type="button" data-testid="add-component-grid" onClick={() => addComponent('Container', { layout: 'grid', background: 'soft' })} title="یک بخش با چیدمان شبکه‌ای واکنش‌گرا اضافه کنید.">
							<span className="builder-component-card__icon">▦</span>
							<span><strong>شبکه</strong><small>بخش Grid با ستون‌های واکنش‌گرا</small></span>
							<span className="builder-component-card__add">+</span>
						</button>
					</div>
					<div className="builder-tree-heading"><span>لایه‌ها</span><span>{countNodes(document.nodes).toLocaleString('fa-IR')}</span></div>
					{document.nodes.length ? (
						<div className="builder-tree" role="list" aria-label="ساختار صفحه">
							{document.nodes.map((node) => <TreeNode key={node.id} node={node} selectedId={selectedId} onSelect={setSelectedId} onDragStart={startDrag} onDrop={handleDrop} />)}
						</div>
					) : (
						<p className="builder-tree-empty">هنوز مؤلفه‌ای در صفحه نیست.</p>
					)}
					<div className="builder-panel__footer builder-panel__footer--wrap">
						<button type="button" onClick={() => void toggleHistory()}>{historyOpen ? 'بستن تاریخچه' : 'تاریخچهٔ نسخه‌ها'}</button>
						<button type="button" onClick={() => void openTemplateLibrary()}>قالب‌ها</button>
						<button type="button" onClick={() => { setTemplateName(''); setTemplateSaveOpen(true); }}>ذخیرهٔ قالب</button>
						<button type="button" onClick={downloadDocument}>خروجی JSON</button>
						<button type="button" onClick={() => importInputRef.current?.click()}>ورود JSON</button>
						<input ref={importInputRef} hidden type="file" accept="application/json,.json" onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = '';
							if (file) void importDocument(file);
						}} />
					</div>
					{historyOpen ? (
						<div className="builder-history" aria-label="تاریخچهٔ نسخه‌ها">
							<strong>نسخه‌های ذخیره‌شده</strong>
							{revisionLoading ? <p>در حال بارگیری…</p> : revisions.length ? revisions.map((item) => (
								<button type="button" key={item.revision} onClick={() => void restoreRevision(item.revision)}>
									<span>نسخهٔ {item.revision.toLocaleString('fa-IR')} · {item.title}</span>
									<small>{formatDate(item.savedAt)} · {item.nodeCount.toLocaleString('fa-IR')} مؤلفه</small>
								</button>
							)) : <p>نسخه‌ای در تاریخچه نیست.</p>}
						</div>
					) : null}
				</aside>

				<main className="builder-canvas-area" aria-label="پیش‌نمایش صفحه">
					<div className="builder-canvas-toolbar">
						<div className="builder-breakpoints" role="group" aria-label="اندازهٔ پیش‌نمایش">
							{(['desktop', 'tablet', 'mobile'] as const).map((size) => (
								<button type="button" key={size} className={viewport === size ? 'is-active' : ''} aria-pressed={viewport === size} onClick={() => setViewport(size)}>
									<span aria-hidden="true">{size === 'desktop' ? '▰' : size === 'tablet' ? '▭' : '▯'}</span>{BREAKPOINT_LABELS[size]}
								</button>
							))}
						</div>
						<span className="builder-canvas-hint">برای انتخاب کلیک کنید · برای ویرایش متن دوبار کلیک کنید</span>
					</div>
					<div className={`builder-canvas-scroll builder-canvas-scroll--${viewport}`}>
						<div className={`builder-canvas-paper builder-canvas-paper--${viewport}`}>
							<div className="builder-preview-page" data-builder-theme={document.themeId} style={themeVariables(document.themeId) as unknown as CSSProperties}>
								<header className="builder-preview-page__intro">
									<div className="builder-preview-label">پیش‌نمایش صفحه · /pages/{slug}</div>
									<h1>{document.title || 'بدون عنوان'}</h1>
									{document.description ? <p>{document.description}</p> : null}
								</header>
								<div className="builder-preview-content" data-testid="builder-canvas" onClick={() => setSelectedId(null)} onDragOver={(event) => event.preventDefault()}>
									{document.nodes.length ? document.nodes.map((node) => (
										<PreviewNode key={node.id} node={node} selectedId={selectedId} viewport={viewport} onSelect={setSelectedId} onInlineEdit={updateInlineText} onDragStart={startDrag} onDrop={handleDrop} />
									)) : (
										<div className="builder-canvas-empty">
											<div className="builder-canvas-empty__mark">＋</div>
											<strong>صفحهٔ خود را بسازید</strong>
											<span>از ستون ساختار یک بخش، شبکه، متن، تصویر، تیتر یا دکمه اضافه کنید.</span>
										</div>
									)}
								</div>
							</div>
						</div>
					</div>
				</main>

				<aside className="builder-panel builder-panel--inspector" aria-label="تنظیمات مؤلفه">
					{selectedNode ? (
						<Inspector
							node={selectedNode}
							viewport={viewport}
							canMoveUp={Boolean(findNodeLocation(document.nodes, selectedNode.id)?.index)}
							canMoveDown={canMoveDown(document.nodes, selectedNode.id)}
							onField={(field, value) => updateField(selectedNode, field, value)}
							onHidden={(hidden) => {
								try { applyDocument(setNodeHiddenAtBreakpoint(historyRef.current.present, selectedNode.id, viewport, hidden)); }
								catch (error) { setMessage(error instanceof Error ? error.message : 'تنظیم نمایش انجام نشد.'); }
							}}
							onMove={moveSelected}
							onDuplicate={duplicateSelected}
							onDelete={removeSelected}
							onDeselect={() => setSelectedId(null)}
							canReadMedia={canReadMedia}
							onPickMedia={() => openMediaPicker(selectedNode)}
						/>
					) : (
						<PageInspector document={document} onDescription={updatePageDescription} onTheme={(themeId) => applyDocument({ ...historyRef.current.present, themeId })} />
					)}
				</aside>
			</div>
			{templateDialogOpen ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplateDialogOpen(false); }}>
					<section className="builder-modal" role="dialog" aria-modal="true" aria-labelledby="builder-template-title">
						<header className="builder-modal__header"><div><h2 id="builder-template-title">کتابخانهٔ قالب‌ها</h2><p>قالب‌ها را روی همین صفحه اعمال کنید یا نمونهٔ خودتان را بازاستفاده کنید.</p></div><button type="button" aria-label="بستن" onClick={() => setTemplateDialogOpen(false)}>×</button></header>
						<div className="builder-template-list">
							{templateLoading ? <p className="builder-template-empty">در حال بارگیری قالب‌ها…</p> : templateItems.length ? templateItems.map((item) => (
								<article className="builder-template-card" key={`${item.source}-${item.id}`}>
									<div><span className="builder-template-card__tag">{item.source === 'starter' ? 'قالب آماده' : 'قالب ذخیره‌شده'}</span><h3>{item.name}</h3><p>{item.description}</p></div>
									<div className="builder-template-card__actions">
										<button type="button" onClick={() => void downloadTemplate(item)}>خروجی JSON</button>
										<button type="button" onClick={() => void duplicateTemplate(item)}>رونوشت</button>
										<button type="button" onClick={() => void useTemplate(item)}>استفاده</button>
									</div>
								</article>
							)) : <p className="builder-template-empty">قالبی پیدا نشد.</p>}
						</div>
						<footer className="builder-modal__footer"><button type="button" onClick={() => { setTemplateDialogOpen(false); setTemplateSaveOpen(true); }}>ذخیرهٔ صفحهٔ فعلی به‌عنوان قالب</button><button type="button" onClick={() => setTemplateDialogOpen(false)}>بستن</button></footer>
					</section>
				</div>
			) : null}
			{templateSaveOpen ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplateSaveOpen(false); }}>
					<form className="builder-modal builder-modal--small" role="dialog" aria-modal="true" aria-labelledby="builder-save-template-title" onSubmit={(event) => { event.preventDefault(); void saveAsTemplate(); }}>
						<header className="builder-modal__header"><div><h2 id="builder-save-template-title">ذخیرهٔ قالب</h2><p>محتوا و تم فعلی برای استفاده در صفحه‌های دیگر نگهداری می‌شود.</p></div><button type="button" aria-label="بستن" onClick={() => setTemplateSaveOpen(false)}>×</button></header>
						<label className="builder-field"><span>نام قالب</span><input autoFocus required maxLength={60} value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></label>
						<footer className="builder-modal__footer"><button type="button" onClick={() => setTemplateSaveOpen(false)}>انصراف</button><button className="builder-toolbar-button--publish" type="submit" disabled={templateSaving || !templateName.trim()}>{templateSaving ? 'در حال ذخیره…' : 'ذخیرهٔ قالب'}</button></footer>
					</form>
				</div>
			) : null}
			{mediaPickerOpen ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMediaPickerOpen(false); }}>
					<section className="builder-modal builder-modal--media" role="dialog" aria-modal="true" aria-labelledby="builder-media-title" data-testid="media-picker">
						<header className="builder-modal__header"><div><h2 id="builder-media-title">کتابخانهٔ رسانه</h2><p>تصویر انتخاب‌شده با شناسهٔ پایدار رسانه در سند ذخیره می‌شود.</p></div><button type="button" aria-label="بستن" onClick={() => setMediaPickerOpen(false)}>×</button></header>
						{mediaError ? <p className="builder-media-error" role="alert">{mediaError}</p> : null}
						{mediaLoading ? <p className="builder-template-empty" role="status">در حال بارگیری رسانه…</p> : mediaItems.length ? (
							<div className="builder-media-grid">
								{mediaItems.map((item) => (
									<button className="builder-media-option" type="button" key={item.assetRef} data-testid="media-asset" data-asset-ref={item.assetRef} onClick={() => selectMedia(item)}>
										<img src={item.previewUrl} alt="" loading="lazy" decoding="async" />
										<span>{item.name}</span>{item.builtin ? <small>همراه قالب</small> : null}
									</button>
								))}
							</div>
						) : mediaError ? null : <p className="builder-template-empty" role="status">تصویر قابل‌استفاده‌ای در کتابخانه نیست.</p>}
						<footer className="builder-modal__footer">
							{canUploadMedia ? (
								<label className={`builder-media-upload${mediaUploading ? ' is-busy' : ''}`}>
									{mediaUploading ? 'در حال بارگذاری…' : 'بارگذاری تصویر'}
									<input ref={mediaFileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.avif,.gif" disabled={mediaUploading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadPickerImage(file); }} />
								</label>
							) : <span className="builder-media-permission-note">بارگذاری برای نقش شما مجاز نیست.</span>}
							<button type="button" onClick={() => setMediaPickerOpen(false)}>بستن</button>
						</footer>
					</section>
				</div>
			) : null}
		</div>
	);

	function startDrag(event: DragEvent<HTMLElement>, id: string): void {
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/novex-builder-node', id);
	}
}

interface TreeNodeProps {
	node: BuilderNode;
	selectedId: string | null;
	onSelect: (id: string) => void;
	onDragStart: (event: DragEvent<HTMLElement>, id: string) => void;
	onDrop: (event: DragEvent<HTMLElement>, node: BuilderNode) => void;
}

function componentIcon(type: BuilderComponentType): string {
	return type === 'Container' ? '▦' : type === 'Heading' ? 'T' : type === 'Text' ? '¶' : type === 'Image' ? '▧' : type === 'ProductGrid' ? '▣' : '↗';
}

function TreeNode({ node, selectedId, onSelect, onDragStart, onDrop }: TreeNodeProps) {
	const label = getComponentDefinition(node.type).label;
	const details = node.type === 'Heading' ? node.props.text
		: node.type === 'Text' ? node.props.text
			: node.type === 'Button' ? node.props.label
				: node.type === 'Image' ? node.props.alt || node.props.src || 'بدون تصویر'
					: node.type === 'ProductGrid' ? `محصولات ${node.props.binding.selection}`
						: `${node.children.length} فرزند`;
	return (
		<div className="builder-tree-node" role="listitem">
			<button
				className={`builder-tree-node__row${selectedId === node.id ? ' is-selected' : ''}`}
				data-testid="tree-node"
				data-node-id={node.id}
				aria-pressed={selectedId === node.id}
				type="button"
				draggable
				onClick={() => onSelect(node.id)}
				onDragStart={(event) => onDragStart(event, node.id)}
				onDragOver={(event) => event.preventDefault()}
				onDrop={(event) => onDrop(event, node)}
			>
				<span className="builder-tree-node__type">{componentIcon(node.type)}</span>
				<span className="builder-tree-node__label"><strong>{label}</strong><small>{details || 'بدون متن'}</small></span>
			</button>
			{node.type === 'Container' && node.children.length ? (
				<div className="builder-tree-node__children" role="list">
					{node.children.map((child) => <TreeNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} onDragStart={onDragStart} onDrop={onDrop} />)}
				</div>
			) : null}
		</div>
	);
}

interface PreviewNodeProps {
	node: BuilderNode;
	selectedId: string | null;
	viewport: Breakpoint;
	onSelect: (id: string) => void;
	onInlineEdit: (id: string, value: string) => void;
	onDragStart: (event: DragEvent<HTMLElement>, id: string) => void;
	onDrop: (event: DragEvent<HTMLElement>, node: BuilderNode) => void;
}

function PreviewNode({ node, selectedId, viewport, onSelect, onInlineEdit, onDragStart, onDrop }: PreviewNodeProps) {
	const selected = node.id === selectedId;
	const style = previewStyle(node, viewport);
	const hidden = hiddenAtBreakpoint(node, viewport);
	const className = `builder-preview-node${selected ? ' builder-preview-node--selected' : ''}${hidden ? ' builder-preview-node--hidden' : ''}`;
	const onClick = (event: ReactMouseEvent<HTMLElement>) => { event.stopPropagation(); onSelect(node.id); };
	const dragProps = {
		draggable: true,
		onDragStart: (event: DragEvent<HTMLElement>) => { event.stopPropagation(); onDragStart(event, node.id); },
		onDragOver: (event: DragEvent<HTMLElement>) => { event.preventDefault(); event.stopPropagation(); },
		onDrop: (event: DragEvent<HTMLElement>) => onDrop(event, node),
	};
	if (hidden) {
		return <div className={`${className} builder-preview-node--hidden-placeholder`} data-builder-id={node.id} onClick={onClick} {...dragProps}>در این اندازه پنهان است · {getComponentDefinition(node.type).label}</div>;
	}
	if (node.type === 'Container') {
		return (
			<div className={className} data-builder-id={node.id} onClick={onClick} style={style} {...dragProps}>
				<div className={`nvx-builder-node nvx-builder-container nvx-builder-container--${node.props.background}`} data-layout={node.props.layout} data-max-width={node.props.maxWidth} style={{ gap: node.props.gap, padding: node.props.padding }}>
					{node.children.length ? node.children.map((child) => <PreviewNode key={child.id} node={child} selectedId={selectedId} viewport={viewport} onSelect={onSelect} onInlineEdit={onInlineEdit} onDragStart={onDragStart} onDrop={onDrop} />) : <div className="builder-container-empty">برای افزودن فرزند، یک مؤلفه را از ستون ساختار انتخاب کنید.</div>}
				</div>
			</div>
		);
	}
	if (node.type === 'Heading') {
		const tag = `h${node.props.level}` as 'h1' | 'h2' | 'h3' | 'h4';
		return (
			<div className={className} data-builder-id={node.id} onClick={onClick} {...dragProps}>
				<InlineEditableText
					as={tag}
					className={`nvx-builder-node nvx-builder-heading nvx-builder-heading--${node.props.size} nvx-builder-color--${node.props.color}`}
					value={node.props.text}
					align={node.props.align}
					style={style}
					label="ویرایش تیتر"
					onActivate={() => onSelect(node.id)}
					onCommit={(value) => onInlineEdit(node.id, value)}
				/>
			</div>
		);
	}
	if (node.type === 'Text') {
		return (
			<div className={className} data-builder-id={node.id} onClick={onClick} style={style} {...dragProps}>
				<InlineEditableText
					as="p"
					className={`nvx-builder-node nvx-builder-text nvx-builder-text--${node.props.size} nvx-builder-color--${node.props.color}`}
					value={node.props.text}
					align={node.props.align}
					label="ویرایش متن"
					onActivate={() => onSelect(node.id)}
					onCommit={(value) => onInlineEdit(node.id, value)}
				/>
			</div>
		);
	}
	if (node.type === 'Image') {
		return (
			<div className={className} data-builder-id={node.id} onClick={onClick} style={style} {...dragProps}>
				<figure className="nvx-builder-node nvx-builder-image">
					<div className="nvx-builder-image__frame" data-aspect={node.props.aspectRatio} data-fit={node.props.fit}>
						{node.props.src ? <PreviewImage src={resolveBuilderImageSource(node.props.src)} alt={node.props.alt} /> : <div className="nvx-builder-image__empty" role="img" aria-label={node.props.alt || 'تصویر در دسترس نیست'}>تصویر انتخاب نشده است</div>}
					</div>
					{node.props.caption ? <figcaption className="nvx-builder-image__caption">{node.props.caption}</figcaption> : null}
				</figure>
			</div>
		);
	}
	if (node.type === 'ProductGrid') {
		return (
			<div className={className} data-builder-id={node.id} onClick={onClick} style={style} {...dragProps}>
				<ProductGridPreview node={node} />
			</div>
		);
	}
	return (
		<div className={className} data-builder-id={node.id} onClick={onClick} style={style} {...dragProps}>
			<div className="nvx-builder-button-wrap" data-align={node.props.align}>
				<a className={`nvx-builder-button nvx-builder-button--${node.props.variant}`} href={node.props.href} onClick={(event) => event.preventDefault()}>{node.props.label || 'دکمه'}</a>
			</div>
		</div>
	);
}

interface ProductGridPreviewState {
	status: 'loading' | 'ready' | 'disabled' | 'error';
	currency?: string;
	products?: PublicProductCard[];
}

function ProductGridPreview({ node }: { node: Extract<BuilderNode, { type: 'ProductGrid' }> }) {
	const apiPath = productGridApiPath(node.props.binding);
	const [result, setResult] = useState<ProductGridPreviewState>({ status: 'loading' });

	useEffect(() => {
		const controller = new AbortController();
		setResult({ status: 'loading' });
		void fetch(apiPath, { signal: controller.signal, headers: { Accept: 'application/json' } })
			.then(async (response) => {
				const payload = await response.json() as { ok?: unknown; status?: unknown; currency?: unknown; products?: unknown };
				if (!response.ok || payload.ok !== true) throw new Error('Product preview could not be loaded.');
				if (payload.status === 'disabled') {
					setResult({ status: 'disabled' });
					return;
				}
				if (payload.status !== 'ready' || typeof payload.currency !== 'string' || !Array.isArray(payload.products)) {
					throw new Error('Product preview response is invalid.');
				}
				setResult({ status: 'ready', currency: payload.currency, products: payload.products as PublicProductCard[] });
			})
			.catch((error: unknown) => {
				if (error instanceof Error && error.name === 'AbortError') return;
				if (!controller.signal.aborted) setResult({ status: 'error' });
			});
		return () => controller.abort();
	}, [apiPath]);

	const products = result.products ?? [];
	return (
		<section className="nvx-builder-node nvx-builder-product-grid" data-testid="product-grid-preview" data-product-grid data-selection={node.props.binding.selection} aria-label={node.props.heading || 'پیش‌نمایش محصولات'}>
			{node.props.heading ? <h3 className="nvx-builder-product-grid__heading">{node.props.heading}</h3> : null}
			{result.status === 'loading' ? <p className="nvx-builder-product-grid__state" role="status">در حال بارگیری محصولات…</p> : null}
			{result.status === 'disabled' ? <p className="nvx-builder-product-grid__state" role="status">فروشگاه غیرفعال است؛ پیش‌نمایش هنگام فعال‌بودن فروشگاه نمایش داده می‌شود.</p> : null}
			{result.status === 'error' ? <p className="nvx-builder-product-grid__state" role="alert">بارگیری پیش‌نمایش محصولات ممکن نیست.</p> : null}
			{result.status === 'ready' && products.length === 0 ? <p className="nvx-builder-product-grid__state" role="status">{node.props.emptyMessage}</p> : null}
			{result.status === 'ready' && products.length ? (
				<div className="nvx-builder-product-grid__items">
					{products.map((product) => (
						<article className="nvx-builder-product-card" key={product.slug} data-product-slug={product.slug}>
							<a className="nvx-builder-product-card__link" href={`/shop/${encodeURIComponent(product.slug)}`} onClick={(event) => event.preventDefault()} aria-label={`مشاهدهٔ ${product.name}`}>
								<ProductCardPreviewImage product={product} />
								<div className="nvx-builder-product-card__body">
									<span className="nvx-builder-product-card__category">{product.category}</span>
									<h4>{product.name}</h4>
									{product.description ? <p>{product.description}</p> : null}
									<div className="nvx-builder-product-card__foot">
										<span className="nvx-builder-product-card__price">
											{product.compareAtPrice ? <del>{faMoney(product.compareAtPrice, result.currency ?? 'IRR')}</del> : null}
											<strong>{faMoney(product.price, result.currency ?? 'IRR')}</strong>
										</span>
										<span className={`nvx-builder-product-card__availability${product.inStock ? '' : ' is-unavailable'}`}>{product.inStock ? 'موجود' : 'ناموجود'}</span>
									</div>
								</div>
							</a>
						</article>
					))}
				</div>
			) : null}
		</section>
	);
}

function ProductCardPreviewImage({ product }: { product: PublicProductCard }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [product.image]);
	return (
		<div className="nvx-builder-product-card__image">
			{product.image && !failed ? <img src={product.image} alt={product.name} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <span role="img" aria-label={`تصویر ${product.name} ثبت نشده است`}>تصویر در دسترس نیست</span>}
		</div>
	);
}

function PreviewImage({ src, alt }: { src: string; alt: string }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [src]);
	return failed ? <div className="nvx-builder-image__empty" role="img" aria-label={alt || 'تصویر در دسترس نیست'}>فایل تصویر پیدا نشد</div> : <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

interface InlineEditableTextProps {
	as: 'h1' | 'h2' | 'h3' | 'h4' | 'p';
	className: string;
	value: string;
	align?: string;
	style?: CSSProperties;
	label: string;
	onActivate: () => void;
	onCommit: (value: string) => void;
}

function InlineEditableText({ as, className, value, align, style, label, onActivate, onCommit }: InlineEditableTextProps) {
	const [editing, setEditing] = useState(false);
	const elementRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!editing || !elementRef.current) return;
		const element = elementRef.current;
		element.focus();
		const selection = window.getSelection();
		if (!selection) return;
		const range = window.document.createRange();
		range.selectNodeContents(element);
		range.collapse(false);
		selection.removeAllRanges();
		selection.addRange(range);
	}, [editing]);

	function finish(commit: boolean): void {
		const element = elementRef.current;
		if (!element) return;
		const next = (element.innerText ?? element.textContent ?? '').replace(/\r\n?/g, '\n');
		if (!commit) element.textContent = value;
		setEditing(false);
		if (commit && next !== value) onCommit(next);
	}

	const placeholder = as === 'p' ? 'برای وارد کردن متن دوبار کلیک کنید.' : 'برای وارد کردن تیتر دوبار کلیک کنید.';
	return createElement(as, {
		className,
		style,
		'data-align': align,
		'data-inline-editing': editing ? 'true' : 'false',
		'data-placeholder': placeholder,
		contentEditable: editing,
		tabIndex: 0,
		suppressContentEditableWarning: true,
		role: editing ? 'textbox' : undefined,
		'aria-label': editing ? label : value || placeholder,
		'aria-multiline': editing && as === 'p' ? true : undefined,
		spellCheck: true,
		title: editing ? undefined : 'برای ویرایش دوبار کلیک کنید',
		ref: (element: HTMLElement | null) => { elementRef.current = element; },
		onFocus: onActivate,
		onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => { event.stopPropagation(); onActivate(); setEditing(true); },
		onBlur: () => finish(true),
		onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				finish(false);
				event.currentTarget.blur();
			} else if (!editing && (event.key === 'Enter' || event.key === ' ')) {
				event.preventDefault();
				setEditing(true);
			} else if (event.key === 'Enter' && as !== 'p') {
				event.preventDefault();
				event.currentTarget.blur();
			}
		},
		onPaste: (event: ReactClipboardEvent<HTMLElement>) => {
			event.preventDefault();
			const selection = window.getSelection();
			if (!selection?.rangeCount) return;
			const range = selection.getRangeAt(0);
			range.deleteContents();
			const textNode = window.document.createTextNode(event.clipboardData.getData('text/plain'));
			range.insertNode(textNode);
			range.setStartAfter(textNode);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
		},
	}, value);
}

interface InspectorProps {
	node: BuilderNode;
	viewport: Breakpoint;
	canMoveUp: boolean;
	canMoveDown: boolean;
	onField: (field: InspectorField, value: unknown) => void;
	onHidden: (hidden: boolean) => void;
	onMove: (direction: -1 | 1) => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onDeselect: () => void;
	canReadMedia: boolean;
	onPickMedia: () => void;
}

function Inspector({ node, viewport, canMoveUp, canMoveDown, onField, onHidden, onMove, onDuplicate, onDelete, onDeselect, canReadMedia, onPickMedia }: InspectorProps) {
	const definition = getComponentDefinition(node.type);
	const groups: Array<{ key: InspectorField['group']; label: string }> = [
		{ key: 'content', label: 'محتوا' },
		{ key: 'layout', label: 'چیدمان' },
		{ key: 'style', label: 'نمایش' },
	];
	return (
		<div className="builder-inspector">
			<div className="builder-panel__heading builder-panel__heading--inspector">
				<div><span className="builder-inspector__eyebrow">تنظیمات {BREAKPOINT_LABELS[viewport]}</span><h2>{definition.label}</h2></div>
				<div className="builder-inspector__heading-actions"><span className="builder-inspector__type">{node.type}</span><button className="builder-icon-button" type="button" aria-label="پاک‌کردن انتخاب" title="پاک‌کردن انتخاب" onClick={onDeselect}>×</button></div>
			</div>
			<div className="builder-inspector__body">
				{groups.map((group) => {
					const fields = definition.fields.filter((field) =>
						field.group === group.key &&
						!(node.type === 'ProductGrid' && field.key === 'binding.category' && node.props.binding.selection !== 'category'),
					);
					if (!fields.length) return null;
					return <section className="builder-field-group" key={group.key}><h3>{group.label}</h3>{fields.map((field) => (
						<div className={node.type === 'Image' && field.key === 'src' ? 'builder-field-with-action' : undefined} key={field.key}>
							<InspectorControl field={field} value={fieldValue(node, field, viewport)} onChange={(value) => onField(field, value)} />
							{node.type === 'Image' && field.key === 'src' ? <button className="builder-media-picker-trigger" type="button" data-testid="open-media-picker" disabled={!canReadMedia} title={canReadMedia ? 'انتخاب از کتابخانهٔ رسانه' : 'نقش شما اجازهٔ خواندن رسانه را ندارد'} onClick={onPickMedia}>انتخاب از کتابخانهٔ رسانه</button> : null}
						</div>
					))}</section>;
				})}
				<section className="builder-field-group builder-responsive-group">
					<h3>واکنش‌گرا</h3>
					<label className="builder-toggle-row"><span><strong>پنهان در {BREAKPOINT_LABELS[viewport]}</strong><small>فقط در پیش‌نمایش این اندازه</small></span><input type="checkbox" checked={Boolean(node.responsiveStyles?.[viewport]?.hidden)} onChange={(event) => onHidden(event.target.checked)} /></label>
					<p>تغییرات عرض و فاصله در اندازهٔ انتخاب‌شده به‌صورت مقدار واکنش‌گرا ذخیره می‌شوند.</p>
				</section>
				<section className="builder-component-help"><strong>{definition.documentation}</strong><span>نمونه: {definition.example}</span></section>
			</div>
			<div className="builder-inspector__actions">
				<button type="button" title="انتقال به بالا" aria-label="انتقال به بالا" disabled={!canMoveUp} onClick={() => onMove(-1)}>↑</button>
				<button type="button" title="انتقال به پایین" aria-label="انتقال به پایین" disabled={!canMoveDown} onClick={() => onMove(1)}>↓</button>
				<button type="button" onClick={onDuplicate}>رونوشت</button>
				<button className="is-danger" type="button" onClick={onDelete}>حذف</button>
			</div>
		</div>
	);
}

interface InspectorControlProps {
	field: InspectorField;
	value: unknown;
	onChange: (value: unknown) => void;
}

function InspectorControl({ field, value, onChange }: InspectorControlProps) {
	const draftKey = `${field.key}:${String(value ?? '')}`;
	const [draft, setDraft] = useState<string>(() => String(value ?? ''));
	useEffect(() => setDraft(String(value ?? '')), [draftKey]);
	const id = `builder-field-${field.key.replace(/[^a-z0-9-]/gi, '-')}`;
	const control = field.kind === 'select' || (field.kind === 'number' && field.options) ? (
		<select id={id} value={String(value ?? '')} onChange={(event) => {
			const raw = event.target.value;
			if (raw === '') { onChange(''); return; }
			const option = field.options?.find((item) => String(item.value) === raw);
			onChange(option?.value ?? raw);
		}}>
			{field.options?.map((option) => <option key={`${field.key}-${String(option.value)}`} value={String(option.value)}>{option.label}</option>)}
		</select>
	) : field.kind === 'textarea' ? (
		<textarea id={id} value={draft} maxLength={field.maxLength} rows={4} onChange={(event) => { setDraft(event.target.value); onChange(event.target.value); }} />
	) : (
		<input
			id={id}
			type={field.kind === 'url' ? 'url' : field.kind === 'number' ? 'number' : 'text'}
			value={draft}
			maxLength={field.maxLength}
			onChange={(event) => {
				const next = event.target.value;
				setDraft(next);
				if (field.kind === 'url') return;
				if (field.kind === 'number') onChange(Number(next));
				else onChange(next);
			}}
			onBlur={() => { if (field.kind === 'url') onChange(draft); }}
		/>
	);
	return <label className="builder-field" htmlFor={id}><span>{field.label}</span>{control}</label>;
}

interface PageInspectorProps {
	document: PageDocument;
	onDescription: (value: string) => void;
	onTheme: (themeId: BuilderThemeId) => void;
}

function PageInspector({ document, onDescription, onTheme }: PageInspectorProps) {
	return (
		<div className="builder-inspector">
			<div className="builder-panel__heading builder-panel__heading--inspector"><div><span className="builder-inspector__eyebrow">تنظیمات سند</span><h2>صفحه</h2></div><span className="builder-inspector__type">صفحه</span></div>
			<div className="builder-inspector__body">
				<section className="builder-field-group"><h3>فراداده</h3>
					<label className="builder-field"><span>نامک</span><input dir="ltr" value={document.slug} readOnly /></label>
					<label className="builder-field"><span>تم طراحی</span><select value={document.themeId} onChange={(event) => onTheme(event.target.value as BuilderThemeId)}>{BUILDER_THEME_LIST.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}</select></label>
					<label className="builder-field"><span>توضیحات</span><textarea value={document.description} maxLength={200} rows={5} placeholder="توضیح کوتاهی برای موتورهای جست‌وجو…" onChange={(event) => onDescription(event.target.value)} /></label>
					<p className="builder-field-hint">عنوان صفحه را از نوار بالا ویرایش کنید. توضیحات حداکثر ۲۰۰ نویسه است.</p>
				</section>
				<section className="builder-field-group"><h3>سند</h3><p className="builder-field-hint">نسخهٔ طرحوارهٔ {document.schemaVersion} · {countNodes(document.nodes).toLocaleString('fa-IR')} مؤلفه</p></section>
			</div>
		</div>
	);
}

function previewStyle(node: BuilderNode, viewport: Breakpoint): CSSProperties {
	const styles: ResponsiveNodeStyles = {
		...node.styles,
		...(node.responsiveStyles?.desktop ?? {}),
		...(viewport !== 'desktop' ? node.responsiveStyles?.tablet ?? {} : {}),
		...(viewport === 'mobile' ? node.responsiveStyles?.mobile ?? {} : {}),
	};
	const widthStyles: CSSProperties = styles.width ? {
		width: styles.width === 'content' ? 'max-content' : styles.width === 'narrow' ? 'min(100%, 40rem)' : styles.width === 'wide' ? 'min(100%, 72rem)' : '100%',
		maxWidth: styles.width === 'full' ? 'none' : '100%',
	} : {};
	const radius: Record<NonNullable<NodeStyles['borderRadius']>, string> = { none: '0', sm: '.35rem', md: '.7rem', lg: '1.1rem' };
	return {
		...widthStyles,
		marginBlockStart: styles.marginBlockStart,
		marginBlockEnd: styles.marginBlockEnd,
		paddingBlockStart: styles.paddingBlockStart,
		paddingBlockEnd: styles.paddingBlockEnd,
		paddingInlineStart: styles.paddingInlineStart,
		paddingInlineEnd: styles.paddingInlineEnd,
		borderRadius: styles.borderRadius ? radius[styles.borderRadius] : undefined,
	};
}

function fieldValue(node: BuilderNode, field: InspectorField, viewport: Breakpoint): unknown {
	if (field.key.startsWith('binding.') && node.type === 'ProductGrid') {
		return node.props.binding[field.key.slice('binding.'.length) as keyof ProductGridBinding] ?? '';
	}
	if (!field.key.startsWith('styles.')) return node.props[field.key as keyof typeof node.props];
	const key = field.key.slice('styles.'.length) as keyof NodeStyles;
	if (viewport === 'desktop') return node.styles?.[key] ?? '';
	const active = node.responsiveStyles?.[viewport]?.[key];
	if (active !== undefined) return active;
	if (viewport === 'mobile') {
		const tablet = node.responsiveStyles?.tablet?.[key];
		if (tablet !== undefined) return tablet;
	}
	return node.styles?.[key] ?? '';
}

function canMoveDown(nodes: BuilderNode[], id: string): boolean {
	const location = findNodeLocation(nodes, id);
	if (!location) return false;
	const siblings = location.parentId ? findNode(nodes, location.parentId) : null;
	const list = siblings?.type === 'Container' ? siblings.children : nodes;
	return location.index < list.length - 1;
}

function countNodes(nodes: BuilderNode[]): number {
	return nodes.reduce((count, node) => count + 1 + (node.type === 'Container' ? countNodes(node.children) : 0), 0);
}

function formatDate(value: string): string {
	return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

async function readResponse(response: Response): Promise<Record<string, any>> {
	try {
		const value: unknown = await response.json();
		return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
	} catch {
		return {};
	}
}
