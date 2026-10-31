import { createElement, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, CSSProperties, DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { COMPONENT_LIST, getComponentDefinition, isBuilderComponentType } from '../../lib/builder/registry.ts';
import { dropInsertionPoint, dropPlacement } from '../../lib/builder/drag-drop.ts';
import type { MovePlacement } from '../../lib/builder/operations.ts';
import { BREAKPOINT_MAX_WIDTH, MAX_CUSTOM_BREAKPOINTS, breakpointRanges, breakpointWidths, explicitNodeStyle, resolveNodeStyle, resolveNodeStyles } from '../../lib/builder/responsive.ts';
import { nodeStyleObject } from '../../lib/builder/render.ts';
import { fieldVisibleInMode } from '../../lib/builder/editor-mode.ts';
import type { ElementorImport } from '../../lib/migrations/elementor/converter.ts';
import { MAX_MIGRATION_MEDIA_MAP_BYTES, parseMigrationMediaMap, type MigrationMediaMap } from '../../lib/migrations/media-map.ts';
import type { WxrInspection } from '../../lib/migrations/wordpress/wxr.ts';
import {
	AutosaveConflictError,
	AutosaveController,
	type AutosaveStatus,
} from '../../lib/builder/autosave.ts';
import { createEmptyPageDocument, exportPageDocument, hiddenAtBreakpoint, importPageDocument, validatePageDocument } from '../../lib/builder/document.ts';
import { resolveBuilderImageSource } from '../../lib/builder/media-reference.ts';
import type { BuilderDiagnostic } from '../../lib/builder/diagnostics.ts';
import {
	createNodeId,
	createBuilderNode,
	findNode,
	findNodeLocation,
	findNodePath,
	traversePageNodes,
} from '../../lib/builder/operations.ts';
import { commitValidatedDocument, createDocumentHistory, redoDocument, undoDocument } from '../../lib/builder/history.ts';
import { executeDocumentCommand, type DocumentCommand } from '../../lib/builder/commands.ts';
import { EditorEvents, type EditorEventPayloads } from '../../lib/builder/events.ts';
import { BUILDER_THEME_LIST, themeVariables } from '../../lib/builder/themes.ts';
import { applyTemplate, listStarterTemplateSummaries } from '../../lib/builder/templates.ts';
import type { SiteKit } from '../../lib/builder/site-kits.ts';
import type { WasmProcessorSummary } from '../../lib/builder/plugin-wasm.ts';
import { materializeBuilderPreset, type BuilderPluginPreset } from '../../lib/builder/plugin-presets.ts';
import { resolvePluginParts } from '../../lib/builder/plugin-components.ts';
import { isExtendedContentNode } from '../../lib/builder/extended-content.ts';
import { ExtendedContent } from './ExtendedContent.tsx';
import { CodeWidgetPreview } from './CodeWidgetPreview.tsx';
import { AccordionFields, GalleryFields, TabsFields, ListFields } from './CollectionFields.tsx';
import { RichTextFields, type RichTextFieldValue } from './RichTextFields.tsx';
import { RichTextRuns } from './RichTextRuns.tsx';
import { productGridApiPath } from '../../lib/commerce/product-binding.ts';
import { faMoney } from '../../lib/cms/fa.ts';
import type { ProductGridBinding, PublicProductCard } from '../../lib/commerce/types.ts';
import type {
	AccordionItem,
	ListItem,
	GalleryItem,
	Breakpoint,
	BreakpointWidths,
	CustomBreakpointId,
	BuilderComponentType,
	BuilderThemeId,
	BuilderNode,
	ContainerNode,
	InspectorField,
	NodeStyles,
	PageDocument,
	PluginBlockProps,
	TextMark,
} from '../../lib/builder/types.ts';
import '../../styles/builder.css';
import '../../styles/builder-editor.css';
import '../../styles/design-system.css';

interface Props {
	pluginPresets: BuilderPluginPreset[];
	pluginProcessors: WasmProcessorSummary[];
	pluginComponents: PluginBlockProps[];
	initialDocument: PageDocument;
	initialRevision: number;
	publishedAt: string | null;
	slug: string;
	canPublish: boolean;
	canPublishCode: boolean;
	canWritePosts: boolean;
	canReadMedia: boolean;
	canUploadMedia: boolean;
	initialSectionId?: string;
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
	kind?: 'page' | 'section';
	image?: string;
	category?: string;
	document?: PageDocument;
}

interface SectionInsertionTarget { targetId: string | null; placement?: 'before' | 'after' }
interface TemplatePreview { name: string; document: PageDocument; item?: TemplateSummary }
interface SharedSectionSummary { id: string; name: string; revision: number; updatedAt: string }
interface ArchiveKitSummary { id: string; name: string; version: string; assetCount: number; pages: Array<{ suffix: string; title: string }> }
interface KitReviewField { slug: string; path: string; kind: 'field' | 'structural' | 'order' | 'formatted'; base: string; local: string; incoming: string }
interface KitReview { token: string; fields: KitReviewField[]; unresolved: Array<{ slug: string; path: string }>; truncated: boolean }
type KitReviewSource = { kind: 'builtin'; id: string; prefix: string } | { kind: 'package'; kit: SiteKit; prefix: string } | { kind: 'archive'; file: File; prefix: string; assetCount: number };
interface KitReviewState { source: KitReviewSource; review: KitReview; choices: Array<'local' | 'incoming' | null>; error: string }

interface WxrArchiveItemSummary { title: string; type: 'page' | 'post'; warnings: string[]; hasElementor: boolean; elementorWarnings: string[]; elementorError: string; blogWarnings: string[]; blogError: string }
interface WxrArchiveSummary { version: string; items: WxrArchiveItemSummary[]; ignored: number; assetCount: number; postAssetCount: number; matchedAttachments: number; unmatchedAttachments: number }

interface MediaPickerItem {
	name: string;
	assetRef: string;
	publicUrl: string;
	previewUrl: string;
	bytes: number;
	modifiedAt: string;
	mimeType: string;
	width?: number;
	height?: number;
	builtin: boolean;
	reused?: boolean;
}

const STATUS_LABELS: Record<AutosaveStatus, string> = {
	saved: 'همهٔ تغییرات ذخیره شد',
	dirty: 'تغییرات ذخیره‌نشده',
	saving: 'در حال ذخیره…',
	error: 'ذخیره ناموفق بود',
	conflict: 'تعارض نسخه',
};

export default function BuilderEditor({ pluginComponents, pluginPresets, pluginProcessors, initialDocument, initialRevision, publishedAt, slug, canPublish, canPublishCode, canWritePosts, canReadMedia, canUploadMedia, initialSectionId }: Props) {
	const [history, setHistory] = useState(() => createDocumentHistory(initialDocument));
	const historyRef = useRef(history);
	const [revision, setRevision] = useState(initialRevision);
	const revisionRef = useRef(initialRevision);
	const [isPublished, setIsPublished] = useState(Boolean(publishedAt));
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [dragOverId, setDragOverId] = useState<string | null>(null);
	const [dragPlacement, setDragPlacement] = useState<MovePlacement>('after');
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
	const [sectionInsertion, setSectionInsertion] = useState<SectionInsertionTarget>({ targetId: null });
	const [templateError, setTemplateError] = useState('');
	const [templateActionBusy, setTemplateActionBusy] = useState(false);
	const templateGeneration = useRef(0);
	const templateActive = useRef(false);
	const templateListAbort = useRef<AbortController | null>(null);
	const templateActionAbort = useRef<AbortController | null>(null);
	const [sharedSections, setSharedSections] = useState<SharedSectionSummary[]>([]);
	const [sharedBusy, setSharedBusy] = useState(false);
	const [sharedCreateTarget, setSharedCreateTarget] = useState<string | null>(null);
	const [sharedName, setSharedName] = useState('');
	const [libraryQuery, setLibraryQuery] = useState('');
	const [libraryGroup, setLibraryGroup] = useState<'all' | 'layout' | 'content' | 'media' | 'commerce' | 'plugins'>('all');
	const [templateQuery, setTemplateQuery] = useState('');
	const [templateFilter, setTemplateFilter] = useState<'all' | 'page' | 'section' | 'saved'>('all');
	const [siteKits, setSiteKits] = useState<SiteKit[]>([]);
	const [siteKitsLoading, setSiteKitsLoading] = useState(false);
	const siteKitsLoaded = useRef(false);
	const [kitPrefix, setKitPrefix] = useState('');
	const [kitStatus, setKitStatus] = useState('');
	const [kitBusy, setKitBusy] = useState(false);
	const [packageKit, setPackageKit] = useState<SiteKit | null>(null);
	const [packagePrefix, setPackagePrefix] = useState('');
	const [packageStatus, setPackageStatus] = useState('');
	const [archiveKit, setArchiveKit] = useState<{ file: File; summary: ArchiveKitSummary } | null>(null);
	const [archivePrefix, setArchivePrefix] = useState('');
	const [archiveStatus, setArchiveStatus] = useState('');
	const [kitReview, setKitReview] = useState<KitReviewState | null>(null);
	const [templatePreview, setTemplatePreview] = useState<TemplatePreview | null>(null);
	const [presetDialog, setPresetDialog] = useState<{ preset: BuilderPluginPreset; values: Record<string, string>; error: string } | null>(null);
	const [processorDialog, setProcessorDialog] = useState<{ processor: WasmProcessorSummary; values: Record<string, string>; error: string } | null>(null);
	const [processorBusy, setProcessorBusy] = useState(false);
	const processorAbort = useRef<AbortController | null>(null);
	useEffect(() => () => processorAbort.current?.abort(), []);
	const [saveSelectedSection, setSaveSelectedSection] = useState(false);
	const [templateLoading, setTemplateLoading] = useState(false);
	const [templateSaveOpen, setTemplateSaveOpen] = useState(false);
	const [templateName, setTemplateName] = useState('');
	const [templateSaving, setTemplateSaving] = useState(false);
	const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
	const [mediaItems, setMediaItems] = useState<MediaPickerItem[]>([]);
	const [mediaLoading, setMediaLoading] = useState(false);
	const [mediaUploading, setMediaUploading] = useState(false);
	const [mediaDeduplicate, setMediaDeduplicate] = useState(false);
	const [mediaError, setMediaError] = useState('');
	const [publishBusy, setPublishBusy] = useState(false);
	const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
	const [diagnosticReport, setDiagnosticReport] = useState<{ snapshot: string; items: BuilderDiagnostic[] } | null>(null);
	const controllerRef = useRef<AutosaveController | null>(null);
	const events = useMemo(() => new EditorEvents(), []);
	const importInputRef = useRef<HTMLInputElement | null>(null);
	const mediaFileRef = useRef<HTMLInputElement | null>(null);
	const mediaTargetRef = useRef<{ nodeId: string; itemId?: string } | null>(null);
	const document = history.present;
	const ranges = breakpointRanges(document);
	useEffect(() => { if (!ranges.some((range) => range.id === viewport)) setViewport('desktop'); }, [document.breakpoints, viewport]);
	const selectedNode = selectedId ? findNode(document.nodes, selectedId) : null;
	const paletteNeedle = normalizeLibrarySearch(libraryQuery.trim());
	const paletteMatches = (...parts: string[]) => !paletteNeedle || normalizeLibrarySearch(parts.join(' ')).includes(paletteNeedle);
	const paletteDefinitions = COMPONENT_LIST.filter((definition) => (definition.type !== 'GlobalCode' || canPublishCode) && (libraryGroup === 'all' || (libraryGroup === 'content' ? definition.category === 'content' || definition.category === 'action' : definition.category === libraryGroup)) && paletteMatches(definition.label, definition.description));
	const paletteGrid = (libraryGroup === 'all' || libraryGroup === 'layout') && paletteMatches('شبکه', 'بخش Grid با ستون‌های واکنش‌گرا');
	const palettePluginComponents = libraryGroup === 'all' || libraryGroup === 'plugins' ? pluginComponents.filter((component) => paletteMatches(component.label, 'مؤلفهٔ افزونه')) : [];
	const palettePresets = libraryGroup === 'all' || libraryGroup === 'plugins' ? pluginPresets.filter((preset) => paletteMatches(preset.label, preset.description)) : [];
	const paletteProcessors = libraryGroup === 'all' || libraryGroup === 'plugins' ? pluginProcessors.filter((processor) => paletteMatches(processor.label, processor.description)) : [];
	const [previewOpen, setPreviewOpen] = useState(false);
	const [elementorImport, setElementorImport] = useState<ElementorImport | null>(null);
	const [elementorSource, setElementorSource] = useState('');
	const [elementorMediaStatus, setElementorMediaStatus] = useState('');
	const [elementorMapBusy, setElementorMapBusy] = useState(false);
	const elementorMapRequest = useRef(0);
	const [wxrImport, setWxrImport] = useState<{ xml: string; inspection: WxrInspection; index: number; document: PageDocument | null; preferElementor: boolean; conversionError: string; mediaMap?: MigrationMediaMap } | null>(null);
	const wxrImportRef = useRef(wxrImport); wxrImportRef.current = wxrImport;
	const wxrMapRequest = useRef(0);
	const [wxrMediaStatus, setWxrMediaStatus] = useState('');
	const [wxrMapBusy, setWxrMapBusy] = useState(false);
	const [wxrBulkPrefix, setWxrBulkPrefix] = useState('');
	const [wxrBulkBusy, setWxrBulkBusy] = useState(false);
	const [wxrBulkStatus, setWxrBulkStatus] = useState('');
	const [wxrBlogBulkBusy, setWxrBlogBulkBusy] = useState(false);
	const [wxrBlogBulkStatus, setWxrBlogBulkStatus] = useState('');
	const [wxrBlogBulkIds, setWxrBlogBulkIds] = useState<string[]>([]);
	const [wxrBlogBulkUncertain, setWxrBlogBulkUncertain] = useState(false);
	const [wxrPostSlug, setWxrPostSlug] = useState('');
	const [wxrPostBusy, setWxrPostBusy] = useState(false);
	const [wxrPostStatus, setWxrPostStatus] = useState('');
	const [wxrPostId, setWxrPostId] = useState('');
	const [wxrPostUncertain, setWxrPostUncertain] = useState(false);
	const [migrationTools, setMigrationTools] = useState<typeof import('../../lib/migrations/browser-tools.ts') | null>(null);
	const migrationToolsRef = useRef(migrationTools);
	async function loadMigrationTools() {
		if (migrationToolsRef.current) return migrationToolsRef.current;
		const tools = await import('../../lib/migrations/browser-tools.ts');
		migrationToolsRef.current = tools;
		setMigrationTools(tools);
		return tools;
	}
	const wxrReports = useMemo(() => {
		if (!wxrImport || !migrationTools) return [];
		return wxrImport.inspection.items.map((item) => {
			try { const result = migrationTools.convertWxrItem(item, createEmptyPageDocument('wxr-preview'), wxrImport.preferElementor, wxrImport.mediaMap); return { source: result.source, messages: result.warnings.map((warning) => `${warning.sourceId}: ${warning.message}`), error: '' }; }
			catch (error) { return { source: wxrImport.preferElementor && item.elementorData ? 'elementor' as const : 'html' as const, messages: [], error: error instanceof Error ? error.message : 'تبدیل محتوا انجام نشد.' }; }
		});
	}, [migrationTools, wxrImport?.inspection, wxrImport?.preferElementor, wxrImport?.mediaMap]);
	const wxrPostPreview = useMemo(() => {
		const item = wxrImport?.inspection.items[wxrImport.index];
		if (!item || item.type !== 'post' || !migrationTools) return null;
		try { return { draft: migrationTools.wxrPostToBlogDraft(item, wxrImport?.mediaMap), error: '' }; }
		catch (error) { return { draft: null, error: error instanceof Error ? error.message : 'تبدیل نوشته انجام نشد.' }; }
	}, [migrationTools, wxrImport?.inspection, wxrImport?.index, wxrImport?.mediaMap]);
	const wxrBlogReports = useMemo(() => {
		const items = wxrImport?.inspection.items.filter((item) => item.type === 'post') ?? [];
		if (items.length > 20 || !migrationTools) return [];
		return items.map((item) => {
			try { return { title: item.blogTitle ?? item.title, warnings: migrationTools.wxrPostToBlogDraft(item, wxrImport?.mediaMap).warnings, error: '' }; }
			catch (error) { return { title: item.blogTitle ?? item.title, warnings: [], error: error instanceof Error ? error.message : 'تبدیل نوشته انجام نشد.' }; }
		});
	}, [migrationTools, wxrImport?.inspection, wxrImport?.mediaMap]);
	const [wxrArchive, setWxrArchive] = useState<{ file: File; summary: WxrArchiveSummary } | null>(null);
	const [wxrArchivePrefix, setWxrArchivePrefix] = useState('');
	const [wxrArchivePreferElementor, setWxrArchivePreferElementor] = useState(false);
	const [wxrArchiveBusy, setWxrArchiveBusy] = useState(false);
	const [wxrArchiveStatus, setWxrArchiveStatus] = useState('');
	const [wxrArchivePages, setWxrArchivePages] = useState<string[]>([]);
	const [wxrArchivePageUncertain, setWxrArchivePageUncertain] = useState(false);
	const [wxrArchivePosts, setWxrArchivePosts] = useState<string[]>([]);
	const [wxrArchivePostStatus, setWxrArchivePostStatus] = useState('');
	const [wxrArchivePostUncertain, setWxrArchivePostUncertain] = useState(false);
	const wxrArchiveInputRef = useRef<HTMLInputElement | null>(null);
	const wxrArchiveInspection = useRef(0);
	const wxrInputRef = useRef<HTMLInputElement | null>(null);
	const elementorInputRef = useRef<HTMLInputElement | null>(null);
// Preferences are editor UI state only; they never modify the page document.
const [mode, setMode] = useState<'simple' | 'pro'>('pro');
const [editorTheme, setEditorTheme] = useState<'light' | 'dark'>('dark');
const [preferencesLoaded, setPreferencesLoaded] = useState(false);
useEffect(() => {
	try {
		const storedMode = localStorage.getItem('novex-editor-mode');
		const storedTheme = localStorage.getItem('novex-editor-theme');
		if (storedMode === 'simple' || storedMode === 'pro') setMode(storedMode);
		if (storedTheme === 'light' || storedTheme === 'dark') setEditorTheme(storedTheme);
	} catch { /* Storage can be disabled by the browser. */ }
	setPreferencesLoaded(true);
}, []);
useEffect(() => {
	if (!preferencesLoaded) return;
	try {
		localStorage.setItem('novex-editor-theme', editorTheme);
		localStorage.setItem('novex-editor-mode', mode);
	} catch { /* Preferences are optional. */ }
}, [editorTheme, mode, preferencesLoaded]);

useEffect(() => {
	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape' && previewOpen) {
			setPreviewOpen(false);
		}
	}
	if (typeof window !== 'undefined') {
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}
}, [previewOpen]);

const toggleTheme = () => setEditorTheme((prev) => (prev === 'light' ? 'dark' : 'light'));

async function refreshRevisionHistory(): Promise<void> {
		const requestId = ++revisionHistoryRequestRef.current;
		setRevisionLoading(true);
		try {
			const response = await fetch(`/cms/api/builder/pages/${encodeURIComponent(slug)}/history`, { headers: { accept: 'application/json' } });
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'خواندن تاریخچه ممکن نشد.');
			if (!result.revisions) throw new Error('پاسخ تاریخچه معتبر نیست.');
			if (requestId === revisionHistoryRequestRef.current) setRevisions(result.revisions);
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

	useEffect(() => events.on('document.changed', ({ document: changed }) => controllerRef.current?.schedule(changed)), [events]);

	// A marketplace link opens a review state only; it never installs content.
	useEffect(() => {
		if (initialSectionId) {
			void openTemplateLibrary({ sectionId: initialSectionId });
			const url = new URL(window.location.href);
			if (url.searchParams.get('section') === initialSectionId) {
				url.searchParams.delete('section');
				window.history.replaceState(window.history.state, '', url);
			}
		}
		return () => {
			templateActive.current = false;
			templateGeneration.current += 1;
			templateListAbort.current?.abort();
			templateActionAbort.current?.abort();
		};
	}, [initialSectionId]);

	function emitEditorEvent<K extends keyof EditorEventPayloads>(type: K, payload: EditorEventPayloads[K]): void {
		const failures = events.emit(type, payload);
		if (failures.length) setMessage(`پردازش رویداد ویرایشگر انجام نشد: ${failures[0].message}`);
	}

	function selectNode(nodeId: string | null): void {
		setSelectedId(nodeId);
		emitEditorEvent('selection.changed', { nodeId });
	}

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
				selectNode(null);
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
				void saveNow().catch(() => undefined);
			}
		};
		window.addEventListener('keydown', handleShortcut);
		return () => window.removeEventListener('keydown', handleShortcut);
	});

	function applyDocument(nextDocument: PageDocument, options: { selectionAfter?: string | null; group?: string } = {}): boolean {
		const current = historyRef.current;
		// nextDocument comes exclusively from the shared validated command boundary.
		const next = commitValidatedDocument(current, nextDocument, 60, { selectionBefore: selectedId, ...options });
		if (next === current) return false;
		historyRef.current = next;
		setHistory(next);
		setMessage('');
		emitEditorEvent('document.changed', { document: next.present, reason: 'edit' });
		return true;
	}

	function runDocumentCommand(command: DocumentCommand, group?: string, onError: (message: string) => void = setMessage): boolean {
		const result = executeDocumentCommand(historyRef.current.present, command);
		if (!result.ok) { onError(result.error.message); return false; }
		const changed = applyDocument(result.document, { selectionAfter: result.selectedId === undefined ? selectedId : result.selectedId, group });
		if (result.selectedId !== undefined) selectNode(result.selectedId);
		if (changed && command.type === 'insert' && result.selectedId) emitEditorEvent('node.inserted', { nodeId: result.selectedId });
		else if (changed && command.type === 'delete') emitEditorEvent('node.removed', { nodeId: command.id });
		else if (changed && ('id' in command) && typeof command.id === 'string') emitEditorEvent('node.updated', { nodeId: command.id });
		return true;
	}

	function applyTitle(value: string): void {
		setTitleDraft(value);
		if (!value.trim() || value.length > 100) return;
		runDocumentCommand({ type: 'metadata', patch: { title: value } }, 'page:title');
	}

	function undo(): void {
		const current = historyRef.current;
		const next = undoDocument(current, selectedId);
		if (next === current) return;
		historyRef.current = next;
		setHistory(next);
		emitEditorEvent('document.changed', { document: next.present, reason: 'undo' });
		selectNode(next.presentSelection && findNode(next.present.nodes, next.presentSelection) ? next.presentSelection : null);
	}

	function redo(): void {
		const current = historyRef.current;
		const next = redoDocument(current, selectedId);
		if (next === current) return;
		historyRef.current = next;
		setHistory(next);
		emitEditorEvent('document.changed', { document: next.present, reason: 'redo' });
		selectNode(next.presentSelection && findNode(next.present.nodes, next.presentSelection) ? next.presentSelection : null);
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
				if (typeof result.revision !== 'number') throw new Error('پاسخ نسخهٔ ذخیره‌شده معتبر نیست.');
				const nextDocument = validatePageDocument(result.document, slug);
				const nextHistory = createDocumentHistory(nextDocument);
				historyRef.current = nextHistory;
				setHistory(nextHistory);
				revisionRef.current = result.revision;
				setRevision(result.revision);
				if (historyOpenRef.current) void refreshRevisionHistory();
				setIsPublished(Boolean(result.publishedAt));
				controllerRef.current?.initialize(nextDocument);
				selectNode(null);
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
		const request = beginTemplateRequest();
		if (!request) return;
		try {
			const templateDocument = await loadTemplateDocument(item, request.controller.signal);
			if (!isCurrentTemplateRequest(request)) return;
			const json = exportPageDocument(templateDocument);
			const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const anchor = window.document.createElement('a');
			anchor.href = url;
			anchor.download = `novex-template-${item.id.replace(/[^a-z0-9_-]/gi, '-')}.json`;
			anchor.click();
			URL.revokeObjectURL(url);
		} catch (error) { if (isCurrentTemplateRequest(request)) setTemplateError(error instanceof Error ? error.message : 'خروجی قالب آماده نشد.'); }
		finally { finishTemplateRequest(request); }
	}

	async function importDocument(file: File): Promise<void> {
		if (file.size > 1024 * 1024) {
			setMessage('حداکثر اندازهٔ سند واردشده ۱ مگابایت است.');
			return;
		}
		if ((historyRef.current.present.nodes.length || controllerRef.current?.isDirty()) && !window.confirm('محتوای فعلی با سند واردشده جایگزین شود؟')) return;
		try {
			const imported = importPageDocument(await file.text(), slug);
			const current = historyRef.current.present;
			const next = validatePageDocument({ ...imported, id: current.id, slug: current.slug }, slug);
			if (!runDocumentCommand({ type: 'replace-document', document: next })) return;
			setMessage('سند JSON بارگیری شد؛ ذخیرهٔ تغییرات به‌صورت خودکار انجام می‌شود.');
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'بارگیری سند JSON انجام نشد.');
		}
	}

	async function inspectElementor(file: File): Promise<void> {
		if (file.size > 1024 * 1024) { setMessage('حداکثر اندازهٔ فایل Elementor یک مگابایت است.'); return; }
		try {
			const [source, tools] = await Promise.all([file.text(), loadMigrationTools()]);
			const result = tools.convertElementorJson(source, historyRef.current.present);
			elementorMapRequest.current++; setElementorMapBusy(false); setElementorMediaStatus(''); setElementorSource(source);
			setElementorImport(result);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'بررسی فایل Elementor انجام نشد.');
		}
	}

	async function inspectWordPressArchive(file: File): Promise<void> {
		const current = ++wxrArchiveInspection.current;
		if (!file.size || file.size > 32 * 1024 * 1024) { setMessage('حجم بستهٔ WordPress باید حداکثر ۳۲ مگابایت باشد.'); return; }
		setMessage('در حال بررسی بستهٔ WordPress…');
		try {
			const form = new FormData(); form.set('action', 'inspect'); form.set('archive', file);
			const response = await fetch('/cms/api/builder/imports/wordpress-archive', { method: 'POST', headers: { accept: 'application/json' }, body: form });
			const result = await readResponse(response);
			if (current !== wxrArchiveInspection.current) return;
			if (!response.ok) throw new Error(result.message || 'بررسی بسته ممکن نشد.');
			if (result.ok !== true || !result.wxrArchive) throw new Error('پاسخ بررسی بسته معتبر نیست.');
			setWxrArchive({ file, summary: result.wxrArchive }); setWxrArchivePrefix(''); setWxrArchivePreferElementor(false); setWxrArchiveStatus(''); setWxrArchivePages([]); setWxrArchivePageUncertain(false); setWxrArchivePosts([]); setWxrArchivePostStatus(''); setWxrArchivePostUncertain(false); setMessage('');
		} catch (error) { if (current === wxrArchiveInspection.current) setMessage(error instanceof Error ? error.message : 'بررسی بسته ممکن نشد.'); }
	}
	async function installWordPressArchive(): Promise<void> {
		if (!wxrArchive || wxrArchiveBusy || wxrArchivePages.length || wxrArchivePageUncertain || !wxrArchivePrefix.trim()) return;
		const { file, summary } = wxrArchive;
		const prefix = wxrArchivePrefix.trim();
		if (summary.items.length < 1 || summary.items.length > 20) { setWxrArchiveStatus('تعداد صفحه‌ها برای ورود گروهی باید بین ۱ تا ۲۰ باشد.'); return; }
		if (summary.assetCount && !canUploadMedia) { setWxrArchiveStatus('برای ورود تصویرها مجوز بارگذاری رسانه لازم است.'); return; }
		if (wxrArchivePreferElementor && summary.items.some((item) => item.elementorError)) { setWxrArchiveStatus('یکی از داده‌های Elementor معتبر نیست؛ ابتدا روش HTML را انتخاب کنید یا فایل را اصلاح کنید.'); return; }
		if (!window.confirm(`${summary.items.length.toLocaleString('fa-IR')} پیش‌نویس و ${summary.assetCount.toLocaleString('fa-IR')} تصویر بسته وارد می‌شوند. انتشار انجام نمی‌شود. ادامه می‌دهید؟`)) return;
		setWxrArchiveBusy(true); setWxrArchiveStatus('در حال ورود بسته…');
		let responseReceived = false;
		try {
			const form = new FormData(); form.set('action', 'install'); form.set('archive', file); form.set('prefix', prefix); form.set('preferElementor', String(wxrArchivePreferElementor)); form.set('confirm', 'true');
			const response = await fetch('/cms/api/builder/imports/wordpress-archive', { method: 'POST', headers: { accept: 'application/json' }, body: form });
			responseReceived = true;
			if (response.status >= 500) setWxrArchivePageUncertain(true);
			let result: BuilderApiResponse;
			try { result = await readResponse(response); } catch (error) { if (response.ok) setWxrArchivePageUncertain(true); throw error; }
			if (!response.ok) { if (result.code === 'archive_rollback_retained') setWxrArchivePageUncertain(true); throw new Error(result.message || 'ورود بسته ممکن نشد.'); }
			if (result.ok !== true || !result.pages || result.pages.length !== summary.items.length || result.pages.some((page, index) => page.slug !== `${prefix}-${index + 1}`)) { setWxrArchivePageUncertain(true); throw new Error('پاسخ ورود معتبر نیست؛ وضعیت صفحه‌ها را پیش از تلاش دوباره بررسی کنید.'); }
			setWxrArchivePages(result.pages.map((page) => page.slug)); setWxrArchiveStatus('پیش‌نویس‌ها و رسانه‌های بسته وارد شدند؛ هیچ صفحه‌ای منتشر نشد.');
		} catch (error) {
			if (!responseReceived) { setWxrArchivePageUncertain(true); setWxrArchiveStatus('پاسخ دریافت نشد؛ وضعیت صفحه‌ها را پیش از تلاش دوباره بررسی کنید.'); }
			else setWxrArchiveStatus(error instanceof Error ? error.message : 'ورود بسته ممکن نشد.');
		} finally { setWxrArchiveBusy(false); }
	}

	async function installWordPressArchivePosts(): Promise<void> {
		if (!wxrArchive || !canWritePosts || wxrArchiveBusy || wxrArchivePosts.length || wxrArchivePostUncertain || !wxrArchivePrefix.trim()) return;
		const { file, summary } = wxrArchive;
		const prefix = wxrArchivePrefix.trim();
		const posts = summary.items.filter((item) => item.type === 'post');
		if (!posts.length || posts.length > 20 || posts.some((item) => item.blogError)) { setWxrArchivePostStatus('برای ورود، بین ۱ تا ۲۰ نوشتهٔ قابل تبدیل لازم است.'); return; }
		if (summary.postAssetCount && !canUploadMedia) { setWxrArchivePostStatus('برای ورود تصویرهای نوشته مجوز بارگذاری رسانه لازم است.'); return; }
		if (!window.confirm(`${posts.length.toLocaleString('fa-IR')} نوشتهٔ مستقل و ${summary.postAssetCount.toLocaleString('fa-IR')} تصویر موردنیاز به‌صورت پیش‌نویس وارد می‌شوند. صفحه‌ها و طرح Elementor در این مسیر وارد نمی‌شوند. ادامه می‌دهید؟`)) return;
		setWxrArchiveBusy(true); setWxrArchivePostStatus('در حال ورود نوشته‌ها…');
		let responseReceived = false;
		try {
			const form = new FormData(); form.set('action', 'install-posts'); form.set('archive', file); form.set('prefix', prefix); form.set('preferElementor', 'false'); form.set('confirm', 'true');
			const response = await fetch('/cms/api/builder/imports/wordpress-archive', { method: 'POST', headers: { accept: 'application/json' }, body: form });
			responseReceived = true;
			if (response.status >= 500) setWxrArchivePostUncertain(true);
			let result: BuilderApiResponse;
			try { result = await readResponse(response); } catch (error) { if (response.ok) setWxrArchivePostUncertain(true); throw error; }
			if (!response.ok) { if (result.code === 'archive_rollback_retained') setWxrArchivePostUncertain(true); throw new Error(result.message || 'ورود نوشته‌ها ممکن نشد.'); }
			if (result.ok !== true || !result.posts || result.posts.length !== posts.length || result.posts.some((post, index) => post.id !== `${prefix}-${index + 1}.md`)) { setWxrArchivePostUncertain(true); throw new Error('پاسخ ورود معتبر نیست؛ پیش از تلاش دوباره فهرست نوشته‌ها را بررسی کنید.'); }
			setWxrArchivePosts(result.posts.map((post) => post.id)); setWxrArchivePostStatus('نوشته‌ها و تصویرهای لازم به‌صورت پیش‌نویس وارد شدند؛ هیچ نوشته‌ای منتشر نشد.');
		} catch (error) {
			if (!responseReceived) { setWxrArchivePostUncertain(true); setWxrArchivePostStatus('پاسخ دریافت نشد؛ پیش از تلاش دوباره فهرست نوشته‌ها را بررسی کنید.'); }
			else setWxrArchivePostStatus(error instanceof Error ? error.message : 'ورود نوشته‌ها ممکن نشد.');
		} finally { setWxrArchiveBusy(false); }
	}

	async function inspectWordPress(file: File): Promise<void> {
		if (file.size > 1024 * 1024) { setMessage('حداکثر اندازهٔ فایل WXR یک مگابایت است.'); return; }
		try {
			const [xml, tools] = await Promise.all([file.text(), loadMigrationTools()]);
			const inspection = tools.inspectWxr(xml);
			if (!inspection.items.length) throw new Error('صفحه یا نوشته‌ای در فایل پیدا نشد.');
			wxrMapRequest.current++; setWxrMapBusy(false); setWxrMediaStatus('');
			setWxrBulkStatus(''); setWxrBlogBulkStatus(''); setWxrBlogBulkIds([]); setWxrBlogBulkUncertain(false);
			setWxrBulkPrefix('');
			setWxrPostSlug(inspection.items[0].slug); setWxrPostStatus(''); setWxrPostId(''); setWxrPostUncertain(false);
			let document: PageDocument | null = null; let conversionError = '';
			try { document = tools.convertWxrItem(inspection.items[0], historyRef.current.present).document; }
			catch (error) { conversionError = error instanceof Error ? error.message : 'تبدیل مورد انتخابی انجام نشد.'; }
			setWxrImport({ xml, inspection, index: 0, document, preferElementor: false, conversionError });
		} catch (error) { setMessage(error instanceof Error ? error.message : 'بررسی فایل وردپرس انجام نشد.'); }
	}
	function selectWordPressItem(index: number, preferElementor = wxrImport?.preferElementor ?? false): void {
		if (!wxrImport || !wxrImport.inspection.items[index] || wxrPostBusy || wxrBlogBulkBusy) return;
		const tools = migrationToolsRef.current;
		if (!tools) { setMessage('ابزار تبدیل هنوز بارگیری نشده است. دوباره تلاش کنید.'); return; }
		if (index !== wxrImport.index) { setWxrPostSlug(wxrImport.inspection.items[index].slug); setWxrPostStatus(''); setWxrPostId(''); setWxrPostUncertain(false); }
		try { setWxrImport({ ...wxrImport, index, preferElementor, document: tools.convertWxrItem(wxrImport.inspection.items[index], historyRef.current.present, preferElementor, wxrImport.mediaMap).document, conversionError: '' }); }
		catch (error) { setWxrImport({ ...wxrImport, index, preferElementor, document: null, conversionError: error instanceof Error ? error.message : 'تبدیل مورد انتخابی انجام نشد.' }); }
	}
	async function inspectElementorMediaMap(file: File): Promise<void> {
		const tools = migrationToolsRef.current;
		if (!tools) { setElementorMediaStatus('ابزار تبدیل بارگیری نشده است.'); return; }
		const request = ++elementorMapRequest.current;
		setElementorMapBusy(true);
		try {
			if (!canReadMedia) throw new Error('نقش شما اجازهٔ خواندن رسانه را ندارد.');
			const mapping = await readMigrationMediaMapFile(file);
			await assertExistingMigrationMedia(mapping);
			if (request !== elementorMapRequest.current) return;
			const result = tools.convertElementorJson(elementorSource, historyRef.current.present, mapping);
			setElementorImport(result); setElementorMediaStatus(`${mapping.size.toLocaleString('fa-IR')} قانون بررسی شد؛ تطابق تصاویر را در پیش‌نمایش بازبینی کنید.`);
		} catch (error) {
			if (request !== elementorMapRequest.current) return;
			try { setElementorImport(tools.convertElementorJson(elementorSource, historyRef.current.present)); } catch { setElementorImport(null); }
			setElementorMediaStatus(`${error instanceof Error ? error.message : 'نگاشت معتبر نیست.'} نگاشت اعمال نشد.`);
		} finally { if (request === elementorMapRequest.current) setElementorMapBusy(false); }
	}
	async function inspectWordPressMediaMap(file: File): Promise<void> {
		const tools = migrationToolsRef.current;
		if (!tools) { setWxrMediaStatus('ابزار تبدیل بارگیری نشده است.'); return; }
		const request = ++wxrMapRequest.current;
		setWxrMapBusy(true);
		const inspection = wxrImport?.inspection;
		try {
			if (!canReadMedia) throw new Error('نقش شما اجازهٔ خواندن رسانه را ندارد.');
			const mapping = await readMigrationMediaMapFile(file);
			await assertExistingMigrationMedia(mapping);
			const current = wxrImportRef.current;
			if (request !== wxrMapRequest.current || !current || current.inspection !== inspection) return;
			const document = tools.convertWxrItem(current.inspection.items[current.index], historyRef.current.present, current.preferElementor, mapping).document;
			setWxrImport({ ...current, mediaMap: mapping, document, conversionError: '' });
			setWxrMediaStatus(`${mapping.size.toLocaleString('fa-IR')} قانون بررسی شد؛ تطابق تصاویر را در پیش‌نمایش بازبینی کنید.`);
		} catch (error) {
			const current = wxrImportRef.current;
			if (request !== wxrMapRequest.current || !current || current.inspection !== inspection) return;
			try { setWxrImport({ ...current, mediaMap: undefined, document: tools.convertWxrItem(current.inspection.items[current.index], historyRef.current.present, current.preferElementor).document, conversionError: '' }); }
			catch (conversionError) { setWxrImport({ ...current, mediaMap: undefined, document: null, conversionError: conversionError instanceof Error ? conversionError.message : 'تبدیل انجام نشد.' }); }
			setWxrMediaStatus(`${error instanceof Error ? error.message : 'نگاشت معتبر نیست.'} نگاشت اعمال نشد.`);
		} finally { if (request === wxrMapRequest.current) setWxrMapBusy(false); }
	}

	function closeWordPressImport(): void { if (wxrPostBusy || wxrBlogBulkBusy || wxrBulkBusy) return; wxrMapRequest.current++; setWxrMapBusy(false); setWxrImport(null); }
	function closeElementorImport(): void { elementorMapRequest.current++; setElementorMapBusy(false); setElementorImport(null); }
	function applyWordPress(): void {
		if (!wxrImport?.document || !window.confirm('محتوای فعلی با محتوای تبدیل‌شده جایگزین می‌شود. انتشار انجام نمی‌شود. ادامه می‌دهید؟')) return;
		try {
			const current = historyRef.current.present;
			if (!runDocumentCommand({ type: 'replace-document', document: validatePageDocument({ ...current, nodes: wxrImport.document.nodes }, slug) })) return;
			emitEditorEvent('migration.completed', { source: 'wordpress', warnings: (wxrImport.inspection.items[wxrImport.index]?.warnings.length ?? 0) + (wxrReports[wxrImport.index]?.messages.length ?? 0) });
			closeWordPressImport();
			setMessage('محتوای تبدیل‌شده وارد پیش‌نویس شد؛ نتیجه را بررسی و وضعیت ذخیره را کنترل کنید. انتشار انجام نشده است.');
		} catch (error) { setMessage(error instanceof Error ? error.message : 'ورود انجام نشد.'); }
	}

	function applyElementor(): void {
		if (!elementorImport) return;
		if (!window.confirm('محتوای صفحه با محتوای تبدیل‌شده جایگزین می‌شود. انتشار انجام نمی‌شود. ادامه می‌دهید؟')) return;
		try {
			const current = historyRef.current.present;
			if (!runDocumentCommand({ type: 'replace-document', document: validatePageDocument({ ...current, nodes: elementorImport.document.nodes }, slug) })) return;
			emitEditorEvent('migration.completed', { source: 'elementor', warnings: elementorImport.warnings.length });
			closeElementorImport();
			setMessage('محتوا وارد پیش‌نویس شد؛ تغییرات قابل واگرد هستند و انتشار انجام نشده است.');
		} catch (error) { setMessage(error instanceof Error ? error.message : 'ورود انجام نشد.'); }
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
			if (type === 'GlobalCode') { parentId = null; index = current.nodes.length; }
			const id = createNodeId();
			runDocumentCommand({ type: 'insert', component: type, parentId, index, id, props: initialProps });
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'افزودن مؤلفه انجام نشد.');
		}
	}

	function updateField(node: BuilderNode, field: InspectorField, rawValue: unknown, historyKey?: string): void {
		try {
			if (field.key.startsWith('styles.')) {
				const key = field.key.slice('styles.'.length) as keyof NodeStyles;
				const patch = { [key]: rawValue === '' ? undefined : rawValue } as Partial<NodeStyles>;
				runDocumentCommand({ type: 'styles', id: node.id, patch, breakpoint: viewport }, field.kind === 'number' && !field.options ? `style:${node.id}:${viewport}:${field.key}` : undefined);
				return;
			}
			if (field.kind === 'rich-text' && (node.type === 'Text' || node.type === 'Heading' || node.type === 'Blockquote')) {
				const value = rawValue as RichTextFieldValue;
				runDocumentCommand({ type: 'props', id: node.id, patch: { text: value.text, marks: value.marks } }, historyKey ? `field:${node.id}:${field.key}:${historyKey}` : undefined);
				return;
			}
			if (field.key.startsWith('plugin.') && node.type === 'PluginBlock') {
				const key = field.key.slice('plugin.'.length);
				const fields = node.props.fields.map((item) => item.key === key ? { ...item, value: rawValue } : item);
				runDocumentCommand({ type: 'props', id: node.id, patch: { fields } }, `field:${node.id}:${field.key}`);
				return;
			}
			if (field.key.startsWith('binding.') && node.type === 'ProductGrid') {
				const key = field.key.slice('binding.'.length) as keyof ProductGridBinding;
				const binding: Record<string, unknown> = { ...node.props.binding, [key]: rawValue };
				if (key === 'selection' && rawValue !== 'category') delete binding.category;
				runDocumentCommand({ type: 'props', id: node.id, patch: { binding } }, field.kind === 'text' || field.kind === 'number' ? `field:${node.id}:${field.key}` : undefined);
				return;
			}
			runDocumentCommand({ type: 'props', id: node.id, patch: { [field.key]: rawValue } }, historyKey ? `field:${node.id}:${field.key}:${historyKey}` : ['text', 'textarea', 'number'].includes(field.kind) ? `field:${node.id}:${field.key}` : undefined);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'مقدار واردشده معتبر نیست.');
		}
	}

	function updateInlineText(id: string, value: string): void {
		try {
			runDocumentCommand({ type: 'props', id, patch: { text: value } });
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'ویرایش متن ذخیره نشد.');
		}
	}

	function updatePageDescription(value: string): void {
		try {
			runDocumentCommand({ type: 'metadata', patch: { description: value } }, 'page:description');
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'توضیحات صفحه معتبر نیست.');
		}
	}

	function duplicateSelected(): void {
		if (!selectedId) return;
		try {
			runDocumentCommand({ type: 'duplicate', id: selectedId });
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'رونوشت‌برداری انجام نشد.');
		}
	}

	function removeSelected(): void {
		if (!selectedId) return;
		if (!window.confirm('این مؤلفه و فرزندانش حذف شوند؟')) return;
		try {
			runDocumentCommand({ type: 'delete', id: selectedId });
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'حذف مؤلفه انجام نشد.');
		}
	}

	function moveSelected(direction: -1 | 1): void {
		if (!selectedId) return;
		try {
			runDocumentCommand({ type: 'reorder', id: selectedId, direction });
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
			if (!result.media) throw new Error('پاسخ کتابخانهٔ رسانه معتبر نیست.');
			setMediaItems(result.media);
		} catch (error) {
			setMediaError(error instanceof Error ? error.message : 'خواندن کتابخانهٔ رسانه ممکن نشد.');
		} finally {
			setMediaLoading(false);
		}
	}

	function openMediaPicker(node: BuilderNode, itemId?: string): void {
		if (node.type !== 'Image' && (node.type !== 'ImageGallery' || !itemId)) return;
		mediaTargetRef.current = { nodeId: node.id, ...(itemId ? { itemId } : {}) };
		setMediaPickerOpen(true);
		void loadMediaForPicker();
	}

	function selectMedia(item: MediaPickerItem): void {
		const destination = mediaTargetRef.current;
		const target = destination ? findNode(historyRef.current.present.nodes, destination.nodeId) : null;
		if (!target || !destination) {
			setMediaError('مؤلفهٔ تصویر انتخاب‌شده دیگر در صفحه نیست.');
			return;
		}
		let patch: Record<string, unknown>;
		if (target.type === 'Image' && !destination.itemId) patch = { src: item.assetRef };
		else if (target.type === 'ImageGallery' && destination.itemId && target.props.items.some((entry) => entry.id === destination.itemId)) {
			patch = { items: target.props.items.map((entry) => entry.id === destination.itemId ? { ...entry, src: item.assetRef } : entry) };
		} else {
			setMediaError('مورد تصویر انتخاب‌شده دیگر در صفحه نیست.');
			return;
		}
		if (!runDocumentCommand({ type: 'props', id: target.id, patch })) {
			setMediaError('انتخاب تصویر معتبر نیست؛ سند تغییر نکرد.');
			return;
		}
		selectNode(target.id);
		setMediaPickerOpen(false);
		setMediaError('');
		setMessage(item.reused ? `فایل یکسان موجود «${item.name}» دوباره استفاده و به سند پیوند شد؛ فایل تازه‌ای ساخته نشد.` : `تصویر «${item.name}» به سند پیوند شد.`);
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
			if (mediaDeduplicate) body.append('deduplicate', '1');
			const response = await fetch('/cms/api/media/upload', {
				method: 'POST',
				headers: { accept: 'application/json' },
				body,
			});
			const result = await readResponse(response);
			const item = result.files?.[0];
			if (!response.ok || !item?.assetRef) throw new Error(result.message || 'بارگذاری تصویر انجام نشد.');
			setMediaItems((current) => [item, ...current.filter((candidate) => candidate.assetRef !== item.assetRef)]);
			selectMedia(item);
		} catch (error) {
			setMediaError(error instanceof Error ? error.message : 'بارگذاری تصویر انجام نشد.');
		} finally {
			setMediaUploading(false);
		}
	}

	function startPaletteDrag(event: DragEvent<HTMLElement>, component: BuilderComponentType | 'Container:grid'): void {
		event.dataTransfer.effectAllowed = 'copy';
		event.dataTransfer.setData('text/novex-builder-component', component);
	}

	function handleDragOver(event: DragEvent<HTMLElement>, target: BuilderNode | null): void {
		const types = Array.from(event.dataTransfer.types);
		if (!types.includes('text/novex-builder-node') && !types.includes('text/novex-builder-component')) return;
		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = types.includes('text/novex-builder-component') ? 'copy' : 'move';
		const rect = event.currentTarget.getBoundingClientRect();
		setDragOverId(target?.id ?? '__page__');
		setDragPlacement(target ? dropPlacement(target, rect.top, rect.height, event.clientY) : 'after');
	}

	function handleDrop(event: DragEvent<HTMLElement>, target: BuilderNode | null): void {
		const types = Array.from(event.dataTransfer.types);
		if (!types.includes('text/novex-builder-node') && !types.includes('text/novex-builder-component')) return;
		event.preventDefault();
		event.stopPropagation();
		setDragOverId(null);
		try {
			const current = historyRef.current.present;
			const actualTarget = target ? findNode(current.nodes, target.id) : null;
			if (target && !actualTarget) throw new Error('مقصد رها کردن دیگر در صفحه وجود ندارد.');
			const rect = event.currentTarget.getBoundingClientRect();
			const placement = actualTarget ? dropPlacement(actualTarget, rect.top, rect.height, event.clientY) : 'after';
			const component = event.dataTransfer.getData('text/novex-builder-component');
			if (component) {
				const isGrid = component === 'Container:grid';
				const type = isGrid ? 'Container' : component;
				if (!isBuilderComponentType(type) || (type === 'GlobalCode' && !canPublishCode)) throw new Error('این مؤلفه برای افزودن مجاز نیست.');
				const location = dropInsertionPoint(current, actualTarget?.id ?? null, placement);
				runDocumentCommand({ type: 'insert', component: type, ...location, id: createNodeId(), ...(isGrid ? { props: { layout: 'grid', background: 'soft' } } : {}) });
				return;
			}
			const sourceId = event.dataTransfer.getData('text/novex-builder-node');
			if (!sourceId || sourceId === actualTarget?.id) return;
			if (actualTarget) runDocumentCommand({ type: 'move', id: sourceId, targetId: actualTarget.id, placement });
			else runDocumentCommand({ type: 'move-root', id: sourceId });
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'افزودن یا جابه‌جایی مؤلفه انجام نشد.');
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
			if (!runDocumentCommand({ type: 'replace-document', document: restored })) return;
			setMessage(`محتوای نسخهٔ ${revisionNumber} بارگیری شد؛ برای ثبت آن در تاریخچه، ذخیره را انجام دهید.`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'بازیابی نسخه انجام نشد.');
		}
	}

	function closeTemplatePreview(): void {
		templateActionAbort.current?.abort();
		templateActionAbort.current = null;
		setTemplateActionBusy(false);
		setTemplateError('');
		setTemplatePreview(null);
	}

	function closeTemplateLibrary(): void {
		templateActive.current = false;
		templateGeneration.current += 1;
		templateListAbort.current?.abort();
		templateActionAbort.current?.abort();
		templateListAbort.current = null;
		templateActionAbort.current = null;
		setTemplateActionBusy(false);
		setTemplatePreview(null);
		setTemplateDialogOpen(false);
	}

	async function openTemplateLibrary(options: { target?: SectionInsertionTarget; sectionId?: string } = {}): Promise<void> {
		templateListAbort.current?.abort();
		templateActionAbort.current?.abort();
		templateActionAbort.current = null;
		setTemplateActionBusy(false);
		templateActive.current = true;
		const generation = ++templateGeneration.current;
		const controller = new AbortController();
		templateListAbort.current = controller;
		const starters = listStarterTemplateSummaries().map((template) => ({
			id: template.id,
			name: template.label,
			description: template.description,
			source: 'starter' as const,
			kind: template.kind,
			...('image' in template && typeof template.image === 'string' ? { image: template.image } : {}),
			...('category' in template && typeof template.category === 'string' ? { category: template.category } : {}),
		})).sort((a, b) => {
			const priority = (item: { kind: 'page' | 'section'; image?: string; category?: string }) => item.kind === 'page' && item.image ? 4 : item.kind === 'section' && item.category ? 3 : item.kind === 'page' ? 2 : item.image ? 1 : 0;
			return priority(b) - priority(a);
		});
		const currentNodes = historyRef.current.present.nodes;
		const selectedRoot = selectedId ? findNodePath(currentNodes, selectedId)?.[0] : undefined;
		const anchor = selectedRoot ?? currentNodes.at(-1);
		setSectionInsertion(options.target ?? (anchor ? { targetId: anchor.id, placement: 'after' } : { targetId: null }));
		const requested = options.sectionId ? starters.find((item) => item.id === options.sectionId && item.kind === 'section') : undefined;
		setTemplateItems(starters);
		setTemplateQuery(requested?.name ?? '');
		setTemplateFilter(options.target || requested ? 'section' : 'all');
		setTemplateError(options.sectionId && !requested ? 'بخش انتخاب‌شده پیدا نشد.' : '');
		setTemplateDialogOpen(true);
		setTemplateLoading(true);
		void loadSharedSections(generation, controller.signal);
		try {
			const response = await fetch('/cms/api/builder/templates', { headers: { accept: 'application/json' }, signal: controller.signal });
			const result = await readResponse(response);
			if (!templateActive.current || generation !== templateGeneration.current || controller.signal.aborted) return;
			if (!response.ok) throw new Error(result.message || 'خواندن قالب‌ها ممکن نشد.');
			if (!result.templates) throw new Error('پاسخ قالب‌ها معتبر نیست.');
			const saved = result.templates.filter((item) => item.source === 'saved');
			setTemplateItems([...starters, ...saved]);
		} catch (error) {
			if (templateActive.current && generation === templateGeneration.current && !controller.signal.aborted) setTemplateError(error instanceof Error ? error.message : 'خواندن قالب‌ها ممکن نشد.');
		} finally {
			if (templateListAbort.current === controller) { templateListAbort.current = null; setTemplateLoading(false); }
		}
	}

	async function loadSharedSections(generation?: number, signal?: AbortSignal): Promise<void> {
		const current = () => generation === undefined || (templateActive.current && generation === templateGeneration.current && !signal?.aborted);
		try {
			const response = await fetch('/cms/api/builder/sections', { headers: { accept: 'application/json' }, signal });
			const result = await readResponse(response);
			if (!current()) return;
			if (!response.ok) throw new Error(result.message || 'خواندن بخش‌های مشترک ممکن نشد.');
			if (!result.sections) throw new Error('پاسخ بخش‌های مشترک معتبر نیست.');
			setSharedSections(result.sections);
		} catch (error) {
			if (current()) (generation === undefined ? setMessage : setTemplateError)(error instanceof Error ? error.message : 'خواندن بخش‌های مشترک ممکن نشد.');
		}
	}

	/** Only attach a server baseline if the local node did not change during the request. */
	function attachSharedReference(id: string, captured: string, fragment: unknown): boolean {
		const current = findNode(historyRef.current.present.nodes, id);
		const source = validatePageDocument(fragment).nodes[0];
		if (!current || current.type !== 'Container' || JSON.stringify({ node: current, breakpoints: historyRef.current.present.breakpoints }) !== captured || source?.type !== 'Container' || !source.sharedSection) return false;
		return runDocumentCommand({ type: 'replace', id, node: { ...current, sharedSection: source.sharedSection } });
	}

	async function createShared(): Promise<void> {
		const node = sharedCreateTarget ? findNode(historyRef.current.present.nodes, sharedCreateTarget) : null;
		if (!node || node.type !== 'Container' || node.sharedSection || !sharedName.trim() || sharedBusy) return;
		const captured = JSON.stringify({ node, breakpoints: historyRef.current.present.breakpoints });
		setSharedBusy(true);
		try {
			const response = await fetch('/cms/api/builder/sections', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ name: sharedName.trim(), node, breakpoints: historyRef.current.present.breakpoints }) });
			const result = await readResponse(response);
			if (!response.ok || !result.section?.fragment) throw new Error(result.message || 'ساخت بخش مشترک انجام نشد.');
			const attached = attachSharedReference(node.id, captured, result.section.fragment);
			setSharedCreateTarget(null);
			setMessage(attached ? 'بخش مشترک ساخته و به این نسخه پیوند شد؛ تغییرات را ذخیره کنید.' : 'منبع مشترک ساخته شد، اما بخش محلی هنگام درخواست تغییر کرد و پیوند نشد؛ از کتابخانه درج کنید.');
			void loadSharedSections();
		} catch (error) { setMessage(error instanceof Error ? error.message : 'ساخت بخش مشترک انجام نشد.'); }
		finally { setSharedBusy(false); }
	}

	async function updateSharedSource(node: ContainerNode): Promise<void> {
		const reference = node.sharedSection;
		if (!reference || sharedBusy || !window.confirm('منبع مشترک از این نسخه به‌روز می‌شود؛ سایر صفحه‌ها تا همگام‌سازی صریح تغییر نمی‌کنند. ادامه می‌دهید؟')) return;
		const captured = JSON.stringify({ node, breakpoints: historyRef.current.present.breakpoints });
		setSharedBusy(true);
		try {
			const response = await fetch(`/cms/api/builder/sections/${encodeURIComponent(reference.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ expectedRevision: reference.revision, node, breakpoints: historyRef.current.present.breakpoints }) });
			const result = await readResponse(response);
			if (!response.ok || !result.section?.fragment) throw new Error(result.message || 'به‌روزرسانی منبع انجام نشد.');
			const attached = attachSharedReference(node.id, captured, result.section.fragment);
			setMessage(attached ? 'منبع مشترک به‌روز شد؛ نسخهٔ محلی را ذخیره و برای صفحه‌های دیگر همگام‌سازی کنید.' : 'منبع به‌روز شد، اما نسخهٔ محلی هنگام درخواست تغییر کرد؛ برای جلوگیری از بازنویسی، پیوند تازه اعمال نشد.');
			void loadSharedSections();
		} catch (error) { setMessage(error instanceof Error ? error.message : 'به‌روزرسانی منبع انجام نشد.'); }
		finally { setSharedBusy(false); }
	}

	async function insertShared(section: SharedSectionSummary): Promise<void> {
		const request = beginTemplateRequest();
		if (!request) return;
		const target = sectionInsertion;
		try {
			const response = await fetch(`/cms/api/builder/sections/${encodeURIComponent(section.id)}`, { headers: { accept: 'application/json' }, signal: request.controller.signal });
			const result = await readResponse(response);
			if (!isCurrentTemplateRequest(request)) return;
			if (!response.ok || !result.section?.fragment) throw new Error(result.message || 'خواندن بخش مشترک ممکن نشد.');
			const fragment = validatePageDocument(result.section.fragment);
			if (!insertAtSectionTarget(fragment, target)) return;
			closeTemplateLibrary();
			setMessage(`بخش مشترک «${section.name}» به پیش‌نویس اضافه شد؛ انتشار مستقل است.`);
		} catch (error) { if (isCurrentTemplateRequest(request)) setTemplateError(error instanceof Error ? error.message : 'افزودن بخش مشترک ممکن نشد.'); }
		finally { finishTemplateRequest(request); }
	}

	async function syncShared(section: Pick<SharedSectionSummary, 'id' | 'revision'>): Promise<void> {
		if (sharedBusy || !window.confirm('فقط نسخه‌های پیوندشده و بدون ویرایش محلی در پیش‌نویس‌های ذخیره‌شده به‌روزرسانی می‌شوند؛ نسخه‌های منتشرشده تغییر نمی‌کنند. ادامه می‌دهید؟')) return;
		setSharedBusy(true);
		try {
			await controllerRef.current?.flush();
			const before = JSON.stringify(historyRef.current.present);
			const response = await fetch(`/cms/api/builder/sections/${encodeURIComponent(section.id)}/sync`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ expectedRevision: section.revision, confirm: true }) });
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'همگام‌سازی انجام نشد.');
			if (!result.pages) throw new Error('پاسخ همگام‌سازی معتبر نیست.');
			const pages = result.pages;
			closeTemplateLibrary();
			if (pages.some((page) => page.slug === slug)) {
				if (JSON.stringify(historyRef.current.present) === before && !controllerRef.current?.isDirty()) window.location.reload();
				else setMessage('همگام‌سازی ذخیره شد، اما تغییر محلی تازه دارید؛ از سند خروجی بگیرید و نسخهٔ سرور را بررسی کنید.');
			} else setMessage(`${pages.length.toLocaleString('fa-IR')} پیش‌نویس همگام شد؛ نسخه‌های منتشرشده تغییر نکردند.`);
		} catch (error) { setMessage(error instanceof Error ? error.message : 'همگام‌سازی انجام نشد.'); }
		finally { setSharedBusy(false); }
	}

	function detachShared(node: ContainerNode): void {
		const { sharedSection: _reference, ...independent } = node;
		if (runDocumentCommand({ type: 'replace', id: node.id, node: independent })) setMessage('پیوند بخش قطع شد؛ محتوای مستقل حفظ شد.');
	}

	async function loadSiteKits(): Promise<void> {
		if (siteKitsLoaded.current || siteKitsLoading) return;
		setSiteKitsLoading(true);
		try {
			const { listSiteKits } = await import('../../lib/builder/site-kits.ts');
			setSiteKits(listSiteKits());
			siteKitsLoaded.current = true;
		} catch (error) { setKitStatus(error instanceof Error ? error.message : 'بارگیری بسته‌های آماده ممکن نشد.'); }
		finally { setSiteKitsLoading(false); }
	}

	async function installKit(id: string): Promise<void> {
		if (kitBusy || !window.confirm('صفحه‌های جدید به‌صورت پیش‌نویس ساخته می‌شوند و منتشر نمی‌شوند. ادامه می‌دهید؟')) return;
		setKitBusy(true); setKitStatus('در حال نصب…');
		try {
			const response = await fetch('/cms/api/builder/kits', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ id, prefix: kitPrefix.trim() }) });
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'نصب بسته انجام نشد.');
			setKitStatus(`پیش‌نویس‌ها ساخته شدند: ${responsePageSlugs(result)}. از صفحه‌های پنل آن‌ها را ویرایش کنید.`);
		} catch (error) { setKitStatus(error instanceof Error ? error.message : 'نصب بسته انجام نشد.'); }
		finally { setKitBusy(false); }
	}

	async function updateKit(id: string): Promise<void> {
		if (!kitPrefix.trim() || kitBusy) return;
		await startKitReview({ kind: 'builtin', id, prefix: kitPrefix.trim() });
	}

	function setKitSourceStatus(source: KitReviewSource, message: string): void {
		if (source.kind === 'builtin') setKitStatus(message);
		else if (source.kind === 'package') setPackageStatus(message);
		else setArchiveStatus(message);
	}

	async function startKitReview(source: KitReviewSource): Promise<void> {
		if (kitBusy) return;
		setKitBusy(true); setKitSourceStatus(source, 'در حال بررسی ادغام؛ محتوایی تغییر نمی‌کند…');
		try {
			let response: Response;
			if (source.kind === 'archive') {
				const form = new FormData(); form.set('action', 'review'); form.set('prefix', source.prefix); form.set('archive', source.file);
				response = await fetch('/cms/api/builder/kits/archive', { method: 'POST', headers: { accept: 'application/json' }, body: form });
			} else {
				const body = source.kind === 'builtin' ? { action: 'review', id: source.id, prefix: source.prefix } : { action: 'review', kit: source.kit, prefix: source.prefix };
				response = await fetch(source.kind === 'builtin' ? '/cms/api/builder/kits/update' : '/cms/api/builder/kits/package', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
			}
			const result = await readResponse(response);
			if (!response.ok || result.ok !== true || !result.kitReview) throw new Error(result.message || 'بررسی ادغام ممکن نشد.');
			setKitReview({ source, review: result.kitReview, choices: result.kitReview.fields.map(() => null), error: '' });
			setKitSourceStatus(source, 'بررسی آماده است؛ هنوز چیزی تغییر نکرده است.');
		} catch (error) { setKitSourceStatus(source, error instanceof Error ? error.message : 'بررسی ادغام ممکن نشد.'); }
		finally { setKitBusy(false); }
	}

	async function submitKitReview(): Promise<void> {
		if (!kitReview || kitBusy || kitReview.review.truncated || kitReview.review.unresolved.length || kitReview.choices.some((choice) => !choice)) return;
		const { source, review, choices } = kitReview;
		if (source.kind === 'archive' && source.assetCount && !canUploadMedia) { setKitReview((current) => current ? { ...current, error: 'نقش شما اجازهٔ بارگذاری رسانهٔ بسته را ندارد.' } : current); return; }
		if (!window.confirm('انتخاب‌ها اعمال می‌شوند و همهٔ صفحه‌های بسته به‌صورت اتمی فقط در پیش‌نویس تغییر می‌کنند. نسخه‌های منتشرشده ثابت می‌مانند. ادامه می‌دهید؟')) return;
		const decision = { token: review.token, choices: review.fields.map(({ slug, path }, index) => ({ slug, path, choice: choices[index] })) };
		setKitBusy(true); setKitReview((current) => current ? { ...current, error: '' } : current);
		try {
			let response: Response;
			if (source.kind === 'archive') {
				const form = new FormData(); form.set('action', 'update'); form.set('prefix', source.prefix); form.set('archive', source.file); form.set('confirm', 'true'); form.set('decision', JSON.stringify(decision));
				response = await fetch('/cms/api/builder/kits/archive', { method: 'POST', headers: { accept: 'application/json' }, body: form });
			} else {
				const body = source.kind === 'builtin' ? { id: source.id, prefix: source.prefix, confirmUpdate: true, decision } : { action: 'update', kit: source.kit, prefix: source.prefix, confirm: true, decision };
				response = await fetch(source.kind === 'builtin' ? '/cms/api/builder/kits/update' : '/cms/api/builder/kits/package', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
			}
			const result = await readResponse(response);
			if (!response.ok || result.ok !== true) throw new Error(result.message || 'به‌روزرسانی بسته انجام نشد.');
			setKitSourceStatus(source, `پیش‌نویس‌ها آماده شدند: ${responsePageSlugs(result)}. انتشار تغییر نکرد.`);
			setKitReview(null);
		} catch (error) { setKitReview((current) => current ? { ...current, error: error instanceof Error ? error.message : 'به‌روزرسانی بسته انجام نشد.' } : current); }
		finally { setKitBusy(false); }
	}

	async function inspectKitPackage(file: File): Promise<void> {
		setPackageKit(null); setPackageStatus('');
		try {
			if (file.size > 2_900_000) throw new Error('حجم بسته نباید بیش از ۲٫۹ مگابایت باشد.');
			const { validateSiteKit } = await import('../../lib/builder/site-kits.ts');
			const kit = validateSiteKit(JSON.parse(await file.text()));
			setPackageKit(kit);
			setPackageStatus('بسته برای بررسی آماده است؛ فایل‌های رسانه باید از قبل در کتابخانه موجود باشند.');
		} catch (error) { setPackageStatus(error instanceof Error ? error.message : 'بستهٔ JSON معتبر نیست.'); }
	}

	async function applyKitPackage(action: 'install' | 'update'): Promise<void> {
		if (!packageKit || !packagePrefix.trim() || kitBusy) return;
		if (action === 'update') { await startKitReview({ kind: 'package', kit: packageKit, prefix: packagePrefix.trim() }); return; }
		const description = 'صفحه‌های تازه فقط به‌صورت پیش‌نویس ساخته می‌شوند.';
		if (!window.confirm(`${description} هیچ کدی اجرا یا فایلی از شبکه دریافت نمی‌شود. ادامه می‌دهید؟`)) return;
		setKitBusy(true); setPackageStatus('در حال بررسی و ذخیره…');
		try {
			const response = await fetch('/cms/api/builder/kits/package', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ action, confirm: true, prefix: packagePrefix.trim(), kit: packageKit }) });
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'عملیات بسته انجام نشد.');
			setPackageStatus(`پیش‌نویس‌ها آماده شدند: ${responsePageSlugs(result)}. انتشار تغییر نکرد.`);
		} catch (error) { setPackageStatus(error instanceof Error ? error.message : 'عملیات بسته انجام نشد.'); }
		finally { setKitBusy(false); }
	}

	async function inspectKitArchive(file: File): Promise<void> {
		if (kitBusy) return;
		setArchiveKit(null); setArchiveStatus('در حال بررسی بسته…'); setKitBusy(true);
		try {
			if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('حجم بسته باید حداکثر ۱۲ مگابایت باشد.');
			const form = new FormData(); form.set('action', 'inspect'); form.set('archive', file);
			const response = await fetch('/cms/api/builder/kits/archive', { method: 'POST', headers: { accept: 'application/json' }, body: form });
			const result = await readResponse(response);
			if (!response.ok || !result.archiveKit) throw new Error(result.message || 'بستهٔ ZIP معتبر نیست.');
			setArchiveKit({ file, summary: result.archiveKit });
			setArchiveStatus('بسته بدون نوشتن فایل بررسی شد. برای ساخت پیش‌نویس و رسانه تأیید کنید.');
		} catch (error) { setArchiveStatus(error instanceof Error ? error.message : 'بررسی بسته ممکن نشد.'); }
		finally { setKitBusy(false); }
	}

	async function applyKitArchive(action: 'install' | 'update'): Promise<void> {
		if (!archiveKit || !archivePrefix.trim() || kitBusy) return;
		if (action === 'update') { await startKitReview({ kind: 'archive', file: archiveKit.file, prefix: archivePrefix.trim(), assetCount: archiveKit.summary.assetCount }); return; }
		if (archiveKit.summary.assetCount && !canUploadMedia) { setArchiveStatus('نقش شما اجازهٔ بارگذاری رسانهٔ بسته را ندارد.'); return; }
		if (!window.confirm('تصاویر معتبر بسته در کتابخانه ذخیره می‌شوند و صفحه‌ها فقط به‌صورت پیش‌نویس ساخته یا ادغام می‌شوند. هیچ کدی اجرا نمی‌شود. ادامه می‌دهید؟')) return;
		setKitBusy(true); setArchiveStatus('در حال بررسی و ذخیره…');
		try {
			const form = new FormData(); form.set('action', action); form.set('archive', archiveKit.file); form.set('prefix', archivePrefix.trim()); form.set('confirm', 'true');
			const response = await fetch('/cms/api/builder/kits/archive', { method: 'POST', headers: { accept: 'application/json' }, body: form });
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'عملیات بسته انجام نشد.');
			setArchiveStatus(`پیش‌نویس‌ها آماده شدند: ${responsePageSlugs(result)}. انتشار تغییر نکرد.`);
		} catch (error) { setArchiveStatus(error instanceof Error ? error.message : 'عملیات بسته انجام نشد.'); }
		finally { setKitBusy(false); }
	}

	async function createWordPressBlogDraft(): Promise<void> {
		if (!canWritePosts || !wxrPostPreview?.draft || wxrPostBusy || wxrBlogBulkBusy || wxrMapBusy || wxrPostId || wxrPostUncertain) return;
		if (!window.confirm('یک نوشتهٔ مستقل فقط به‌صورت پیش‌نویس ساخته می‌شود؛ تصاویر نگاشت‌شده به رسانهٔ محلی پیوند دارند و تصاویر دیگر جای‌نگهدار هستند. انتشار خودکار انجام نمی‌شود. ادامه می‌دهید؟')) return;
		setWxrPostBusy(true); setWxrPostStatus('در حال ساخت نوشتهٔ پیش‌نویس…');
		let responseReceived = false;
		try {
			const { warnings: _warnings, ...draft } = wxrPostPreview.draft;
			const response = await fetch('/cms/api/posts', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...draft, slug: wxrPostSlug.trim() }) });
			responseReceived = true;
			let result: BuilderApiResponse;
			try { result = await readResponse(response); } catch (error) { if (response.ok) setWxrPostUncertain(true); throw error; }
			if (!response.ok) throw new Error(result.message || 'ساخت نوشته ممکن نشد.');
			if (result.ok !== true || !result.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(result.id)) { setWxrPostUncertain(true); throw new Error('پاسخ ساخت معتبر نیست؛ پیش از تلاش دوباره فهرست نوشته‌ها را بررسی کنید.'); }
			setWxrPostId(result.id); setWxrPostStatus('نوشتهٔ پیش‌نویس ساخته شد؛ منتشر نشده است.');
		} catch (error) {
			if (!responseReceived) { setWxrPostUncertain(true); setWxrPostStatus('پاسخ دریافت نشد؛ پیش از تلاش دوباره فهرست نوشته‌ها را بررسی کنید.'); }
			else setWxrPostStatus(error instanceof Error ? error.message : 'ساخت نوشته ممکن نشد؛ فهرست نوشته‌ها را بررسی کنید.');
		}
		finally { setWxrPostBusy(false); }
	}

	async function installWordPressBlogDrafts(): Promise<void> {
		if (!wxrImport || !canWritePosts || wxrPostBusy || wxrBlogBulkBusy || wxrBulkBusy || wxrMapBusy || wxrBlogBulkIds.length || wxrBlogBulkUncertain) return;
		const tools = migrationToolsRef.current;
		if (!tools) { setWxrBlogBulkStatus('ابزار تبدیل بارگیری نشده است.'); return; }
		const prefix = wxrBulkPrefix.trim();
		let drafts;
		try { drafts = tools.wxrToBlogDrafts(wxrImport.inspection, prefix, wxrImport.mediaMap); }
		catch (error) { setWxrBlogBulkStatus(error instanceof Error ? error.message : 'تبدیل نوشته‌ها ممکن نشد.'); return; }
		if (!window.confirm(`${drafts.length.toLocaleString('fa-IR')} نوشتهٔ مستقل با نامک عددی فقط به‌صورت پیش‌نویس ساخته می‌شوند. صفحه‌های وردپرس در این مسیر وارد نمی‌شوند. ادامه می‌دهید؟`)) return;
		setWxrBlogBulkBusy(true); setWxrBlogBulkStatus('در حال ساخت نوشته‌های پیش‌نویس…');
		let responseReceived = false;
		try {
			const response = await fetch('/cms/api/builder/imports/wordpress-posts', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ xml: wxrImport.xml, prefix, mediaMap: Object.fromEntries(wxrImport.mediaMap ?? []), confirmCreate: true }) });
			responseReceived = true;
			if (response.status >= 500) setWxrBlogBulkUncertain(true);
			let result: BuilderApiResponse;
			try { result = await readResponse(response); } catch (error) { if (response.ok) setWxrBlogBulkUncertain(true); throw error; }
			if (!response.ok) throw new Error(result.message || 'ساخت گروهی نوشته‌ها ممکن نشد.');
			if (result.ok !== true || !result.posts || result.posts.length !== drafts.length || result.posts.some((post, index) => post.id !== `${prefix}-${index + 1}.md`)) { setWxrBlogBulkUncertain(true); throw new Error('پاسخ ورود معتبر نیست؛ پیش از تلاش دوباره فهرست نوشته‌ها را بررسی کنید.'); }
			setWxrBlogBulkIds(result.posts.map((post) => post.id)); setWxrBlogBulkStatus('نوشته‌های پیش‌نویس ساخته شدند؛ هیچ نوشته‌ای منتشر نشد.');
		} catch (error) {
			if (!responseReceived) { setWxrBlogBulkUncertain(true); setWxrBlogBulkStatus('پاسخ دریافت نشد؛ پیش از تلاش دوباره فهرست نوشته‌ها را بررسی کنید.'); }
			else setWxrBlogBulkStatus(error instanceof Error ? error.message : 'ساخت گروهی نوشته‌ها ممکن نشد.');
		} finally { setWxrBlogBulkBusy(false); }
	}

	async function installWordPressDrafts(): Promise<void> {
		if (!wxrImport || wxrBulkBusy || wxrBlogBulkBusy || wxrPostBusy || wxrMapBusy) return;
		const tools = migrationToolsRef.current;
		if (!tools) { setWxrBulkStatus('ابزار تبدیل بارگیری نشده است.'); return; }
		let documents: PageDocument[];
		try { documents = tools.wxrToDraftPages(wxrImport.inspection, wxrBulkPrefix.trim(), wxrImport.preferElementor, wxrImport.mediaMap); }
		catch (error) { setWxrBulkStatus(error instanceof Error ? error.message : 'آماده‌سازی صفحه‌ها ممکن نشد.'); return; }
		if (!window.confirm(`${documents.length.toLocaleString('fa-IR')} صفحه و نوشتهٔ فایل به صفحه‌های جدید پیش‌نویس تبدیل می‌شوند. در صورت تداخل نامک هیچ صفحه‌ای ساخته نمی‌شود و هیچ صفحه‌ای منتشر نمی‌شود. ادامه می‌دهید؟`)) return;
		setWxrBulkBusy(true); setWxrBulkStatus('در حال ساخت پیش‌نویس‌ها…');
		try {
			const response = await fetch('/cms/api/builder/imports/wordpress', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ confirmCreate: true, documents }) });
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'ساخت پیش‌نویس‌ها ممکن نشد.');
			setWxrBulkStatus(`پیش‌نویس‌ها ساخته شدند: ${responsePageSlugs(result)}. هیچ صفحه‌ای منتشر نشد.`);
		} catch (error) { setWxrBulkStatus(error instanceof Error ? error.message : 'ساخت پیش‌نویس‌ها ممکن نشد.'); }
		finally { setWxrBulkBusy(false); }
	}

	function insertPluginComponent(component: PluginBlockProps): void {
		try {
			const node = { ...createBuilderNode('PluginBlock'), props: component };
			const fragment = validatePageDocument({ ...createEmptyPageDocument('plugin-component'), nodes: [node] });
			if (!runDocumentCommand({ type: 'insert-fragment', fragment, targetId: selectedId })) return;
			setMessage('مؤلفهٔ افزونه اضافه شد؛ فیلدهای آن در بازرس قابل ویرایش هستند.');
		} catch (error) { setMessage(error instanceof Error ? error.message : 'افزودن مؤلفهٔ افزونه ممکن نشد.'); }
	}

	function insertPluginPreset(preset: BuilderPluginPreset, values: Record<string, string>): void {
		try {
			const fragment = materializeBuilderPreset(preset, values);
			if (!runDocumentCommand({ type: 'insert-fragment', fragment, targetId: selectedId })) return;
			setPresetDialog(null);
			setMessage(`«${preset.label}» به‌صورت مؤلفه‌های بومی و قابل ویرایش اضافه شد.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'افزودن پیش‌تنظیم انجام نشد.';
			if (preset.parameters?.length) setPresetDialog((current) => current ? { ...current, error: message } : current);
			else setMessage(message);
		}
	}

	function closeProcessorDialog(): void {
		processorAbort.current?.abort(); processorAbort.current = null;
		setProcessorBusy(false); setProcessorDialog(null);
	}
	function choosePluginProcessor(processor: WasmProcessorSummary): void {
		setProcessorDialog({ processor, values: Object.fromEntries(processor.inputs.map((input) => [input.key, String(input.defaultValue)])), error: '' });
	}
	async function insertPluginProcessor(): Promise<void> {
		if (!processorDialog || processorBusy) return;
		const { processor, values } = processorDialog;
		const inputs: Record<string, number> = {};
		for (const field of processor.inputs) {
			const text = values[field.key] ?? '';
			const value = Number(text);
			if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(value) || value < field.min || value > field.max) { setProcessorDialog((current) => current ? { ...current, error: 'مقدار عددی خارج از محدوده است.' } : current); return; }
			inputs[field.key] = value;
		}
		const controller = new AbortController(); processorAbort.current = controller; setProcessorBusy(true);
		try {
			const response = await fetch('/cms/api/builder/plugin-processors', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, signal: controller.signal, body: JSON.stringify({ packageId: processor.packageId, processorId: processor.id, expectedRevision: processor.revision, inputs, confirm: true }) });
			const result = await readResponse(response);
			if (controller.signal.aborted) return;
			if (!response.ok) throw new Error(result.message || 'اجرای پردازشگر ممکن نشد.');
			if (result.ok !== true || !result.document) throw new Error('پاسخ پردازشگر معتبر نیست؛ چیزی درج نشد.');
			const fragment = validatePageDocument(result.document);
			if (!runDocumentCommand({ type: 'insert-fragment', fragment, targetId: selectedId })) return;
			closeProcessorDialog(); setMessage('نتیجهٔ پردازشگر به‌صورت مؤلفهٔ بومی قابل ویرایش درج شد.');
		} catch (error) {
			if (!controller.signal.aborted) setProcessorDialog((current) => current ? { ...current, error: error instanceof Error ? error.message : 'اجرای پردازشگر ممکن نشد.' } : current);
		} finally { if (processorAbort.current === controller) { processorAbort.current = null; setProcessorBusy(false); } }
	}

	function choosePluginPreset(preset: BuilderPluginPreset): void {
		if (!preset.parameters?.length) { insertPluginPreset(preset, {}); return; }
		setPresetDialog({ preset, values: Object.fromEntries(preset.parameters.map((field) => [field.key, field.defaultValue])), error: '' });
	}

	type TemplateRequest = { controller: AbortController; generation: number };
	function beginTemplateRequest(): TemplateRequest | null {
		if (!templateActive.current || templateActionAbort.current) return null;
		const controller = new AbortController();
		templateActionAbort.current = controller;
		setTemplateActionBusy(true);
		setTemplateError('');
		return { controller, generation: templateGeneration.current };
	}
	function isCurrentTemplateRequest(request: TemplateRequest): boolean {
		return templateActive.current && !request.controller.signal.aborted && request.generation === templateGeneration.current && templateActionAbort.current === request.controller;
	}
	function finishTemplateRequest(request: TemplateRequest): void {
		if (templateActionAbort.current === request.controller) { templateActionAbort.current = null; setTemplateActionBusy(false); }
	}
	async function loadTemplateDocument(item: TemplateSummary, signal?: AbortSignal): Promise<PageDocument> {
		if (item.document) return validatePageDocument(item.document);
		const response = await fetch(`/cms/api/builder/templates/${encodeURIComponent(item.id)}`, { headers: { accept: 'application/json' }, signal });
		const result = await readResponse(response);
		if (!response.ok || !result.template?.document) throw new Error(result.message || 'قالب بارگیری نشد.');
		return validatePageDocument(result.template.document);
	}

	function insertAtSectionTarget(fragment: PageDocument, target: SectionInsertionTarget): boolean {
		const current = historyRef.current.present;
		const location = target.targetId ? findNodeLocation(current.nodes, target.targetId) : null;
		// A gap must remain a root gap. Do not silently nest into a moved target
		// or append elsewhere when the target disappeared during a request.
		if ((target.targetId && (!location || location.parentId !== null)) || (!target.targetId && current.nodes.length)) {
			setTemplateError('جای درج تغییر کرده است. کتابخانه را ببندید و محل تازه‌ای انتخاب کنید.');
			return false;
		}
		return runDocumentCommand({ type: 'insert-fragment', fragment, targetId: target.targetId, placement: target.placement }, undefined, setTemplateError);
	}

	async function previewTemplate(item: TemplateSummary): Promise<void> {
		const request = beginTemplateRequest();
		if (!request) return;
		try {
			const document = await loadTemplateDocument(item, request.controller.signal);
			if (isCurrentTemplateRequest(request)) setTemplatePreview({ name: item.name, document, item: { ...item, document } });
		} catch (error) { if (isCurrentTemplateRequest(request)) setTemplateError(error instanceof Error ? error.message : 'پیش‌نمایش قالب آماده نشد.'); }
		finally { finishTemplateRequest(request); }
	}

	async function insertTemplate(item: TemplateSummary): Promise<void> {
		const request = beginTemplateRequest();
		if (!request) return;
		const target = sectionInsertion;
		try {
			const fragment = await loadTemplateDocument(item, request.controller.signal);
			if (!isCurrentTemplateRequest(request) || !insertAtSectionTarget(fragment, target)) return;
			closeTemplateLibrary();
			emitEditorEvent('template.installed', { templateId: item.id, mode: 'copy' });
			setMessage(`رونوشت مستقل «${item.name}» اضافه شد؛ تم صفحه تغییر نکرد.`);
		} catch (error) { if (isCurrentTemplateRequest(request)) setTemplateError(error instanceof Error ? error.message : 'افزودن بخش انجام نشد.'); }
		finally { finishTemplateRequest(request); }
	}

	async function useTemplate(item: TemplateSummary): Promise<void> {
		if (item.kind === 'section' || !templateActive.current || templateActionAbort.current) return;
		const before = historyRef.current.present;
		if (before.nodes.length && !window.confirm('محتوای فعلی با قالب جایگزین می‌شود. ادامه می‌دهید؟')) return;
		const request = beginTemplateRequest();
		if (!request) return;
		try {
			const templateDocument = await loadTemplateDocument(item, request.controller.signal);
			if (!isCurrentTemplateRequest(request)) return;
			if (historyRef.current.present !== before) { setTemplateError('صفحه هنگام بارگیری تغییر کرد؛ برای جلوگیری از جایگزینی ناخواسته دوباره تلاش کنید.'); return; }
			const next = applyTemplate(templateDocument, before);
			if (!runDocumentCommand({ type: 'replace-document', document: next }, undefined, setTemplateError)) return;
			closeTemplateLibrary();
			emitEditorEvent('template.installed', { templateId: item.id, mode: 'replace' });
			setMessage(`قالب «${item.name}» روی صفحه اعمال شد.`);
		} catch (error) { if (isCurrentTemplateRequest(request)) setTemplateError(error instanceof Error ? error.message : 'اعمال قالب انجام نشد.'); }
		finally { finishTemplateRequest(request); }
	}

	async function duplicateTemplate(item: TemplateSummary): Promise<void> {
		const request = beginTemplateRequest();
		if (!request) return;
		try {
			const templateDocument = await loadTemplateDocument(item, request.controller.signal);
			if (!isCurrentTemplateRequest(request)) return;
			const name = `${item.name.slice(0, 52)} (نسخه)`;
			const response = await fetch('/cms/api/builder/templates', {
				method: 'POST', signal: request.controller.signal,
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ name, document: templateDocument }),
			});
			const result = await readResponse(response);
			if (!isCurrentTemplateRequest(request)) return;
			if (!response.ok || !result.template?.id) throw new Error(result.message || 'رونوشت قالب ذخیره نشد.');
			setTemplateItems((items) => [...items, { id: result.template!.id!, name, description: 'قالب ذخیره‌شدهٔ شما', source: 'saved' }]);
			setTemplateQuery('');
			setTemplateFilter('saved');
		} catch (error) { if (isCurrentTemplateRequest(request)) setTemplateError(error instanceof Error ? error.message : 'رونوشت قالب انجام نشد.'); }
		finally { finishTemplateRequest(request); }
	}

	async function saveAsTemplate(): Promise<void> {
		const name = templateName.trim();
		if (!name || templateSaving) return;
		setTemplateSaving(true);
		try {
			const selectedSection = selectedId ? findNode(historyRef.current.present.nodes, selectedId) : null;
			if (saveSelectedSection && !selectedSection) throw new Error('بخش انتخاب‌شده دیگر در سند نیست.');
			const templateDocument = saveSelectedSection && selectedSection ? validatePageDocument({ ...historyRef.current.present, nodes: [selectedSection] }) : historyRef.current.present;
			const response = await fetch('/cms/api/builder/templates', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ name, document: templateDocument }),
			});
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'ذخیرهٔ قالب انجام نشد.');
			setTemplateSaveOpen(false);
			setSaveSelectedSection(false);
			setTemplateName('');
			setMessage(`قالب «${name}» ذخیره شد و در کتابخانه در دسترس است.`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'ذخیرهٔ قالب انجام نشد.');
		} finally {
			setTemplateSaving(false);
		}
	}

	async function inspectPage(): Promise<void> {
		if (diagnosticsBusy) return;
		setDiagnosticsBusy(true);
		try {
			const snapshot = JSON.stringify(historyRef.current.present);
			const response = await fetch(`/cms/api/builder/pages/${encodeURIComponent(slug)}/diagnostics`, {
				method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: `{"document":${snapshot}}`,
			});
			const result = await readResponse(response);
			if (!response.ok || !result.diagnostics) throw new Error(result.message || 'بررسی صفحه ممکن نشد.');
			setDiagnosticReport({ snapshot, items: result.diagnostics });
		} catch (error) { setMessage(error instanceof Error ? error.message : 'بررسی صفحه ممکن نشد.'); }
		finally { setDiagnosticsBusy(false); }
	}

	async function publish(): Promise<void> {
		if (!canPublish || publishBusy) return;
		let executable = false;
		let hostCode = false;
		traversePageNodes(historyRef.current.present, (node) => { if (node.type === 'CodeWidget' || node.type === 'GlobalCode') executable = true; if (node.type === 'GlobalCode') hostCode = true; });
		if (hostCode && !canPublishCode) { setMessage('فقط مدیر اجازهٔ انتشار کد صفحه با دسترسی کامل را دارد.'); return; }
		const snapshot = JSON.stringify(historyRef.current.present);
		if (executable && !window.confirm(hostCode ? 'کد صفحه با دسترسی کامل در مبدأ سایت اجرا می‌شود و می‌تواند داده‌ها و محتوای صفحه را تغییر دهد. آیا کد را بررسی کرده‌اید و انتشار را تأیید می‌کنید؟' : 'این صفحه دارای کد اجرایی در قاب مرورگر است. پیش از انتشار کد را بررسی کنید. ادامه می‌دهید؟')) return;
		setPublishBusy(true);
		setMessage('');
		try {
			await saveNow();
			if (JSON.stringify(historyRef.current.present) !== snapshot) throw new Error('صفحه پس از تأیید تغییر کرده است؛ دوباره بررسی و منتشر کنید.');
			const response = await fetch(`/cms/api/builder/pages/${encodeURIComponent(slug)}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ expectedRevision: revisionRef.current, document: JSON.parse(snapshot), acknowledgeExecutableCode: executable }),
			});
			const result = await readResponse(response);
			if (!response.ok) throw new Error(result.message || 'انتشار صفحه انجام نشد.');
			if (typeof result.revision !== 'number' || typeof result.publicUrl !== 'string') throw new Error('پاسخ انتشار معتبر نیست.');
			revisionRef.current = result.revision;
			setRevision(result.revision);
			if (historyOpenRef.current) void refreshRevisionHistory();
			setIsPublished(true);
			emitEditorEvent('publish.completed', { slug, revision: result.revision });
			setMessage(`صفحه منتشر شد. نشانی عمومی: ${result.publicUrl}`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'انتشار صفحه انجام نشد.');
		} finally {
			setPublishBusy(false);
		}
	}

	return (
		<div className="builder-shell" data-theme={editorTheme} dir="rtl">
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
					<div className="builder-mode-switch" role="group" aria-label="حالت ویرایش">
						<button
							type="button"
							className={`builder-mode-btn${mode === 'simple' ? ' is-active' : ''}`}
							onClick={() => setMode('simple')}
							aria-pressed={mode === 'simple'}
						>ساده</button>
						<button
							type="button"
							className={`builder-mode-btn${mode === 'pro' ? ' is-active' : ''}`}
							onClick={() => setMode('pro')}
							aria-pressed={mode === 'pro'}
						>حرفه‌ای</button>
					</div>
					<button className="builder-icon-button builder-theme-toggle" type="button" onClick={toggleTheme} title={editorTheme === 'light' ? 'تیره کردن تم ویرایشگر' : 'روشن کردن تم ویرایشگر'} aria-label={editorTheme === 'light' ? 'تیره کردن تم ویرایشگر' : 'روشن کردن تم ویرایشگر'}>
						{editorTheme === 'light' ? '◐' : '☼'}
					</button>
					<div className={`builder-save-state builder-save-state--${status}`} role="status" aria-live="polite">
						<span className="builder-save-state__dot" />{STATUS_LABELS[status]}
					</div>
					{status === 'error' ? <button className="builder-link-button" type="button" onClick={() => void retrySave()}>تلاش دوباره</button> : null}
					{status === 'conflict' ? <button className="builder-link-button" type="button" onClick={reloadServerVersion}>بارگیری نسخهٔ تازه</button> : null}
				</div>
				<div className="builder-toolbar__actions">
					<button className="builder-icon-button" type="button" title={`واگرد (Ctrl/⌘ Z) — ${history.past.length} مرحلهٔ قبلی`} aria-label={`واگرد، ${history.past.length} مرحلهٔ قبلی در دسترس است`} data-testid="undo" disabled={!history.past.length} onClick={undo}>↶{history.past.length ? <span className="builder-history-count">{history.past.length}</span> : null}</button>
					<button className="builder-icon-button" type="button" title={`ازنو (Ctrl/⌘ Shift Z) — ${history.future.length} مرحلهٔ بعدی`} aria-label={`ازنو، ${history.future.length} مرحلهٔ بعدی در دسترس است`} data-testid="redo" disabled={!history.future.length} onClick={redo}>↷{history.future.length ? <span className="builder-history-count">{history.future.length}</span> : null}</button>
					{(
						<div className="builder-breakpoints" role="group" aria-label="اندازهٔ پیش‌نمایش">
							{ranges.map((range) => (
								<button type="button" key={range.id} data-testid={`viewport-${range.id}`} className={viewport === range.id ? 'is-active' : ''} aria-pressed={viewport === range.id} onClick={() => setViewport(range.id)}>
									<span aria-hidden="true">{range.id === 'desktop' ? '▰' : range.id === 'tablet' ? '▭' : '▯'}</span>{range.label}
								</button>
							))}
						</div>
						)}
					<button className="builder-toolbar-button" type="button" data-testid="save-page" onClick={() => void saveNow().catch(() => undefined)}>ذخیره</button>
					<button className="builder-toolbar-button" type="button" data-testid="diagnose-page" disabled={diagnosticsBusy} onClick={() => void inspectPage()}>{diagnosticsBusy ? 'در حال بررسی…' : 'بررسی صفحه'}</button>
					{canPublish ? <button className="builder-toolbar-button builder-toolbar-button--publish" type="button" data-testid="publish-page" disabled={publishBusy} onClick={() => void publish()}>{publishBusy ? 'در حال انتشار…' : 'انتشار'}</button> : null}
					{isPublished ? <a className="builder-toolbar-button builder-toolbar-button--quiet" href={`/pages/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">نمایش منتشرشده</a> : <button className="builder-toolbar-button builder-toolbar-button--quiet" type="button" disabled title="پس از انتشار در دسترس است">پس از انتشار</button>}
					<button className="builder-icon-button builder-preview-toggle" type="button" title="پیش‌نمایش صفحه" aria-label="پیش‌نمایش صفحه" onClick={() => setPreviewOpen(true)}>پیش‌نمایش</button>
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
						<div><h2>عناصر صفحه</h2><p>بکشید و رها کنید یا برای افزودن کلیک کنید.</p></div>
					</div>
					<button className="builder-template-shortcut" type="button" data-testid="open-template-library" onClick={() => void openTemplateLibrary()}>
						<span aria-hidden="true">✦</span><span><strong>شروع با طرح آماده</strong><small>صفحه‌ها و بخش‌های قابل ویرایش</small></span><span aria-hidden="true">←</span>
					</button>
					<div className="builder-library-controls">
						<label className="builder-library-search"><span className="sr-only">جست‌وجوی عناصر صفحه</span><input type="search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="جست‌وجوی عنصر یا بخش…" /></label>
						<div className="builder-library-groups" role="group" aria-label="دستهٔ عناصر">
							{([['all', 'همه'], ['layout', 'چیدمان'], ['content', 'محتوا'], ['media', 'رسانه'], ['commerce', 'فروشگاه'], ['plugins', 'افزونه‌ها']] as const).map(([group, label]) => <button key={group} type="button" aria-pressed={libraryGroup === group} onClick={() => setLibraryGroup(group)}>{label}</button>)}
						</div>
					</div>
					<div className="builder-library" aria-label="عناصر قابل افزودن">
						{paletteDefinitions.map((definition) => (
							<button className="builder-component-card" type="button" key={definition.type} data-testid={`add-component-${definition.type.toLowerCase()}`} draggable onDragStart={(event) => startPaletteDrag(event, definition.type)} onDragEnd={() => setDragOverId(null)} onClick={() => addComponent(definition.type)} title={`${definition.documentation} برای افزودن کلیک کنید یا به صفحه بکشید.`}>
								<span className="builder-component-card__icon">{componentIcon(definition.type)}</span>
								<span><strong>{definition.label}</strong><small>{definition.description}</small></span>
								<span className="builder-component-card__add">+</span>
							</button>
						))}
						{paletteGrid && <button className="builder-component-card" type="button" data-testid="add-component-grid" draggable onDragStart={(event) => startPaletteDrag(event, 'Container:grid')} onDragEnd={() => setDragOverId(null)} onClick={() => addComponent('Container', { layout: 'grid', background: 'soft' })} title="یک بخش با چیدمان شبکه‌ای واکنش‌گرا اضافه کنید.">
							<span className="builder-component-card__icon">▦</span>
							<span><strong>شبکه</strong><small>بخش Grid با ستون‌های واکنش‌گرا</small></span>
							<span className="builder-component-card__add">+</span>
						</button>}
						{palettePluginComponents.map((component) => <button className="builder-component-card" type="button" key={`${component.pluginId}/${component.componentId}`} data-testid={`plugin-component-${component.componentId}`} onClick={() => insertPluginComponent(component)}><span className="builder-component-card__icon">◇</span><span><strong>{component.label}</strong><small>مؤلفهٔ افزونه · داده‌محور</small></span><span className="builder-component-card__add">+</span></button>)}
						{palettePresets.map((preset) => <button className="builder-component-card" type="button" key={preset.id} onClick={() => choosePluginPreset(preset)} title={preset.description}><span className="builder-component-card__icon">▦</span><span><strong>{preset.label}</strong><small>{preset.description}</small></span><span className="builder-component-card__add">+</span></button>)}
						{paletteProcessors.map((processor) => <button className="builder-component-card" type="button" key={`${processor.packageId}/${processor.id}`} data-testid={`plugin-processor-${processor.id}`} onClick={() => choosePluginProcessor(processor)} title={processor.description}><span className="builder-component-card__icon">∑</span><span><strong>{processor.label}</strong><small>{processor.description}</small></span><span className="builder-component-card__add">+</span></button>)}
						{!paletteDefinitions.length && !paletteGrid && !palettePluginComponents.length && !palettePresets.length && !paletteProcessors.length && <p className="builder-library-empty" role="status">{libraryGroup === 'plugins' && !paletteNeedle ? 'افزونهٔ صفحه‌ساز فعالی وجود ندارد.' : 'عنصری پیدا نشد.'}</p>}
					</div>
					{selectedId ? (
						<Breadcrumb path={findNodePath(document.nodes, selectedId) ?? []} onSelect={selectNode} />
					) : null}
<div className="builder-tree-heading"><span>لایه‌ها</span><span>{countNodes(document.nodes).toLocaleString('fa-IR')}</span></div>
					{document.nodes.length ? (
						<div className="builder-tree" role="list" aria-label="ساختار صفحه">
							{document.nodes.map((node) => <TreeNode key={node.id} node={node} selectedId={selectedId} dragOverId={dragOverId} dragPlacement={dragPlacement} onSelect={selectNode} onDragStart={startDrag} onDragOver={handleDragOver} onDragOut={() => setDragOverId(null)} onDrop={handleDrop} />)}
						</div>
					) : (
						<p className="builder-tree-empty">هنوز مؤلفه‌ای در صفحه نیست.</p>
					)}
					<div className="builder-panel__footer builder-panel__footer--wrap">
						<button type="button" onClick={() => void toggleHistory()}>{historyOpen ? 'بستن تاریخچه' : 'تاریخچهٔ نسخه‌ها'}</button>
						<button type="button" onClick={() => void openTemplateLibrary()}>قالب‌ها</button>
						<button type="button" onClick={() => { setSaveSelectedSection(false); setTemplateName(''); setTemplateSaveOpen(true); }}>ذخیرهٔ قالب</button>
						<button type="button" disabled={!selectedNode} onClick={() => { setSaveSelectedSection(true); setTemplateName(''); setTemplateSaveOpen(true); }}>ذخیرهٔ انتخاب به‌عنوان بخش</button>
						<button type="button" disabled={selectedNode?.type !== 'Container' || Boolean(selectedNode.sharedSection) || sharedBusy} onClick={() => { if (selectedNode?.type === 'Container') { setSharedName(''); setSharedCreateTarget(selectedNode.id); } }}>ساخت بخش مشترک از انتخاب</button>
						{selectedNode?.type === 'Container' && selectedNode.sharedSection ? <>
							<button type="button" disabled={sharedBusy} onClick={() => void updateSharedSource(selectedNode)}>به‌روزرسانی منبع مشترک</button>
							<button type="button" disabled={sharedBusy} onClick={() => void syncShared(selectedNode.sharedSection!)}>همگام‌سازی بخش مشترک</button>
							<button type="button" disabled={sharedBusy} onClick={() => detachShared(selectedNode)}>قطع پیوند بخش مشترک</button>
						</> : null}
						<button type="button" onClick={downloadDocument}>خروجی JSON</button>
						<button type="button" onClick={() => importInputRef.current?.click()}>ورود JSON</button>
						<button type="button" onClick={() => elementorInputRef.current?.click()}>بررسی خروجی Elementor</button>
						<input ref={elementorInputRef} data-testid="elementor-import-file" hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void inspectElementor(file); }} />
						<button type="button" onClick={() => wxrInputRef.current?.click()}>بررسی خروجی WordPress WXR</button>
						<input ref={wxrInputRef} data-testid="wxr-import-file" hidden type="file" accept=".xml,text/xml,application/xml" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void inspectWordPress(file); }} />
						<button type="button" onClick={() => wxrArchiveInputRef.current?.click()}>بررسی بستهٔ WordPress ZIP</button>
						<input ref={wxrArchiveInputRef} data-testid="wxr-archive-file" hidden type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void inspectWordPressArchive(file); }} />
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
						<span className="builder-canvas-hint">عناصر را به صفحه بکشید · برای ویرایش متن دوبار کلیک کنید</span>
					</div>
					<div className={`builder-canvas-scroll builder-canvas-scroll--${viewport}`}>
						<div className={`builder-canvas-paper builder-canvas-paper--${viewport} ${isMobileRange(document, viewport) ? 'builder-canvas-paper--mobile' : ''}`} style={{ width: `min(100%, ${previewWidth(document, viewport)}px)` }}>
							<div className="builder-preview-page" data-builder-theme={document.themeId} style={themeVariables(document.themeId) as unknown as CSSProperties}>
								<header className="builder-preview-page__intro">
									<div className="builder-preview-label">پیش‌نمایش صفحه · /pages/{slug}</div>
									<h1>{document.title || 'بدون عنوان'}</h1>
									{document.description ? <p>{document.description}</p> : null}
								</header>
								<div className={`builder-preview-content${dragOverId === '__page__' ? ' builder-preview-content--drag-over' : ''}`} data-testid="builder-canvas" onClick={() => selectNode(null)} onDragOver={(event) => handleDragOver(event, null)} onDragLeave={() => setDragOverId(null)} onDrop={(event) => handleDrop(event, null)}>
									{document.nodes.length ? <>
										<div className="builder-section-gap"><button type="button" data-testid={`canvas-insert-before-${document.nodes[0].id}`} aria-label="افزودن بخش پیش از نخستین بخش صفحه" onClick={(event) => { event.stopPropagation(); void openTemplateLibrary({ target: { targetId: document.nodes[0].id, placement: 'before' } }); }}><span aria-hidden="true">＋</span> افزودن بخش</button></div>
										{document.nodes.map((node, index) => (
											<Fragment key={node.id}>
												<PreviewNode document={document} node={node} selectedId={selectedId} dragOverId={dragOverId} dragPlacement={dragPlacement} viewport={viewport} onSelect={selectNode} onInlineEdit={updateInlineText} onDragStart={startDrag} onDragOver={handleDragOver} onDragOut={() => setDragOverId(null)} onDrop={handleDrop} />
												<div className="builder-section-gap"><button type="button" data-testid={`canvas-insert-after-${node.id}`} aria-label={`افزودن بخش پس از بخش ${index + 1}`} onClick={(event) => { event.stopPropagation(); void openTemplateLibrary({ target: { targetId: node.id, placement: 'after' } }); }}><span aria-hidden="true">＋</span> افزودن بخش</button></div>
											</Fragment>
										))}
										<div className="builder-canvas-dropzone" data-testid="canvas-root-drop" onDragOver={(event) => handleDragOver(event, null)} onDrop={(event) => handleDrop(event, null)}>یک عنصر را برای افزودن به انتهای صفحه اینجا رها کنید</div>
									</> : (
										<div className="builder-canvas-empty">
											<div className="builder-canvas-empty__mark" aria-hidden="true">✦</div>
											<strong>صفحهٔ شما از اینجا شروع می‌شود</strong>
											<span>یک طرح آماده انتخاب کنید یا عناصر را از پنل به اینجا بکشید.</span>
											<div className="builder-canvas-empty__actions">
												<button type="button" data-testid="start-with-template" onClick={(event) => { event.stopPropagation(); void openTemplateLibrary(); }}>مشاهدهٔ طرح‌های آماده</button>
												<button type="button" onClick={(event) => { event.stopPropagation(); addComponent('Container'); }}>افزودن بخش خالی</button>
											</div>
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
							document={document}
							mode={mode}
							viewport={viewport}
							canMoveUp={Boolean(findNodeLocation(document.nodes, selectedNode.id)?.index)}
							canMoveDown={canMoveDown(document.nodes, selectedNode.id)}
							onField={(field, value, historyKey) => updateField(selectedNode, field, value, historyKey)}
							onHidden={(hidden) => {
								try { runDocumentCommand({ type: 'visibility', id: selectedNode.id, breakpoint: viewport, hidden }); }
								catch (error) { setMessage(error instanceof Error ? error.message : 'تنظیم نمایش انجام نشد.'); }
							}}
							onMove={moveSelected}
							onDuplicate={duplicateSelected}
							onDelete={removeSelected}
							onDeselect={() => selectNode(null)}
							canReadMedia={canReadMedia}
							onPickMedia={(itemId) => openMediaPicker(selectedNode, itemId)}
						/>
					) : (
						<PageInspector document={document} onDescription={updatePageDescription} onTheme={(themeId) => runDocumentCommand({ type: 'metadata', patch: { themeId } })} onBreakpoints={(breakpoints) => runDocumentCommand({ type: 'metadata', patch: { breakpoints } })} onRemoveBreakpoint={(id) => runDocumentCommand({ type: 'remove-breakpoint', id })} />
					)}
				</aside>
			</div>
			{diagnosticReport ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDiagnosticReport(null); }}>
					<section className="builder-modal builder-elementor-dialog" role="dialog" aria-modal="true" aria-labelledby="builder-diagnostics-title">
						<header className="builder-modal__header"><div><h2 id="builder-diagnostics-title">بررسی پیش از انتشار</h2><p>این گزارش از نسخهٔ فعلی ویرایشگر است؛ بررسی، ذخیره یا انتشار انجام نمی‌دهد.</p></div><button type="button" aria-label="بستن" onClick={() => setDiagnosticReport(null)}>×</button></header>
						<div className="builder-elementor-report">
							{diagnosticReport.snapshot !== JSON.stringify(document) ? <p role="alert">سند پس از بررسی تغییر کرده است؛ برای گزارش تازه دوباره بررسی کنید.</p> : null}
							<p>این گزارش توصیه‌ای است؛ فایل رسانهٔ داخلیِ گم‌شده هنگام انتشار مسدود می‌شود. پیوندها و فایل‌های خارجی از راه شبکه بررسی نمی‌شوند.</p>
							{diagnosticReport.items.length ? <ul>{diagnosticReport.items.map((item, index) => <li key={`${item.code}-${item.nodeId ?? 'page'}-${index}`}>{item.message} {item.nodeId ? <button type="button" onClick={() => { selectNode(item.nodeId!); setDiagnosticReport(null); }}>انتخاب مؤلفه</button> : null}</li>)}</ul> : <p>در بررسی‌های محدود این گزارش هشداری پیدا نشد.</p>}
						</div>
						<footer className="builder-modal__footer"><button type="button" onClick={() => setDiagnosticReport(null)}>بستن</button><button type="button" disabled={diagnosticsBusy} onClick={() => void inspectPage()}>بررسی دوباره</button></footer>
					</section>
				</div>
			) : null}
			{processorDialog ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeProcessorDialog(); }}>
					<form className="builder-modal builder-elementor-dialog" role="dialog" aria-modal="true" aria-labelledby="builder-processor-title" onSubmit={(event) => { event.preventDefault(); void insertPluginProcessor(); }}>
						<header className="builder-modal__header"><div><h2 id="builder-processor-title">{processorDialog.processor.label}</h2><p>محاسبه در محیط محدود انجام می‌شود؛ نتیجه به‌صورت مؤلفهٔ بومی و قابل ویرایش درج می‌شود.</p></div><button type="button" aria-label="بستن" onClick={closeProcessorDialog}>×</button></header>
						<div className="builder-elementor-report">{processorDialog.processor.inputs.map((field) => <label className="builder-field" key={field.key}><span>{field.label}</span><input type="number" step="1" min={field.min} max={field.max} required value={processorDialog.values[field.key] ?? ''} onChange={(event) => setProcessorDialog((current) => current ? { ...current, values: { ...current.values, [field.key]: event.target.value }, error: '' } : current)} /></label>)}{processorDialog.error ? <p role="alert">{processorDialog.error}</p> : null}</div>
						<footer className="builder-modal__footer"><button type="button" onClick={closeProcessorDialog}>انصراف</button><button type="submit" className="builder-toolbar-button--publish" disabled={processorBusy}>{processorBusy ? 'در حال محاسبه…' : 'محاسبه و افزودن'}</button></footer>
					</form>
				</div>
			) : null}
			{presetDialog ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPresetDialog(null); }}>
					<form className="builder-modal builder-elementor-dialog" role="dialog" aria-modal="true" aria-labelledby="builder-preset-title" onSubmit={(event) => { event.preventDefault(); insertPluginPreset(presetDialog.preset, presetDialog.values); }}>
						<header className="builder-modal__header"><div><h2 id="builder-preset-title">{presetDialog.preset.label}</h2><p>مقادیر در رونوشت بومی ذخیره می‌شوند و پس از درج قابل ویرایش هستند.</p></div><button type="button" aria-label="بستن" onClick={() => setPresetDialog(null)}>×</button></header>
						<div className="builder-elementor-report">{presetDialog.preset.parameters?.map((field) => <label className="builder-field" key={field.key}><span>{field.label}</span><input type="text" maxLength={field.maxLength} value={presetDialog.values[field.key] ?? ''} onChange={(event) => setPresetDialog((current) => current ? { ...current, values: { ...current.values, [field.key]: event.target.value }, error: '' } : current)} /></label>)}{presetDialog.error ? <p role="alert">{presetDialog.error}</p> : null}</div>
						<footer className="builder-modal__footer"><button type="button" onClick={() => setPresetDialog(null)}>انصراف</button><button type="submit" className="builder-toolbar-button--publish">افزودن به صفحه</button></footer>
					</form>
				</div>
			) : null}
			{wxrArchive ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !wxrArchiveBusy) setWxrArchive(null); }}>
					<section className="builder-modal builder-elementor-dialog" role="dialog" aria-modal="true" aria-labelledby="wxr-archive-title">
						<header className="builder-modal__header"><div><h2 id="wxr-archive-title">بررسی بستهٔ WordPress ZIP</h2><p>فایل بدون نوشتن رسانه بررسی شد؛ هیچ اتصال به سایت منبع انجام نمی‌شود.</p></div><button type="button" aria-label="بستن" disabled={wxrArchiveBusy} onClick={() => setWxrArchive(null)}>×</button></header>
						<div className="builder-elementor-report">
							<p>{wxrArchive.summary.items.length.toLocaleString('fa-IR')} صفحه و نوشته · {wxrArchive.summary.assetCount.toLocaleString('fa-IR')} تصویر · {wxrArchive.summary.matchedAttachments.toLocaleString('fa-IR')} رسانهٔ شناسایی‌شده · {wxrArchive.summary.unmatchedAttachments.toLocaleString('fa-IR')} رسانهٔ بدون فایل</p>
							<p>در مسیر صفحه‌ساز همهٔ تصویرهای بسته وارد می‌شوند و نوشته‌ها به صفحه تبدیل می‌شوند. در مسیر مستقل مجله فقط نوشته‌ها و تصویرهای موردنیاز آن‌ها وارد می‌شوند؛ هر دو مسیر فقط پیش‌نویس می‌سازند و رسانهٔ بدون فایل جای‌نگهدار می‌ماند.</p>
							{wxrArchive.summary.items.some((item) => item.hasElementor) ? <label className="builder-field"><span><input type="checkbox" checked={wxrArchivePreferElementor} disabled={wxrArchiveBusy} onChange={(event) => setWxrArchivePreferElementor(event.target.checked)} /> استفاده از دادهٔ Elementor موجود در بسته</span></label> : null}
							{wxrArchive.summary.items.map((item, index) => <details key={`${index}-${item.title}`}><summary>{index + 1}. {item.title} · {item.type === 'post' ? 'نوشته' : 'صفحه'}</summary><ul>{item.warnings.map((warning, i) => <li key={i}>{warning}</li>)}{wxrArchivePreferElementor ? item.elementorWarnings.map((warning, i) => <li key={`e-${i}`}>{warning}</li>) : null}{wxrArchivePreferElementor && item.elementorError ? <li>{item.elementorError}</li> : null}</ul>{item.type === 'post' ? <><h4>هشدارهای ورود به مجله</h4><ul>{item.blogWarnings.map((warning, i) => <li key={`b-${i}`}>{warning}</li>)}{item.blogError ? <li>{item.blogError}</li> : null}</ul></> : null}</details>)}
							<label className="builder-field"><span>پیشوند نامک بستهٔ WordPress</span><input dir="ltr" maxLength={55} value={wxrArchivePrefix} disabled={wxrArchiveBusy} onChange={(event) => setWxrArchivePrefix(event.target.value)} placeholder="wordpress" /></label>
							{wxrArchiveStatus ? <p role="status">{wxrArchiveStatus}</p> : null}{wxrArchivePages.length ? <ul>{wxrArchivePages.map((page) => <li key={page}><a href={`/cms/builder/${encodeURIComponent(page)}`}>{page}</a></li>)}</ul> : null}
							<section className="builder-wxr-post" aria-label="ورود نوشته‌های مجله از بسته">
								<h3>ورود نوشته‌های مجله از بسته</h3>
								<p>{wxrArchive.summary.items.filter((item) => item.type === 'post').length.toLocaleString('fa-IR')} نوشته · {wxrArchive.summary.postAssetCount.toLocaleString('fa-IR')} تصویر موردنیاز. محتوای HTML وردپرس وارد می‌شود، نه طرح Elementor.</p>
								<button type="button" disabled={!canWritePosts || wxrArchiveBusy || wxrArchivePosts.length > 0 || wxrArchivePostUncertain || !wxrArchivePrefix.trim() || !wxrArchive.summary.items.some((item) => item.type === 'post') || wxrArchive.summary.items.filter((item) => item.type === 'post').length > 20 || wxrArchive.summary.items.some((item) => item.type === 'post' && Boolean(item.blogError)) || (wxrArchive.summary.postAssetCount > 0 && !canUploadMedia)} onClick={() => void installWordPressArchivePosts()}>ورود نوشته‌های پیش‌نویس و رسانه</button>
								{!canWritePosts ? <p>نقش شما اجازهٔ ساخت نوشته ندارد.</p> : null}{wxrArchivePostStatus ? <p role="status">{wxrArchivePostStatus}</p> : null}{wxrArchivePosts.length ? <ul>{wxrArchivePosts.map((id) => <li key={id}><a href={`/cms/posts/${encodeURIComponent(id)}`}>{id}</a></li>)}</ul> : null}
							</section>
						</div>
						<footer className="builder-modal__footer"><button type="button" disabled={wxrArchiveBusy} onClick={() => setWxrArchive(null)}>بستن</button><button type="button" className="builder-toolbar-button--publish" disabled={wxrArchiveBusy || wxrArchivePages.length > 0 || wxrArchivePageUncertain || !wxrArchivePrefix.trim() || !wxrArchive.summary.items.length || wxrArchive.summary.items.length > 20 || (wxrArchive.summary.assetCount > 0 && !canUploadMedia)} onClick={() => void installWordPressArchive()}>ورود پیش‌نویس‌ها و رسانه</button></footer>
					</section>
				</div>
			) : null}
			{wxrImport ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeWordPressImport(); }}>
					<section className="builder-modal builder-elementor-dialog" role="dialog" aria-modal="true" aria-labelledby="wxr-import-title">
						<header className="builder-modal__header"><div><h2 id="wxr-import-title">بررسی خروجی WordPress WXR</h2><p>نسخهٔ {wxrImport.inspection.version} · {wxrImport.inspection.items.length.toLocaleString('fa-IR')} صفحه و نوشته · {wxrImport.inspection.ignored.toLocaleString('fa-IR')} مورد دیگر نادیده گرفته شد.</p></div><button type="button" aria-label="بستن" onClick={closeWordPressImport}>×</button></header>
						<div className="builder-elementor-report"><label className="builder-field"><span>مورد منبع</span><select value={wxrImport.index} disabled={wxrPostBusy || wxrBlogBulkBusy || wxrBulkBusy} onChange={(event) => selectWordPressItem(Number(event.target.value))}>{wxrImport.inspection.items.map((item, index) => <option key={`${item.id}-${index}`} value={index}>{item.title} · {item.type === 'post' ? 'نوشته' : 'صفحه'} · {item.status}</option>)}</select></label>
						{wxrImport.inspection.items.some((item) => item.elementorData) ? <label className="builder-field"><span><input type="checkbox" checked={wxrImport.preferElementor} disabled={wxrPostBusy || wxrBlogBulkBusy || wxrBulkBusy} onChange={(event) => selectWordPressItem(wxrImport.index, event.target.checked)} /> استفاده از دادهٔ Elementor موجود در WXR</span></label> : null}
						<p>با انتخاب Elementor، برای موارد بدون دادهٔ معتبر، HTML وردپرس استفاده می‌شود. هشدارهای هر مورد را پیش از ورود گروهی بررسی کنید.</p><label className="builder-field"><span>نگاشت اختیاری رسانهٔ WordPress (JSON)</span><input type="file" accept=".json,application/json" data-testid="wxr-media-map" disabled={!canReadMedia || wxrPostBusy || wxrBlogBulkBusy || wxrBulkBusy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void inspectWordPressMediaMap(file); }} /></label><p>فقط رسانه‌های موجود کتابخانه نگاشت می‌شوند؛ هیچ نشانی منبع بارگیری نمی‌شود.</p>{wxrMediaStatus ? <p role="status">{wxrMediaStatus}</p> : null}
						<p>مقصد: صفحهٔ فعلی. محتوای تبدیل‌شده جایگزین می‌شود؛ عنوان و نامک فعلی حفظ می‌شوند. نتیجه تا ذخیرهٔ موفق ذخیره‌شده نیست.</p><ul>{wxrImport.inspection.items[wxrImport.index].warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>{wxrReports[wxrImport.index] ? <ul>{wxrReports[wxrImport.index].messages.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}{wxrImport.conversionError ? <p role="alert">{wxrImport.conversionError}</p> : null}<h3>پیش‌نمایش محتوای تبدیل‌شده</h3>{wxrImport.document ? <div className="builder-elementor-preview"><DocumentPreview document={wxrImport.document} viewport={viewport} /></div> : null}{wxrPostPreview ? <section className="builder-wxr-post" aria-label="ورود نوشتهٔ مجله">
							<h3>ساخت نوشتهٔ مجله از مورد انتخاب‌شده</h3>
							<p>این مسیر مستقل از صفحه‌ساز و فقط برای پیش‌نویس نوشته است؛ HTML وردپرس به متن ایمن تبدیل می‌شود؛ تصاویر نگاشت‌شده از رسانهٔ محلی و تصاویر دیگر به‌صورت جای‌نگهدار استفاده می‌شوند.</p>
							{wxrPostPreview.error ? <p role="alert">{wxrPostPreview.error}</p> : null}
							{wxrPostPreview.draft ? <><ul>{wxrPostPreview.draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><details><summary>متن نوشته پیش از ورود</summary><pre>{wxrPostPreview.draft.body}</pre></details><label className="builder-field"><span>نامک نوشتهٔ مجله</span><input dir="ltr" maxLength={120} value={wxrPostSlug} disabled={wxrPostBusy || Boolean(wxrPostId) || wxrPostUncertain} onChange={(event) => setWxrPostSlug(event.target.value)} /></label><button type="button" disabled={!canWritePosts || wxrPostBusy || wxrBlogBulkBusy || wxrBulkBusy || wxrMapBusy || Boolean(wxrPostId) || wxrPostUncertain} onClick={() => void createWordPressBlogDraft()}>ساخت نوشتهٔ پیش‌نویس</button>{!canWritePosts ? <p>نقش شما اجازهٔ ساخت نوشته ندارد.</p> : null}</> : null}
							{wxrPostStatus ? <p role="status">{wxrPostStatus}</p> : null}{wxrPostId ? <a href={`/cms/posts/${encodeURIComponent(wxrPostId)}`}>ویرایش نوشتهٔ ساخته‌شده</a> : null}
						</section> : null}
						<section>
							<h3>ساخت گروهی پیش‌نویس‌های صفحه‌ساز</h3>
							<p>تمام صفحه‌ها و نوشته‌های بررسی‌شده (حداکثر ۲۰ مورد) با عنوان منبع و نامک عددی ساخته می‌شوند؛ در این مسیر نوشته‌ها به صفحه تبدیل می‌شوند.</p>
							<details><summary>هشدارهای تمام موارد برای ورود گروهی صفحه</summary>{wxrImport.inspection.items.map((item, index) => <div key={`${item.id}-${index}`}><strong>{index + 1}. {item.title}</strong><ul>{item.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}{wxrReports[index]?.messages.map((warning, warningIndex) => <li key={`elementor-${warningIndex}`}>{warning}</li>)}{wxrReports[index]?.error ? <li>{wxrReports[index].error}</li> : null}</ul></div>)}</details>
							{wxrImport.inspection.items.length > 20 ? <p>ورود گروهی بیش از ۲۰ مورد پشتیبانی نمی‌شود؛ ورود تکی همچنان در دسترس است.</p> : null}
							<label className="builder-field"><span>پیشوند نامک برای ورود گروهی</span><input dir="ltr" value={wxrBulkPrefix} maxLength={55} disabled={wxrPostBusy || wxrBlogBulkBusy || wxrBulkBusy} onChange={(event) => setWxrBulkPrefix(event.target.value)} placeholder="wordpress" /></label>
							<button type="button" disabled={wxrBulkBusy || wxrBlogBulkBusy || wxrPostBusy || wxrMapBusy || !wxrBulkPrefix.trim() || wxrImport.inspection.items.length > 20} onClick={() => void installWordPressDrafts()}>ساخت صفحه‌های پیش‌نویس</button>{wxrBulkStatus ? <p role="status">{wxrBulkStatus}</p> : null}
						</section>
						<section aria-label="ورود گروهی نوشته‌های مجله">
							<h3>ساخت گروهی نوشته‌های مجله</h3>
							<p>فقط نوشته‌های وردپرس با همین پیشوند و نامک عددی به نوشتهٔ واقعی مجله تبدیل می‌شوند؛ صفحه‌ها در این مسیر نادیده گرفته می‌شوند. تصاویر نگاشت‌شده از کتابخانه استفاده می‌کنند و انتشار جداگانه است.</p>
							<p>{wxrImport.inspection.items.filter((item) => item.type === 'post').length.toLocaleString('fa-IR')} نوشتهٔ منبع · حداکثر ۲۰ نوشته</p>
							<details><summary>هشدارهای نوشته‌های مجله</summary>{wxrBlogReports.map((item, index) => <div key={`${index}-${item.title}`}><strong>{index + 1}. {item.title}</strong><ul>{item.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}{item.error ? <li>{item.error}</li> : null}</ul></div>)}</details>
							<button type="button" disabled={!canWritePosts || wxrBlogBulkBusy || wxrPostBusy || wxrBulkBusy || wxrMapBusy || !wxrBulkPrefix.trim() || !wxrBlogReports.length || wxrBlogReports.some((item) => Boolean(item.error)) || wxrBlogBulkIds.length > 0 || wxrBlogBulkUncertain} onClick={() => void installWordPressBlogDrafts()}>ساخت گروهی نوشته‌های پیش‌نویس</button>
							{!canWritePosts ? <p>نقش شما اجازهٔ ساخت نوشته ندارد.</p> : null}{wxrBlogBulkStatus ? <p role="status">{wxrBlogBulkStatus}</p> : null}{wxrBlogBulkIds.length ? <ul>{wxrBlogBulkIds.map((id) => <li key={id}><a href={`/cms/posts/${encodeURIComponent(id)}`}>{id}</a></li>)}</ul> : null}
						</section></div>
						<footer className="builder-modal__footer"><button type="button" disabled={wxrPostBusy || wxrBlogBulkBusy || wxrBulkBusy} onClick={closeWordPressImport}>انصراف</button><button type="button" className="builder-toolbar-button--publish" disabled={!wxrImport.document || wxrMapBusy || wxrPostBusy || wxrBlogBulkBusy || wxrBulkBusy} onClick={applyWordPress}>جایگزینی پیش‌نویس</button></footer>
					</section>
				</div>
			) : null}
			{elementorImport ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeElementorImport(); }}>
					<section className="builder-modal builder-elementor-dialog" role="dialog" aria-modal="true" aria-labelledby="elementor-import-title">
						<header className="builder-modal__header"><div><h2 id="elementor-import-title">بررسی ورود Elementor</h2><p>{elementorImport.converted.toLocaleString('fa-IR')} مؤلفه بررسی شد · فایل فقط در مرورگر خوانده شد.</p></div><button type="button" aria-label="بستن" onClick={closeElementorImport}>×</button></header>
						<div className="builder-elementor-report"><p>فرمت: Elementor JSON · ۱ صفحهٔ منبع · تصویرهای نیازمند انتخاب: {elementorImport.missingAssets.toLocaleString('fa-IR')}</p><p>ویجت‌های تبدیل‌شده: <bdi>{Object.entries(elementorImport.supportedWidgets).map(([type, count]) => `${type}: ${count}`).join('، ') || '—'}</bdi></p><p>ویجت‌های پشتیبانی‌نشده: <bdi>{Object.entries(elementorImport.unsupportedWidgets).map(([type, count]) => `${type}: ${count}`).join('، ') || '—'}</bdi></p><p>این پیش‌نمایش تقریبی است. تصویرهای بدون نگاشت منتقل نمی‌شوند؛ موارد پشتیبانی‌نشده را پس از ورود جایگزین کنید. نتیجه تا ذخیرهٔ خودکار موفق، ذخیره‌شده نیست.</p>
							<label className="builder-field"><span>نگاشت اختیاری رسانهٔ Elementor (JSON)</span><input type="file" accept=".json,application/json" data-testid="elementor-media-map" disabled={!canReadMedia} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void inspectElementorMediaMap(file); }} /></label><p>فقط رسانه‌های موجود کتابخانه نگاشت می‌شوند؛ هیچ نشانی منبع بارگیری نمی‌شود.</p>{elementorMediaStatus ? <p role="status">{elementorMediaStatus}</p> : null}
							<ul>{elementorImport.warnings.map((warning, index) => <li key={index}><b dir="ltr">{warning.sourceId}</b> — {warning.message}</li>)}</ul>
							<h3>پیش‌نمایش محتوای تبدیل‌شده</h3><div className="builder-elementor-preview" onClick={(event) => { if ((event.target as HTMLElement).closest('a')) event.preventDefault(); }}><DocumentPreview document={elementorImport.document} viewport={viewport} /></div>
						</div>
						<footer className="builder-modal__footer"><button type="button" onClick={closeElementorImport}>انصراف</button><button type="button" className="builder-toolbar-button--publish" disabled={elementorMapBusy} onClick={applyElementor}>جایگزینی پیش‌نویس</button></footer>
					</section>
				</div>
			) : null}
			{templateDialogOpen ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTemplateLibrary(); }}>
					<section className="builder-modal builder-modal--templates" role="dialog" aria-modal="true" aria-labelledby="builder-template-title">
						<header className="builder-modal__header"><div><h2 id="builder-template-title">کتابخانهٔ قالب‌ها</h2><p>بخش‌ها را اضافه کنید یا یک صفحهٔ کامل را با تأیید جایگزین کنید.</p></div><button type="button" aria-label="بستن" onClick={closeTemplateLibrary}>×</button></header>
						<div className="builder-template-browser">
							<div className="builder-template-browser__intro"><div><span>کتابخانهٔ طراحی نووکس</span><h3>یک شروع خوب انتخاب کنید</h3><p>طرح‌ها از مؤلفه‌های واقعی ساخته شده‌اند؛ همهٔ متن‌ها، تصویرها و چیدمان قابل ویرایش‌اند.</p></div></div>
							<div className="builder-template-filters">
								<div className="builder-template-filter-buttons" role="group" aria-label="نوع قالب">
									{([['all', 'همه'], ['page', 'صفحه‌های کامل'], ['section', 'بخش‌ها'], ['saved', 'ذخیره‌شده']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={templateFilter === value} onClick={() => setTemplateFilter(value)}>{label}</button>)}
								</div>
								<label className="builder-field builder-template-search"><span className="sr-only">جست‌وجوی قالب و بخش</span><input type="search" placeholder="جست‌وجوی طرح‌ها…" value={templateQuery} onChange={(event) => setTemplateQuery(event.target.value)} /></label>
							</div>
							<p className="builder-template-note">{sectionInsertion.targetId ? `محل افزودن: ${sectionInsertion.placement === 'before' ? 'پیش' : 'پس'} از بخش انتخاب‌شده در سطح صفحه.` : 'محل افزودن: صفحهٔ خالی.'} تم صفحه حفظ می‌شود. محصولات از فروشگاه واقعی خوانده می‌شوند؛ متن‌ها و تصویرهای نمونه را پیش از انتشار بررسی کنید.</p>
							{templateError ? <p className="builder-template-error" role="alert">{templateError}</p> : null}
							<div className="builder-template-list">
								{templateItems.filter((item) => (templateFilter === 'all' || (templateFilter === 'saved' ? item.source === 'saved' : item.source === 'starter' && item.kind === templateFilter)) && normalizeLibrarySearch(`${item.name} ${item.description}`).includes(normalizeLibrarySearch(templateQuery.trim()))).map((item) => (
									<article className="builder-template-card" key={`${item.source}-${item.id}`} data-testid={`template-card-${item.id}`}>
										<TemplateThumbnail item={item} />
										<div className="builder-template-card__body"><span className="builder-template-card__tag">{item.source === 'saved' ? 'ذخیره‌شده' : item.kind === 'page' ? 'صفحهٔ کامل' : 'بخش آماده'}</span><h3>{item.name}</h3><p>{item.description}</p></div>
										<div className="builder-template-card__actions">
											<button type="button" disabled={templateActionBusy} onClick={() => void previewTemplate(item)}>پیش‌نمایش</button>
											<button className={item.kind === 'section' ? 'builder-template-card__use' : undefined} type="button" disabled={templateActionBusy} onClick={() => void insertTemplate(item)} title="افزودن به محتوای فعلی بدون تغییر تم">{item.kind === 'section' ? 'افزودن بخش' : 'افزودن رونوشت'}</button>
											{item.kind !== 'section' && <button className="builder-template-card__use" type="button" disabled={templateActionBusy} onClick={() => void useTemplate(item)} title="جایگزینی محتوای صفحه با این طرح">استفاده</button>}
											<details className="builder-template-card__more"><summary>بیشتر</summary><div><button type="button" disabled={templateActionBusy} onClick={() => void downloadTemplate(item)}>خروجی JSON</button><button type="button" disabled={templateActionBusy} onClick={() => void duplicateTemplate(item)}>رونوشت</button></div></details>
										</div>
									</article>
								))}
								{!templateItems.some((item) => (templateFilter === 'all' || (templateFilter === 'saved' ? item.source === 'saved' : item.source === 'starter' && item.kind === templateFilter)) && normalizeLibrarySearch(`${item.name} ${item.description}`).includes(normalizeLibrarySearch(templateQuery.trim()))) ? <p className="builder-template-empty">{templateLoading ? 'در حال بارگیری قالب‌ها…' : 'قالبی پیدا نشد.'}</p> : null}
							</div>
							<div className="builder-template-advanced"><h3>بسته‌ها و بخش‌های مشترک</h3>
						<details className="builder-kit-panel" onToggle={(event) => { if (event.currentTarget.open) void loadSiteKits(); }}><summary>بستهٔ چندصفحه‌ای کسب‌وکار</summary>
							{siteKitsLoading && <p role="status">در حال بارگیری بسته‌ها…</p>}
							{siteKits.map((kit) => <div key={kit.id}><p>{kit.description}</p><p>نسخهٔ {kit.version} · فارسی، راست‌به‌چپ · مؤلفه‌ها: <bdi>{kit.requiredComponents.join(', ')}</bdi></p><p>پیوندهای میان صفحه‌ها با پیشوند انتخابی ساخته می‌شوند و تا انتشار هر مقصد در دسترس عمومی نیستند.</p><ul>{kit.pages.map((page) => <li key={page.suffix}>{page.title} <button type="button" onClick={() => setTemplatePreview({ name: page.title, document: page.document })}>پیش‌نمایش</button></li>)}</ul><label className="builder-field"><span>پیشوند نامک لاتین برای صفحه‌های تازه</span><input dir="ltr" value={kitPrefix} maxLength={50} onChange={(event) => setKitPrefix(event.target.value)} placeholder="my-business" /></label><button type="button" disabled={kitBusy || !kitPrefix.trim()} onClick={() => void installKit(kit.id)}>ساخت پیش‌نویس‌های بسته</button> <button type="button" disabled={kitBusy || !kitPrefix.trim()} onClick={() => void updateKit(kit.id)}>بررسی به‌روزرسانی بسته</button></div>)}
							{kitStatus ? <p role="status">{kitStatus}</p> : null}
						</details>
						<details className="builder-kit-panel"><summary>بستهٔ سایت JSON</summary>
							<p>فقط دادهٔ معتبر و رسانهٔ محلی؛ کد و بارگیری از شبکه پشتیبانی نمی‌شوند.</p>
							<label className="builder-field"><span>انتخاب بستهٔ سایت JSON</span><input type="file" accept=".json,application/json" data-testid="site-kit-package" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void inspectKitPackage(file); }} /></label>
							{packageKit ? <><p>{packageKit.name} · نسخهٔ {packageKit.version} · {packageKit.pages.length.toLocaleString('fa-IR')} صفحه</p><ul>{packageKit.pages.map((page) => <li key={page.suffix}>{page.title} · <bdi>{page.suffix}</bdi> <button type="button" onClick={() => setTemplatePreview({ name: page.title, document: page.document })}>پیش‌نمایش</button></li>)}</ul><label className="builder-field"><span>پیشوند بستهٔ JSON</span><input dir="ltr" value={packagePrefix} maxLength={50} onChange={(event) => setPackagePrefix(event.target.value)} /></label><button type="button" disabled={kitBusy || !packagePrefix.trim()} onClick={() => void applyKitPackage('install')}>نصب بستهٔ JSON</button> <button type="button" disabled={kitBusy || !packagePrefix.trim()} onClick={() => void applyKitPackage('update')}>به‌روزرسانی بستهٔ JSON</button></> : null}
							{packageStatus ? <p role="status">{packageStatus}</p> : null}
						</details>
						<details className="builder-kit-panel"><summary>بستهٔ سایت ZIP</summary>
							<p>بسته فقط شامل kit.json و تصاویر اعلام‌شده در assets است. کد، مسیرهای دیگر و بارگیری شبکه پذیرفته نمی‌شوند.</p>
							<label className="builder-field"><span>انتخاب بستهٔ سایت ZIP</span><input type="file" accept=".zip,application/zip" data-testid="site-kit-archive" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void inspectKitArchive(file); }} /></label>
							{archiveKit ? <><p>{archiveKit.summary.name} · نسخهٔ {archiveKit.summary.version} · {archiveKit.summary.assetCount.toLocaleString('fa-IR')} تصویر</p><ul>{archiveKit.summary.pages.map((page) => <li key={page.suffix}>{page.title} · <bdi>{page.suffix}</bdi></li>)}</ul><label className="builder-field"><span>پیشوند بستهٔ ZIP</span><input dir="ltr" value={archivePrefix} maxLength={50} onChange={(event) => setArchivePrefix(event.target.value)} /></label><button type="button" disabled={kitBusy || !archivePrefix.trim()} onClick={() => void applyKitArchive('install')}>نصب بستهٔ ZIP</button> <button type="button" disabled={kitBusy || !archivePrefix.trim()} onClick={() => void applyKitArchive('update')}>به‌روزرسانی بستهٔ ZIP</button></> : null}
							{archiveStatus ? <p role="status">{archiveStatus}</p> : null}
						</details>
						<details className="builder-kit-panel"><summary>بخش‌های مشترک</summary>
							<p>هر صفحه یک تصویر ذخیره‌شده دارد. به‌روزرسانی منبع فقط با همگام‌سازی صریح به پیش‌نویس‌های بدون تعارض می‌رسد.</p>
							{sharedSections.length ? <ul>{sharedSections.map((section) => <li key={section.id}>{section.name} · نسخهٔ {section.revision} <button type="button" disabled={sharedBusy || templateActionBusy} onClick={() => void insertShared(section)}>درج بخش مشترک</button> <button type="button" disabled={sharedBusy || templateActionBusy} onClick={() => void syncShared(section)}>همگام‌سازی پیش‌نویس‌ها</button></li>)}</ul> : <p>بخش مشترکی ثبت نشده است.</p>}
						</details>
							</div>
						</div>
						<footer className="builder-modal__footer"><button type="button" onClick={() => { closeTemplateLibrary(); setSaveSelectedSection(false); setTemplateSaveOpen(true); }}>ذخیرهٔ صفحهٔ فعلی به‌عنوان قالب</button><button type="button" onClick={closeTemplateLibrary}>بستن</button></footer>
					</section>
				</div>
			) : null}
			{kitReview ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !kitBusy) setKitReview(null); }}>
					<section className="builder-modal builder-kit-review" role="dialog" aria-modal="true" aria-labelledby="builder-kit-review-title" data-testid="kit-review">
						<header className="builder-modal__header"><div><h2 id="builder-kit-review-title">بررسی تعارض بسته</h2><p>مقایسهٔ نسخهٔ پایه، پیش‌نویس محلی و بستهٔ تازه؛ هنوز چیزی تغییر نکرده است.</p></div><button type="button" aria-label="بستن" disabled={kitBusy} onClick={() => setKitReview(null)}>×</button></header>
						<div className="builder-kit-review__content">
							<p>تغییرهای مستقل به‌صورت خودکار ادغام می‌شوند. برای هر تعارض یکی از مقدارهای کامل را انتخاب کنید؛ انتشار تغییر نمی‌کند.</p>
							{!kitReview.review.fields.length && !kitReview.review.unresolved.length && !kitReview.review.truncated ? <p>تعارضی پیدا نشد؛ به‌روزرسانی آمادهٔ تأیید است.</p> : null}
							{kitReview.review.fields.map((field, index) => <fieldset key={`${field.slug}:${field.path}`} className="builder-kit-review__field" data-testid="kit-review-field">
								<legend><bdi>{field.slug}</bdi> · <bdi dir="ltr">{field.path}</bdi></legend>
								{field.kind === 'structural' ? <p>انتخاب، کل مؤلفه یا مورد نمایش‌داده‌شده را جایگزین می‌کند؛ حالت دیگر حفظ نمی‌شود.</p> : field.kind === 'formatted' ? <p>متن، قالب‌بندی و پیوندهای آن با هم انتخاب می‌شوند.</p> : field.kind === 'order' ? <p>ترتیب انتخابی اولویت دارد؛ موارد مستقل هر دو طرف حفظ می‌شوند.</p> : null}
								<div className="builder-kit-review__values"><div><strong>پایه</strong><pre>{field.base}</pre></div><div><strong>محلی</strong><pre>{field.local}</pre></div><div><strong>بستهٔ تازه</strong><pre>{field.incoming}</pre></div></div>
								<label><input type="radio" name={`kit-choice-${index}`} checked={kitReview.choices[index] === 'local'} onChange={() => setKitReview((current) => current ? { ...current, choices: current.choices.map((choice, i) => i === index ? 'local' : choice) } : current)} /> حفظ مقدار محلی</label>{' '}
								<label><input type="radio" name={`kit-choice-${index}`} checked={kitReview.choices[index] === 'incoming'} onChange={() => setKitReview((current) => current ? { ...current, choices: current.choices.map((choice, i) => i === index ? 'incoming' : choice) } : current)} /> استفاده از مقدار بسته</label>
							</fieldset>)}
							{kitReview.review.unresolved.length || kitReview.review.truncated ? <div role="alert"><p>تعارض بزرگ یا بررسی‌نشده باید در صفحه دستی برطرف شود؛ هیچ گزینه‌ای محتوای پنهان را حذف نمی‌کند.</p><ul>{kitReview.review.unresolved.map((item, index) => <li key={index}><bdi>{item.slug}</bdi> · <bdi dir="ltr">{item.path}</bdi></li>)}</ul>{kitReview.review.truncated ? <p>تعداد تعارض‌ها از حد بررسی بیشتر است.</p> : null}</div> : null}
							{kitReview.error ? <p role="alert">{kitReview.error}</p> : null}
						</div>
						<footer className="builder-modal__footer"><button type="button" disabled={kitBusy} onClick={() => setKitReview(null)}>انصراف</button><button type="button" className="builder-toolbar-button--publish" disabled={kitBusy || kitReview.review.truncated || Boolean(kitReview.review.unresolved.length) || kitReview.choices.some((choice) => !choice)} onClick={() => void submitKitReview()}>تأیید و به‌روزرسانی پیش‌نویس‌ها</button></footer>
					</section>
				</div>
			) : null}
			{templatePreview ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTemplatePreview(); }}>
					<section className="builder-modal builder-elementor-dialog" role="dialog" aria-modal="true" aria-labelledby="builder-template-preview-title">
						<header className="builder-modal__header"><h2 id="builder-template-preview-title">پیش‌نمایش {templatePreview.name}</h2><button type="button" aria-label="بستن" onClick={closeTemplatePreview}>×</button></header>
						<div className="builder-elementor-report builder-elementor-preview" onClick={(event) => { if ((event.target as HTMLElement).closest('a')) event.preventDefault(); }}><DocumentPreview document={templatePreview.document} viewport={viewport} />{templateError ? <p className="builder-template-error" role="alert">{templateError}</p> : null}</div>
						<footer className="builder-modal__footer"><button type="button" onClick={closeTemplatePreview}>بستن</button>{templatePreview.item && <button type="button" className="builder-toolbar-button--publish" disabled={templateActionBusy} onClick={() => void insertTemplate(templatePreview.item!)}>{templatePreview.item.kind === 'section' ? 'افزودن این بخش' : 'افزودن رونوشت'}</button>}</footer>
					</section>
				</div>
			) : null}
			{sharedCreateTarget ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSharedCreateTarget(null); }}>
					<form className="builder-modal builder-modal--small" role="dialog" aria-modal="true" aria-labelledby="builder-shared-title" onSubmit={(event) => { event.preventDefault(); void createShared(); }}>
						<header className="builder-modal__header"><div><h2 id="builder-shared-title">ساخت بخش مشترک</h2><p>منبع مستقل ذخیره می‌شود و انتخاب فعلی به آن پیوند می‌خورد.</p></div><button type="button" aria-label="بستن" onClick={() => setSharedCreateTarget(null)}>×</button></header>
						<label className="builder-field"><span>نام بخش مشترک</span><input autoFocus required maxLength={60} value={sharedName} onChange={(event) => setSharedName(event.target.value)} /></label>
						<footer className="builder-modal__footer"><button type="button" onClick={() => setSharedCreateTarget(null)}>انصراف</button><button type="submit" disabled={sharedBusy || !sharedName.trim()}>ساخت و پیوند بخش</button></footer>
					</form>
				</div>
			) : null}
			{templateSaveOpen ? (
				<div className="builder-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplateSaveOpen(false); }}>
					<form className="builder-modal builder-modal--small" role="dialog" aria-modal="true" aria-labelledby="builder-save-template-title" onSubmit={(event) => { event.preventDefault(); void saveAsTemplate(); }}>
						<header className="builder-modal__header"><div><h2 id="builder-save-template-title">{saveSelectedSection ? 'ذخیرهٔ بخش انتخاب‌شده' : 'ذخیرهٔ قالب'}</h2><p>یک رونوشت مستقل برای استفاده در صفحه‌های دیگر نگهداری می‌شود.</p></div><button type="button" aria-label="بستن" onClick={() => setTemplateSaveOpen(false)}>×</button></header>
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
										<span>{item.name}</span>{item.width && item.height ? <small dir="ltr">{item.width} × {item.height} · {item.mimeType}</small> : null}{item.builtin ? <small>همراه قالب</small> : null}
									</button>
								))}
							</div>
						) : mediaError ? null : <p className="builder-template-empty" role="status">تصویر قابل‌استفاده‌ای در کتابخانه نیست.</p>}
						<footer className="builder-modal__footer">
							{canUploadMedia ? <label><input type="checkbox" checked={mediaDeduplicate} onChange={(event) => setMediaDeduplicate(event.target.checked)} /> استفاده از فایل یکسان موجود</label> : null}
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
			{previewOpen ? (
				<div className="builder-preview-backdrop" onClick={() => setPreviewOpen(false)}>
					<div className="builder-preview-modal" role="dialog" aria-modal="true" aria-labelledby="builder-preview-title" onClick={(event) => event.stopPropagation()}>
						<div className="builder-preview-modal__header">
							<h2 id="builder-preview-title">پیش‌نمایش تغییرات فعلی</h2><p>این پیش‌نمایش سند فعلی، از جمله تغییرات ذخیره‌نشده را نشان می‌دهد؛ انتشار انجام نمی‌شود.</p>
							<button type="button" onClick={() => setPreviewOpen(false)} aria-label="بستن پیش‌نمایش">×</button>
						</div>
						<div className="builder-preview-modal__frame">
							<DocumentPreview document={document} viewport={viewport} />
						</div>
					</div>
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
	dragOverId: string | null;
	dragPlacement: MovePlacement;
	onSelect: (id: string) => void;
	onDragStart: (event: DragEvent<HTMLElement>, id: string) => void;
	onDragOver: (event: DragEvent<HTMLElement>, node: BuilderNode) => void;
	onDragOut: () => void;
	onDrop: (event: DragEvent<HTMLElement>, node: BuilderNode) => void;
}

function componentIcon(type: BuilderComponentType): string {
	return type === 'Container' ? '▦' : type === 'Heading' ? 'T' : type === 'Text' ? '¶' : type === 'Image' ? '▧' : type === 'ProductGrid' ? '▣' : type === 'InquiryForm' ? '✉' : type === 'Spacer' ? '↕' : type === 'Divider' ? '―' : type === 'Blockquote' ? '❞' : type === 'Accordion' ? '☰' : type === 'ImageGallery' ? '▤' : type === 'VideoEmbed' ? '▶' : '↗';
}

function TreeNode({ node, selectedId, dragOverId, dragPlacement, onSelect, onDragStart, onDragOver, onDragOut, onDrop }: TreeNodeProps) {
	const [expanded, setExpanded] = useState(true);
	useEffect(() => {
		if (selectedId && node.type === 'Container' && findNode(node.children, selectedId)) setExpanded(true);
	}, [selectedId, node]);
	const label = getComponentDefinition(node.type).label;
	const details = node.type === 'Heading' ? node.props.text
		: node.type === 'Text' ? node.props.text
			: node.type === 'Button' ? node.props.label
				: node.type === 'Image' ? node.props.alt || node.props.src || 'بدون تصویر'
				: node.type === 'ProductGrid' ? `محصولات ${node.props.binding.selection}`
				: node.type === 'InquiryForm' ? node.props.title
				: node.type === 'PluginBlock' ? node.props.label
				: node.type === 'Spacer' ? `${node.props.size}px`
				: node.type === 'Divider' ? node.props.lineStyle
				: node.type === 'Blockquote' ? node.props.text
				: node.type === 'Accordion' || node.type === 'Tabs' || node.type === 'List' || node.type === 'ImageGallery' ? `${node.props.items.length} مورد`
				: node.type === 'VideoEmbed' || node.type === 'CodeWidget' || node.type === 'GlobalCode' ? node.props.title
				: `${node.children.length} فرزند${node.sharedSection ? ` · مشترک v${node.sharedSection.revision}` : ''}`;
	const isDropTarget = dragOverId === node.id;
	return (
		<div className="builder-tree-node" role="listitem">
			<div className="builder-tree-node__line">
			{node.type === 'Container' && node.children.length ? <button className="builder-tree-node__expand" type="button" aria-expanded={expanded} aria-label={expanded ? `بستن ${label}` : `باز کردن ${label}`} onClick={() => setExpanded(!expanded)}>{expanded ? '⌄' : '‹'}</button> : <span className="builder-tree-node__expand-spacer" />}
			<button
				className={`builder-tree-node__row${selectedId === node.id ? ' is-selected' : ''}${isDropTarget ? ` is-drag-over is-drop-${dragPlacement}` : ''}`}
				data-testid="tree-node"
				data-node-id={node.id}
				aria-pressed={selectedId === node.id}
				type="button"
				draggable
				onClick={() => onSelect(node.id)}
				onDragStart={(event) => { event.stopPropagation(); onDragStart(event, node.id); }}
				onDragEnd={onDragOut}
				onDragOver={(event) => onDragOver(event, node)}
				onDragLeave={onDragOut}
				onDrop={(event) => { onDragOut(); onDrop(event, node); }}
			>
				<span className="builder-tree-node__type">{componentIcon(node.type)}</span>
				<span className="builder-tree-node__label"><strong>{label}</strong><small>{details || 'بدون متن'}</small></span>
			</button>
			</div>
			{node.type === 'Container' && node.children.length && expanded ? (
				<div className="builder-tree-node__children" role="list">
					{node.children.map((child) => <TreeNode key={child.id} node={child} selectedId={selectedId} dragOverId={dragOverId} dragPlacement={dragPlacement} onSelect={onSelect} onDragStart={onDragStart} onDragOver={onDragOver} onDragOut={onDragOut} onDrop={onDrop} />)}
				</div>
			) : null}
		</div>
	);
}

interface BreadcrumbProps {
	path: BuilderNode[];
	onSelect: (id: string) => void;
}

function Breadcrumb({ path, onSelect }: BreadcrumbProps) {
	return (
		<div className="builder-breadcrumb" aria-label="مسیر انتخاب">
			{path.map((node, index) => {
				const isLast = index === path.length - 1;
				const definition = getComponentDefinition(node.type);
				let label = definition.label;
				if (isLast) {
					if (node.type === 'Heading' || node.type === 'Text') {
						label = node.props.text;
					} else if (node.type === 'Button') {
						label = node.props.label;
					}
				}
				return (
					<button
						key={node.id}
						type="button"
						className={`builder-breadcrumb__item${isLast ? ' is-current' : ''}`}
						onClick={() => onSelect(node.id)}
						aria-current={isLast ? 'true' : undefined}
					>
						{index > 0 && <span className="builder-breadcrumb__separator">›</span>}
						<span className="builder-breadcrumb__label">{label}</span>
					</button>
				);
			})}
		</div>
	);
}

interface PreviewNodeProps {
	document: PageDocument;
	node: BuilderNode;
	selectedId: string | null;
	dragOverId: string | null;
	dragPlacement: MovePlacement;
	viewport: Breakpoint;
	onSelect: (id: string) => void;
	onInlineEdit: (id: string, value: string) => void;
	onDragStart: (event: DragEvent<HTMLElement>, id: string) => void;
	onDragOver: (event: DragEvent<HTMLElement>, node: BuilderNode) => void;
	onDragOut: () => void;
	onDrop: (event: DragEvent<HTMLElement>, node: BuilderNode) => void;
}

function PreviewNode({ document, node, selectedId, dragOverId, dragPlacement, viewport, onSelect, onInlineEdit, onDragStart, onDragOver, onDragOut, onDrop }: PreviewNodeProps) {
	const selected = node.id === selectedId;
	const style = previewStyle(node, viewport, document);
	const hidden = hiddenAtBreakpoint(node, viewport);
	const isDropTarget = dragOverId === node.id;
	const className = `builder-preview-node${selected ? ' builder-preview-node--selected' : ''}${hidden ? ' builder-preview-node--hidden' : ''}${isDropTarget ? ` builder-preview-node--drag-over builder-preview-node--drop-${dragPlacement}` : ''}`;
	const onClick = (event: ReactMouseEvent<HTMLElement>) => { event.stopPropagation(); onSelect(node.id); };
const responsiveBadge = hasResponsiveOverrides(node) ? (
	<span className="builder-responsive-badge" title="استایل‌های واکنش‌گرا سفارشی در این اندازه" aria-label="تغییرات استایل واکنش‌گرا">R</span>
) : null;

const dragProps = {
	draggable: true,
	onDragStart: (event: DragEvent<HTMLElement>) => { event.stopPropagation(); onDragStart(event, node.id); },
	onDragOver: (event: DragEvent<HTMLElement>) => onDragOver(event, node),
	onDragEnd: () => onDragOut(),
	onDragLeave: () => onDragOut(),
	onDrop: (event: DragEvent<HTMLElement>) => { onDragOut(); onDrop(event, node) },
};
if (hidden) {
	return <div className={`${className} builder-preview-node--hidden-placeholder`} data-builder-id={node.id} onClick={onClick} {...dragProps}>{responsiveBadge}در این اندازه پنهان است · {getComponentDefinition(node.type).label}</div>;
}
if (node.type === 'Container') {
	return (
		<div className={`${className} nvx-builder-node nvx-builder-container nvx-builder-container--${node.props.background}`} data-builder-id={node.id} data-layout={node.props.layout} data-max-width={node.props.maxWidth} onClick={onClick} style={{ gap: node.props.gap, padding: node.props.padding, ...style }} {...dragProps}>
			{responsiveBadge}
			{node.children.length ? node.children.map((child) => <PreviewNode key={child.id} document={document} node={child} selectedId={selectedId} dragOverId={dragOverId} dragPlacement={dragPlacement} viewport={viewport} onSelect={onSelect} onInlineEdit={onInlineEdit} onDragStart={onDragStart} onDragOver={onDragOver} onDragOut={onDragOut} onDrop={onDrop} />) : <div className="builder-container-empty">برای افزودن فرزند، یک مؤلفه را از ستون ساختار انتخاب کنید.</div>}
		</div>
		);
	}
if (node.type === 'Heading') {
	const tag = `h${node.props.level}` as 'h1' | 'h2' | 'h3' | 'h4';
	return (
		<div className={className} data-builder-id={node.id} onClick={onClick} {...dragProps}>
			{responsiveBadge}
			<InlineEditableText
					as={tag}
					className={`nvx-builder-node nvx-builder-heading nvx-builder-heading--${node.props.size} nvx-builder-color--${node.props.color}`}
					value={node.props.text}
					marks={node.props.marks}
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
			{responsiveBadge}
			<InlineEditableText
				as="p"
					className={`nvx-builder-node nvx-builder-text nvx-builder-text--${node.props.size} nvx-builder-color--${node.props.color}`}
					value={node.props.text}
					marks={node.props.marks}
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
			{responsiveBadge}
			<figure className="nvx-builder-node nvx-builder-image">
					<div className="nvx-builder-image__frame" data-aspect={node.props.aspectRatio} data-fit={node.props.fit}>
						{node.props.src ? <PreviewImage src={resolveBuilderImageSource(node.props.src)} alt={node.props.alt} /> : <div className="nvx-builder-image__empty" role="img" aria-label={node.props.alt || 'تصویر در دسترس نیست'}>تصویر انتخاب نشده است</div>}
					</div>
					{node.props.caption ? <figcaption className="nvx-builder-image__caption">{node.props.caption}</figcaption> : null}
				</figure>
			</div>
		);
	}
if (node.type === 'Spacer') {
	return <div className={`${className} nvx-builder-node nvx-builder-spacer`} data-builder-id={node.id} onClick={onClick} style={{ height: node.props.size, ...style }} {...dragProps}>{responsiveBadge}</div>;
}
if (node.type === 'Divider') {
	return <div className={className} data-builder-id={node.id} onClick={onClick} {...dragProps}>{responsiveBadge}<hr className={`nvx-builder-node nvx-builder-divider nvx-builder-divider--${node.props.color}`} style={{ borderTopWidth: node.props.thickness, borderTopStyle: node.props.lineStyle, ...style }} /></div>;
}
if (isExtendedContentNode(node)) {
	return <div className={`${className} nvx-builder-node nvx-builder-extended nvx-builder-extended--${node.type}`} data-builder-id={node.id} onClick={onClick} style={style} {...dragProps}>{responsiveBadge}<ExtendedContent node={node} /></div>;
}
if (node.type === 'CodeWidget') {
	return <div className={className} data-builder-id={node.id} onClick={onClick} style={style} {...dragProps}>{responsiveBadge}<CodeWidgetPreview props={node.props} /></div>;
}
if (node.type === 'GlobalCode') {
	return <div className={className} data-builder-id={node.id} onClick={onClick} {...dragProps}><strong>{node.props.title}</strong><p>کد صفحه در ویرایشگر اجرا نمی‌شود. فقط مدیر پس از بازبینی می‌تواند آن را منتشر کند.</p></div>;
}
if (node.type === 'PluginBlock') {
	return <div className={className} data-builder-id={node.id} onClick={onClick} style={style} {...dragProps}>{responsiveBadge}<PluginBlockPreview props={node.props} /></div>;
}
if (node.type === 'InquiryForm') {
	return <div className={className} data-builder-id={node.id} onClick={onClick} style={style} {...dragProps}>{responsiveBadge}<InquiryFormPreview node={node} /></div>;
}
if (node.type === 'ProductGrid') {
	return (
		<div className={className} data-builder-id={node.id} onClick={onClick} style={style} {...dragProps}>
			{responsiveBadge}
			<ProductGridPreview node={node} />
			</div>
		);
	}
	return (
		<div className={className} data-builder-id={node.id} onClick={onClick} style={style} {...dragProps}>
			{responsiveBadge}
			<div className="nvx-builder-button-wrap" data-align={node.props.align}>
				<a className={`nvx-builder-button nvx-builder-button--${node.props.variant}`} href={node.props.href} onClick={(event) => event.preventDefault()}>{node.props.label || 'دکمه'}</a>
			</div>
		</div>
	);
}

function InquiryFormPreview({ node }: { node: Extract<BuilderNode, { type: 'InquiryForm' }> }) {
	return <section className="nvx-inquiry" aria-label={node.props.title}>
		<h2>{node.props.title}</h2>{node.props.description && <p>{node.props.description}</p>}
		<p className="nvx-inquiry__notice">پیش‌نمایش فرم؛ ارسال پس از انتشار و راه‌اندازی سرویس فعال می‌شود.</p>
		<fieldset disabled><label>نام<input type="text" /></label><label>ایمیل یا شمارهٔ تماس<input type="text" /></label><label>پیام<textarea rows={3} /></label><button type="button" className="nvx-builder-button nvx-builder-button--primary">{node.props.buttonLabel}</button></fieldset>
	</section>;
}

function PluginBlockPreview({ props }: { props: PluginBlockProps }) {
	return <div className="nvx-builder-plugin">{resolvePluginParts(props).map((part, index) => part.type === 'heading' ? <h2 className="nvx-builder-node nvx-builder-heading nvx-builder-heading--md nvx-builder-color--ink" key={index}>{part.text}</h2> : part.type === 'text' ? <p className="nvx-builder-node nvx-builder-text nvx-builder-text--md nvx-builder-color--ink" key={index}>{part.text}</p> : <div className="nvx-builder-button-wrap" key={index}><a className="nvx-builder-button nvx-builder-button--outline" href={part.href} onClick={(event) => event.preventDefault()}>{part.text}</a></div>)}</div>;
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
	marks?: TextMark[];
	align?: string;
	style?: CSSProperties;
	label: string;
	onActivate: () => void;
	onCommit: (value: string) => void;
}

function InlineEditableText({ as, className, value, marks, align, style, label, onActivate, onCommit }: InlineEditableTextProps) {
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
	}, !editing && marks?.length ? createElement(RichTextRuns, { text: value, marks }) : value);
}

interface InspectorProps {
	document: PageDocument;
	mode: 'simple' | 'pro';
	node: BuilderNode;
	viewport: Breakpoint;
	canMoveUp: boolean;
	canMoveDown: boolean;
	onField: (field: InspectorField, value: unknown, historyKey?: string) => void;
	onHidden: (hidden: boolean) => void;
	onMove: (direction: -1 | 1) => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onDeselect: () => void;
	canReadMedia: boolean;
	onPickMedia: (itemId?: string) => void;
}

function Inspector({ document, node, mode, viewport, canMoveUp, canMoveDown, onField, onHidden, onMove, onDuplicate, onDelete, onDeselect, canReadMedia, onPickMedia }: InspectorProps) {
	const definition = getComponentDefinition(node.type);
	const viewportLabel = breakpointRanges(document).find((range) => range.id === viewport)?.label ?? viewport;
	const pluginFields: InspectorField[] = node.type === 'PluginBlock' ? node.props.fields.map((field) => ({ key: `plugin.${field.key}`, label: field.label, kind: field.kind, maxLength: field.maxLength, group: 'content' })) : [];
	const groups: Array<{ key: InspectorField['group']; label: string }> = [
		{ key: 'content', label: 'محتوا' },
		{ key: 'layout', label: 'چیدمان' },
		{ key: 'style', label: 'نمایش' },
	];
	return (
		<div className="builder-inspector">
			<div className="builder-panel__heading builder-panel__heading--inspector">
				<div><span className="builder-inspector__eyebrow">تنظیمات {viewportLabel}</span><h2>{node.type === 'PluginBlock' ? node.props.label : definition.label}</h2></div>
				<div className="builder-inspector__heading-actions"><span className="builder-inspector__type">{node.type}</span><button className="builder-icon-button" type="button" aria-label="پاک‌کردن انتخاب" title="پاک‌کردن انتخاب" onClick={onDeselect}>×</button></div>
			</div>
			<div className="builder-inspector__body">
				{groups.map((group) => {
					const fields = [...pluginFields, ...definition.fields].filter((field) =>
						field.group === group.key &&
						fieldVisibleInMode(field, mode) &&
						!(node.type === 'ProductGrid' && field.key === 'binding.category' && node.props.binding.selection !== 'category') &&
						!(node.type === 'VideoEmbed' && ((field.key === 'youtubeId' && node.props.provider !== 'youtube') || (field.key === 'vimeoId' && node.props.provider !== 'vimeo'))),
					);
					if (!fields.length) return null;
					return <section className="builder-field-group" key={group.key}><h3>{group.label}</h3>{fields.map((field) => (
						<div className={node.type === 'Image' && field.key === 'src' ? 'builder-field-with-action' : undefined} key={`${node.id}-${field.key}-${field.kind}`}>
							<InspectorControl field={field} value={fieldValue(node, field, viewport)} onChange={(value, historyKey) => onField(field, value, historyKey)} canReadMedia={canReadMedia} onPickMedia={onPickMedia} />
							{field.key.startsWith('styles.') && viewport !== 'desktop' && explicitNodeStyle(node, viewport, field.key.slice('styles.'.length) as keyof NodeStyles) === undefined ? <p className="builder-field-hint">ارث‌بری: {String(resolveNodeStyle(node, viewport, field.key.slice('styles.'.length) as keyof NodeStyles, document) ?? 'پیش‌فرض')}</p> : null}
							{node.type === 'Image' && field.key === 'src' ? <button className="builder-media-picker-trigger" type="button" data-testid="open-media-picker" disabled={!canReadMedia} title={canReadMedia ? 'انتخاب از کتابخانهٔ رسانه' : 'نقش شما اجازهٔ خواندن رسانه را ندارد'} onClick={() => onPickMedia()}>انتخاب از کتابخانهٔ رسانه</button> : null}
						</div>
					))}</section>;
				})}
				{mode === 'pro' && node.type !== 'GlobalCode' ? <section className="builder-field-group builder-responsive-group">
					<h3>واکنش‌گرا</h3>
					<label className="builder-toggle-row"><span><strong>پنهان در {viewportLabel}</strong><small>فقط در پیش‌نمایش این اندازه</small></span><input type="checkbox" checked={Boolean(node.responsiveStyles?.[viewport]?.hidden)} onChange={(event) => onHidden(event.target.checked)} /></label>
					<p>تغییرات عرض و فاصله در اندازهٔ انتخاب‌شده به‌صورت مقدار واکنش‌گرا ذخیره می‌شوند.</p>
				</section> : null}
				{mode === 'pro' ? <section className="builder-component-help"><strong>{definition.documentation}</strong><span>نمونه: {definition.example}</span></section> : null}
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
	onChange: (value: unknown, historyKey?: string) => void;
	canReadMedia: boolean;
	onPickMedia: (itemId?: string) => void;
}

function InspectorControl(props: InspectorControlProps) {
	if (props.field.kind === 'rich-text') return <RichTextFields value={props.value as RichTextFieldValue} onChange={props.onChange} label={props.field.label} maxLength={props.field.maxLength ?? 5000} />;
	if (props.field.kind === 'accordion-items') return <AccordionFields items={props.value as AccordionItem[]} onChange={props.onChange} />;
	if (props.field.kind === 'tab-items') return <TabsFields items={props.value as AccordionItem[]} onChange={props.onChange} />;
	if (props.field.kind === 'list-items') return <ListFields items={props.value as ListItem[]} onChange={props.onChange} />;
	if (props.field.kind === 'gallery-items') return <GalleryFields items={props.value as GalleryItem[]} onChange={props.onChange} canReadMedia={props.canReadMedia} onPickMedia={props.onPickMedia} />;
	return <ScalarInspectorControl {...props} />;
}

function ScalarInspectorControl({ field, value, onChange }: InspectorControlProps) {
	const draftKey = `${field.key}:${String(value ?? '')}`;
	const [draft, setDraft] = useState<string>(() => String(value ?? ''));
	useEffect(() => setDraft(String(value ?? '')), [draftKey]);
	const id = `builder-field-${field.key.replace(/[^a-z0-9-]/gi, '-')}${field.kind === 'length' && field.key === 'styles.width' ? '-length' : ''}`;
	const control = field.kind === 'select' || (field.kind === 'number' && field.options) ? (
		<select id={id} value={String(value ?? '')} onChange={(event) => {
			const raw = event.target.value;
			if (raw === '') { onChange(''); return; }
			const option = field.options?.find((item) => String(item.value) === raw);
			onChange(option?.value ?? raw);
		}}>
			{value !== undefined && value !== '' && !field.options?.some((option) => String(option.value) === String(value)) ? <option value={String(value)}>{String(value)}</option> : null}
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
				if (field.kind === 'url' || field.kind === 'length' || field.kind === 'identifier') return;
				if (field.kind === 'number') onChange(Number(next));
				else onChange(next);
			}}
			onBlur={() => { if (field.kind === 'url' || field.kind === 'length' || field.kind === 'identifier') onChange(draft); }}
			onKeyDown={(event) => { if ((field.kind === 'length' || field.kind === 'identifier') && event.key === 'Enter') event.currentTarget.blur(); }}
		/>
	);
	return <label className="builder-field" htmlFor={id}><span>{field.label}</span>{control}</label>;
}

interface PageInspectorProps {
	document: PageDocument;
	onDescription: (value: string) => void;
	onTheme: (themeId: BuilderThemeId) => void;
	onBreakpoints: (breakpoints: BreakpointWidths | undefined) => boolean;
	onRemoveBreakpoint: (id: CustomBreakpointId) => boolean;
}

function PageInspector({ document, onDescription, onTheme, onBreakpoints, onRemoveBreakpoint }: PageInspectorProps) {
	const [descriptionDraft, setDescriptionDraft] = useState(document.description);
	useEffect(() => setDescriptionDraft(document.description), [document.description]);
	const widths = breakpointWidths(document);
	const [mobileDraft, setMobileDraft] = useState(String(widths.mobile));
	const [tabletDraft, setTabletDraft] = useState(String(widths.tablet));
	const [breakpointError, setBreakpointError] = useState('');
	const [customLabel, setCustomLabel] = useState('');
	const [customWidth, setCustomWidth] = useState('1200');
	useEffect(() => { setMobileDraft(String(widths.mobile)); setTabletDraft(String(widths.tablet)); }, [widths.mobile, widths.tablet]);
	function commitWidth(key: 'mobile' | 'tablet', raw: string) {
		const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
		const next = { ...widths, [key]: value };
		if (!onBreakpoints(next)) {
			setBreakpointError('عرض‌ها باید عدد صحیح باشند؛ موبایل ۳۲۰ تا ۱۵۳۵ و تبلت ۶۴۰ تا ۱۹۲۰ پیکسل و بزرگ‌تر از موبایل.');
			if (key === 'mobile') setMobileDraft(String(widths.mobile)); else setTabletDraft(String(widths.tablet));
			return;
		}
		setBreakpointError('');
	}
	function updateCustom(id: CustomBreakpointId, patch: { label?: string; maxWidth?: number }): boolean {
		const next = { ...widths, custom: (widths.custom ?? []).map((entry) => entry.id === id ? { ...entry, ...patch } : entry) };
		if (!onBreakpoints(next)) { setBreakpointError('نام و عرض باید معتبر و عرض‌ها یکتا باشند (۲۴۰ تا ۲۵۶۰ پیکسل).'); return false; }
		setBreakpointError(''); return true;
	}
	function addCustom() {
		const id = `bp_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}` as CustomBreakpointId;
		const next = { ...widths, custom: [...(widths.custom ?? []), { id, label: customLabel, maxWidth: /^\d+$/.test(customWidth) ? Number(customWidth) : NaN }] };
		if (!onBreakpoints(next)) { setBreakpointError('نام و عرض باید معتبر و عرض‌ها یکتا باشند (۲۴۰ تا ۲۵۶۰ پیکسل).'); return; }
		setCustomLabel(''); setBreakpointError('');
	}
	return (
		<div className="builder-inspector">
			<div className="builder-panel__heading builder-panel__heading--inspector"><div><span className="builder-inspector__eyebrow">تنظیمات سند</span><h2>صفحه</h2></div><span className="builder-inspector__type">صفحه</span></div>
			<div className="builder-inspector__body">
				<section className="builder-field-group"><h3>فراداده</h3>
					<label className="builder-field"><span>نامک</span><input dir="ltr" value={document.slug} readOnly /></label>
					<label className="builder-field"><span>تم طراحی</span><select value={document.themeId} onChange={(event) => onTheme(event.target.value as BuilderThemeId)}>{BUILDER_THEME_LIST.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}</select></label>
					<label className="builder-field"><span>توضیحات</span><textarea value={descriptionDraft} maxLength={200} rows={5} placeholder="توضیح کوتاهی برای موتورهای جست‌وجو…" onChange={(event) => { setDescriptionDraft(event.target.value); onDescription(event.target.value); }} /></label>
					<p className="builder-field-hint">عنوان صفحه را از نوار بالا ویرایش کنید. توضیحات حداکثر ۲۰۰ نویسه است.</p>
				</section>
				<section className="builder-field-group"><h3>نقاط شکست</h3>
					<label className="builder-field"><span>حداکثر عرض موبایل (px)</span><input dir="ltr" type="number" min={320} max={1535} step={1} value={mobileDraft} onChange={(event) => setMobileDraft(event.target.value)} onBlur={() => commitWidth('mobile', mobileDraft)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
					<label className="builder-field"><span>حداکثر عرض تبلت (px)</span><input dir="ltr" type="number" min={640} max={1920} step={1} value={tabletDraft} onChange={(event) => setTabletDraft(event.target.value)} onBlur={() => commitWidth('tablet', tabletDraft)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
					{breakpointError ? <p role="alert">{breakpointError}</p> : null}
					<button className="builder-inline-action" type="button" onClick={() => { if (onBreakpoints(widths.custom?.length ? { ...BREAKPOINT_MAX_WIDTH, custom: widths.custom } : undefined)) setBreakpointError(''); }}>بازگردانی عرض‌های پیش‌فرض</button>
					{(widths.custom ?? []).map((entry) => <div className="builder-field-group" key={entry.id} data-testid={`breakpoint-${entry.id}`}>
						<label className="builder-field"><span>نام اندازهٔ سفارشی</span><input key={entry.label} defaultValue={entry.label} maxLength={40} onBlur={(event) => { if (!updateCustom(entry.id, { label: event.currentTarget.value })) event.currentTarget.value = entry.label; }} /></label>
						<label className="builder-field"><span>حداکثر عرض سفارشی (px)</span><input key={entry.maxWidth} dir="ltr" type="number" min={240} max={2560} defaultValue={entry.maxWidth} onBlur={(event) => { if (!updateCustom(entry.id, { maxWidth: Number(event.currentTarget.value) })) event.currentTarget.value = String(entry.maxWidth); }} /></label>
						<button className="builder-inline-action builder-inline-action--danger" type="button" onClick={() => { if (window.confirm('این اندازه و همهٔ مقادیر واکنش‌گرای مربوط به آن از صفحه حذف می‌شوند. این تغییر قابل واگرد است. ادامه می‌دهید؟') && onRemoveBreakpoint(entry.id)) setBreakpointError(''); }}>حذف اندازهٔ سفارشی</button>
					</div>)}
					<label className="builder-field"><span>نام اندازهٔ تازه</span><input value={customLabel} maxLength={40} onChange={(event) => setCustomLabel(event.target.value)} /></label>
					<label className="builder-field"><span>عرض اندازهٔ تازه (px)</span><input dir="ltr" type="number" min={240} max={2560} value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} /></label>
					<button className="builder-inline-action" type="button" data-testid="add-breakpoint" disabled={(widths.custom?.length ?? 0) >= MAX_CUSTOM_BREAKPOINTS} onClick={addCustom}>افزودن اندازهٔ سفارشی</button>
					<p className="builder-field-hint">اندازه‌ها از عرض بزرگ‌تر به کوچک‌تر ارث می‌برند. حذف اندازه، مقادیر همان اندازه را با تأیید حذف می‌کند.</p>
				</section>
				<section className="builder-field-group"><h3>سند</h3><p className="builder-field-hint">نسخهٔ طرحوارهٔ {document.schemaVersion} · {countNodes(document.nodes).toLocaleString('fa-IR')} مؤلفه</p></section>
			</div>
		</div>
	);
}

function isMobileRange(document: PageDocument, viewport: Breakpoint): boolean {
	const selected = breakpointRanges(document).find((range) => range.id === viewport);
	return selected?.maxWidth != null && selected.maxWidth <= breakpointWidths(document).mobile;
}

function previewWidth(document: PageDocument, viewport: Breakpoint): number {
	const ranges = breakpointRanges(document);
	const index = ranges.findIndex((entry) => entry.id === viewport);
	if (index <= 0) return Math.max(1140, (ranges[1]?.maxWidth ?? 1023) + 1);
	const maximum = ranges[index].maxWidth!;
	const lower = ranges[index + 1]?.maxWidth ?? 0;
	const preferred = viewport === 'mobile' ? 390 : viewport === 'tablet' ? 768 : maximum;
	return Math.max(lower + 1, Math.min(preferred, maximum));
}

function normalizeLibrarySearch(value: string): string {
	return value.toLocaleLowerCase('fa').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064B-\u065F\u0670]/g, '');
}

function TemplateThumbnail({ item }: { item: TemplateSummary }) {
	if (item.image) return <div className="builder-template-card__thumbnail builder-template-card__thumbnail--image" aria-hidden="true"><img src={item.image} alt="" loading="lazy" /><span>{item.kind === 'section' ? 'پیش‌نمایش بخش' : 'تصویر در طرح'}</span></div>;
	if (item.source !== 'starter' || !item.document) return <div className="builder-template-card__thumbnail builder-template-card__thumbnail--saved"><span>◫</span><small>برای دیدن طرح، پیش‌نمایش را باز کنید.</small></div>;
	const document = { ...item.document, nodes: item.document.nodes.slice(0, 2) };
	return <div className="builder-template-card__thumbnail" aria-hidden="true" inert><div className="builder-template-card__snapshot"><DocumentPreview document={document} viewport="desktop" /></div></div>;
}

function DocumentPreview({ document, viewport }: { document: PageDocument; viewport: Breakpoint }) {
	const containerStyle = { ...themeVariables(document.themeId), width: `min(100%, ${previewWidth(document, viewport)}px)` } as unknown as CSSProperties;
	return (
		<div className={`builder-document-preview builder-canvas-paper--${viewport} ${isMobileRange(document, viewport) ? 'builder-canvas-paper--mobile' : ''}`} style={containerStyle}>
			{document.title || document.description ? (
				<header className="builder-document-preview__intro">
					{document.title ? <h1 className="builder-document-preview__title">{document.title}</h1> : null}
					{document.description ? <p className="builder-document-preview__description">{document.description}</p> : null}
				</header>
			) : null}
			<div className="builder-document-preview__content" data-testid="document-preview-content">
				{document.nodes.map((node) => (
					<ReadOnlyNode key={node.id} document={document} node={node} viewport={viewport} />
				))}
			</div>
		</div>
	);
}

function ReadOnlyNode({ document, node, viewport }: { document: PageDocument; node: BuilderNode; viewport: Breakpoint }) {
	const style = previewStyle(node, viewport, document);
	const hidden = hiddenAtBreakpoint(node, viewport);
	if (hidden) {
		return <div data-builder-id={node.id} className="builder-read-only-node--hidden" />;
	}
	if (node.type === 'Container') {
		return (
			<div data-builder-id={node.id} className={`nvx-builder-node nvx-builder-container nvx-builder-container--${node.props.background}`} data-layout={node.props.layout} data-max-width={node.props.maxWidth} style={{ gap: node.props.gap, padding: node.props.padding, ...style }}>
				{node.children.length ? node.children.map((child) => <ReadOnlyNode key={child.id} document={document} node={child} viewport={viewport} />) : <div className="builder-container-empty">بدون مؤلفه</div>}
			</div>
		);
	}
	if (node.type === 'Heading') {
		const Tag = `h${node.props.level}` as 'h1' | 'h2' | 'h3' | 'h4';
		return (
			<div data-builder-id={node.id} className="builder-read-only-node" style={style}>
				<Tag className={`nvx-builder-node nvx-builder-heading nvx-builder-heading--${node.props.size} nvx-builder-color--${node.props.color}`} data-align={node.props.align}><RichTextRuns text={node.props.text} marks={node.props.marks} /></Tag>
			</div>
		);
	}
	if (node.type === 'Text') {
		return (
			<div data-builder-id={node.id} className="builder-read-only-node" style={style}>
				<p className={`nvx-builder-node nvx-builder-text nvx-builder-text--${node.props.size} nvx-builder-color--${node.props.color}`} data-align={node.props.align}><RichTextRuns text={node.props.text} marks={node.props.marks} /></p>
			</div>
		);
	}
	if (node.type === 'Image') {
		return (
			<div data-builder-id={node.id} className="builder-read-only-node" style={style}>
				<figure className="nvx-builder-node nvx-builder-image">
					<div className="nvx-builder-image__frame" data-aspect={node.props.aspectRatio} data-fit={node.props.fit}>
						{node.props.src ? <img src={resolveBuilderImageSource(node.props.src)} alt={node.props.alt} loading="lazy" decoding="async" /> : <div className="nvx-builder-image__empty" role="img" aria-label={node.props.alt || 'تصویر در دسترس نیست'}>تصویر انتخاب نشده است</div>}
					</div>
					{node.props.caption ? <figcaption className="nvx-builder-image__caption">{node.props.caption}</figcaption> : null}
				</figure>
			</div>
		);
	}
	if (node.type === 'Spacer') {
		return <div data-builder-id={node.id} className="nvx-builder-node nvx-builder-spacer" aria-hidden="true" style={{ height: node.props.size, ...style }} />;
	}
	if (node.type === 'Divider') {
		return <hr data-builder-id={node.id} className={`nvx-builder-node nvx-builder-divider nvx-builder-divider--${node.props.color}`} style={{ borderTopWidth: node.props.thickness, borderTopStyle: node.props.lineStyle, ...style }} />;
	}
	if (isExtendedContentNode(node)) {
		return <div data-builder-id={node.id} className={`nvx-builder-node nvx-builder-extended nvx-builder-extended--${node.type}`} style={style}><ExtendedContent node={node} /></div>;
	}
	if (node.type === 'CodeWidget') {
		return <div data-builder-id={node.id} className="builder-read-only-node" style={style}><CodeWidgetPreview props={node.props} /></div>;
	}
	if (node.type === 'GlobalCode') {
		return <div data-builder-id={node.id} className="builder-read-only-node">کد صفحه در پیش‌نمایش ویرایشگر اجرا نمی‌شود.</div>;
	}
	if (node.type === 'PluginBlock') {
		return <div data-builder-id={node.id} className="builder-read-only-node" style={style}><PluginBlockPreview props={node.props} /></div>;
	}
	if (node.type === 'InquiryForm') {
		return <div data-builder-id={node.id} className="builder-read-only-node" style={style}><InquiryFormPreview node={node} /></div>;
	}
	if (node.type === 'ProductGrid') {
		return (
			<div data-builder-id={node.id} className="builder-read-only-node" style={style}>
				<ProductGridPreview node={node} />
			</div>
		);
	}
	return (
		<div data-builder-id={node.id} className="builder-read-only-node" style={style}>
			<div className="nvx-builder-button-wrap" data-align={node.props.align}>
				<a className={`nvx-builder-button nvx-builder-button--${node.props.variant}`} href={node.props.href} onClick={(event) => event.preventDefault()}>{node.props.label || 'دکمه'}</a>
			</div>
		</div>
	);
}

function hasResponsiveOverrides(node: BuilderNode): boolean {
	return Object.values(node.responsiveStyles ?? {}).some((styles) => styles && Object.keys(styles).length > 0);
}

function previewStyle(node: BuilderNode, viewport: Breakpoint, document: PageDocument): CSSProperties {
	return nodeStyleObject(resolveNodeStyles(node, viewport, document)) as CSSProperties;
}

function fieldValue(node: BuilderNode, field: InspectorField, viewport: Breakpoint): unknown {
	if ((node.type === 'Text' || node.type === 'Heading' || node.type === 'Blockquote') && field.kind === 'rich-text') return { text: node.props.text, marks: node.props.marks ?? [] };
	if (field.key.startsWith('plugin.') && node.type === 'PluginBlock') return node.props.fields.find((item) => item.key === field.key.slice('plugin.'.length))?.value ?? '';
	if (field.key.startsWith('binding.') && node.type === 'ProductGrid') {
		return node.props.binding[field.key.slice('binding.'.length) as keyof ProductGridBinding] ?? '';
	}
	if (!field.key.startsWith('styles.')) return node.props[field.key as keyof typeof node.props];
	const key = field.key.slice('styles.'.length) as keyof NodeStyles;
	const value = explicitNodeStyle(node, viewport, key);
	if (field.key === 'styles.width' && field.kind === 'length' && typeof value === 'string' && ['content', 'full', 'narrow', 'wide'].includes(value)) return '';
	return value ?? '';
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

async function readMigrationMediaMapFile(file: File): Promise<MigrationMediaMap> {
	if (!file.size || file.size > MAX_MIGRATION_MEDIA_MAP_BYTES) throw new Error('حجم نگاشت باید حداکثر ۲۵۶ کیلوبایت باشد.');
	let raw: unknown; try { raw = JSON.parse(await file.text()); } catch { throw new Error('JSON نگاشت رسانه معتبر نیست.'); }
	return parseMigrationMediaMap(raw);
}

async function assertExistingMigrationMedia(mapping: MigrationMediaMap): Promise<void> {
	if (!mapping.size) return;
	const response = await fetch('/cms/api/media', { headers: { accept: 'application/json' } });
	const result = await readResponse(response);
	if (!response.ok) throw new Error(result.message || 'خواندن کتابخانهٔ رسانه ممکن نشد.');
	if (result.ok !== true || !result.media) throw new Error('پاسخ کتابخانهٔ رسانه معتبر نیست.');
	const available = new Set(result.media.map((item) => item.assetRef));
	if ([...mapping.values()].some((target) => !available.has(target))) throw new Error('یکی از رسانه‌های مقصد در کتابخانه پیدا نشد.');
}

interface BuilderApiResponse {
	ok?: boolean;
	message?: string;
	code?: string;
	revision?: number;
	document?: unknown;
	publishedAt?: string | null;
	publicUrl?: string;
	id?: string;
	template?: { id?: string; document?: unknown };
	section?: { fragment?: unknown };
	archiveKit?: ArchiveKitSummary;
	kitReview?: KitReview;
	wxrArchive?: WxrArchiveSummary;
	revisions?: RevisionSummary[];
	media?: MediaPickerItem[];
	files?: MediaPickerItem[];
	templates?: TemplateSummary[];
	sections?: SharedSectionSummary[];
	pages?: Array<{ slug: string }>;
	posts?: Array<{ id: string }>;
	diagnostics?: BuilderDiagnostic[];
}
const responseRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const responseArray = <T,>(value: unknown, guard: (item: unknown) => item is T): T[] | undefined => Array.isArray(value) && value.every(guard) ? value : undefined;
const isWxrArchiveItem = (value: unknown): value is WxrArchiveItemSummary => responseRecord(value) && typeof value.title === 'string' && (value.type === 'page' || value.type === 'post') && Array.isArray(value.warnings) && value.warnings.every((item: unknown) => typeof item === 'string') && typeof value.hasElementor === 'boolean' && Array.isArray(value.elementorWarnings) && value.elementorWarnings.every((item: unknown) => typeof item === 'string') && typeof value.elementorError === 'string' && Array.isArray(value.blogWarnings) && value.blogWarnings.every((item: unknown) => typeof item === 'string') && typeof value.blogError === 'string';
const isWxrArchiveSummary = (value: unknown): value is WxrArchiveSummary => responseRecord(value) && typeof value.version === 'string' && Array.isArray(value.items) && value.items.length <= 200 && value.items.every(isWxrArchiveItem) && ['ignored', 'assetCount', 'postAssetCount', 'matchedAttachments', 'unmatchedAttachments'].every((key) => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && (value[key] as number) >= 0);
const isRevisionSummary = (value: unknown): value is RevisionSummary => responseRecord(value) && Number.isSafeInteger(value.revision) && typeof value.savedAt === 'string' && typeof value.title === 'string' && typeof value.nodeCount === 'number';
const isMediaItem = (value: unknown): value is MediaPickerItem => responseRecord(value) && typeof value.name === 'string' && typeof value.assetRef === 'string' && typeof value.publicUrl === 'string' && typeof value.previewUrl === 'string' && typeof value.bytes === 'number' && typeof value.modifiedAt === 'string' && typeof value.mimeType === 'string' && typeof value.builtin === 'boolean' && (value.width === undefined || typeof value.width === 'number') && (value.height === undefined || typeof value.height === 'number') && (value.reused === undefined || typeof value.reused === 'boolean');
const isTemplateSummary = (value: unknown): value is TemplateSummary => responseRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.description === 'string' && (value.source === 'starter' || value.source === 'saved') && (value.kind === undefined || value.kind === 'page' || value.kind === 'section') && (value.category === undefined || typeof value.category === 'string') && (value.image === undefined || (typeof value.image === 'string' && /^\/media\/[a-z0-9_/-]+\.jpg$/i.test(value.image))) && value.document === undefined;
const isSectionSummary = (value: unknown): value is SharedSectionSummary => responseRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && Number.isSafeInteger(value.revision) && typeof value.updatedAt === 'string';
const isPageSummary = (value: unknown): value is { slug: string } => responseRecord(value) && typeof value.slug === 'string';
const isPostSummary = (value: unknown): value is { id: string } => responseRecord(value) && typeof value.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(value.id);
const isArchiveKitSummary = (value: unknown): value is ArchiveKitSummary => responseRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.version === 'string' && Number.isSafeInteger(value.assetCount) && (value.assetCount as number) >= 0 && Array.isArray(value.pages) && value.pages.every((page: unknown) => responseRecord(page) && typeof page.suffix === 'string' && typeof page.title === 'string');
const isKitReview = (value: unknown): value is KitReview => responseRecord(value) && typeof value.token === 'string' && /^[a-f0-9]{64}$/.test(value.token) && typeof value.truncated === 'boolean' && Array.isArray(value.fields) && value.fields.length <= 100 && value.fields.every((field: unknown) => responseRecord(field) && typeof field.slug === 'string' && typeof field.path === 'string' && ['field', 'structural', 'order', 'formatted'].includes(String(field.kind)) && ['base', 'local', 'incoming'].every((key) => typeof field[key] === 'string' && (field[key] as string).length <= 2_000)) && Array.isArray(value.unresolved) && value.unresolved.length <= 100 && value.unresolved.every((item: unknown) => responseRecord(item) && typeof item.slug === 'string' && typeof item.path === 'string');
const diagnosticCodes = new Set<BuilderDiagnostic['code']>(['empty-page', 'missing-description', 'empty-heading', 'empty-button-label', 'extra-h1', 'empty-image', 'missing-alt', 'missing-media', 'external-image', 'placeholder-link', 'hidden-everywhere', 'empty-accordion', 'empty-tabs', 'empty-list', 'empty-gallery', 'empty-video', 'empty-quote', 'executable-widget', 'global-code']);
const isDiagnostic = (value: unknown): value is BuilderDiagnostic => responseRecord(value) && typeof value.code === 'string' && diagnosticCodes.has(value.code as BuilderDiagnostic['code']) && typeof value.message === 'string' && value.severity === 'warning' && (value.nodeId === undefined || typeof value.nodeId === 'string') && (value.suggestion === undefined || typeof value.suggestion === 'string');

/** Parse API payloads at the boundary; malformed success bodies never become fake success. */
async function readResponse(response: Response): Promise<BuilderApiResponse> {
	let value: unknown;
	try { value = await response.json(); } catch { throw new Error('پاسخ سرور JSON معتبر نیست.'); }
	if (!responseRecord(value)) throw new Error('پاسخ سرور معتبر نیست.');
	return {
		...(typeof value.ok === 'boolean' ? { ok: value.ok } : {}),
		...(typeof value.message === 'string' ? { message: value.message } : {}),
		...(typeof value.code === 'string' ? { code: value.code } : {}),
		...(Number.isSafeInteger(value.revision) ? { revision: value.revision as number } : {}),
		...(Object.hasOwn(value, 'document') ? { document: value.document } : {}),
		...(value.publishedAt === null || typeof value.publishedAt === 'string' ? { publishedAt: value.publishedAt } : {}),
		...(typeof value.publicUrl === 'string' ? { publicUrl: value.publicUrl } : {}),
		...(typeof value.id === 'string' ? { id: value.id } : {}),
		...(responseRecord(value.template) ? { template: { document: value.template.document, ...(typeof value.template.id === 'string' ? { id: value.template.id } : {}) } } : {}),
		...(responseRecord(value.section) ? { section: { fragment: value.section.fragment } } : {}),
		...(isArchiveKitSummary(value.kit) ? { archiveKit: value.kit } : {}),
		...(isKitReview(value.review) ? { kitReview: value.review } : {}),
		...(isWxrArchiveSummary(value.summary) ? { wxrArchive: value.summary } : {}),
		revisions: responseArray(value.revisions, isRevisionSummary), media: responseArray(value.media, isMediaItem), files: responseArray(value.files, isMediaItem),
		templates: responseArray(value.templates, isTemplateSummary), sections: responseArray(value.sections, isSectionSummary), pages: responseArray(value.pages, isPageSummary), posts: responseArray(value.posts, isPostSummary),
		diagnostics: responseArray(value.diagnostics, isDiagnostic),
	};
}

function responsePageSlugs(value: BuilderApiResponse): string {
	if (!value.pages) throw new Error('پاسخ فهرست صفحه‌ها معتبر نیست.');
	return value.pages.map((page) => page.slug).join('، ');
}
