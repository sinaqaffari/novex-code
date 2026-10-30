import { collectDocumentAssets, type AssetResolutionOptions, type DocumentAssetUsage } from './assets.ts';
import { validateDocumentWithDiagnostics, type ValidationDiagnostic } from './diagnostics.ts';
import { traversePageNodes } from './operations.ts';
import { COMPONENT_REGISTRY } from './registry.ts';
import { buildResponsiveCss } from './render.ts';
import { themeStyleText } from './themes.ts';
import type { BuilderComponentType, PageDocument } from './types.ts';

export interface CompiledPage {
	document: PageDocument;
	responsiveCss: string;
	themeCss?: string;
	components: BuilderComponentType[];
	assets: DocumentAssetUsage[];
	/** These snapshots use only host renderers and have no runtime plugin dependency. */
	pluginSnapshots: Array<{ nodeId: string; pluginId: string; componentId: string; version: string }>;
}

export type CompilationResult =
	| { ok: true; page: CompiledPage; diagnostics: ValidationDiagnostic[] }
	| { ok: false; diagnostics: ValidationDiagnostic[] };

/** Normalize, resolve registered components and compile deterministic, editor-free output. */
export function compilePageDocument(input: unknown, expectedSlug?: string, assetOptions: AssetResolutionOptions = {}): CompilationResult {
	const validation = validateDocumentWithDiagnostics(input, expectedSlug);
	if (!validation.ok) return validation;
	const document = validation.document;
	if (!document.nodes.length) return { ok: false, diagnostics: [{ severity: 'error', code: 'empty_page', message: 'برای انتشار، دست‌کم یک مؤلفه به صفحه اضافه کنید.', path: 'nodes', suggestion: 'یک مؤلفه به صفحه اضافه کنید.' }] };
	const components = new Set<BuilderComponentType>();
	const pluginSnapshots: CompiledPage['pluginSnapshots'] = [];
	traversePageNodes(document, (node) => {
		// Validation has already enforced registration, component versions and nesting.
		components.add(COMPONENT_REGISTRY[node.type].type);
		if (node.type === 'PluginBlock') pluginSnapshots.push({ nodeId: node.id, pluginId: node.props.pluginId, componentId: node.props.componentId, version: node.props.pluginVersion });
	});
	return { ok: true, page: {
		document, responsiveCss: buildResponsiveCss(document), themeCss: themeStyleText(document.themeId),
		components: [...components], assets: collectDocumentAssets(document, assetOptions), pluginSnapshots,
	}, diagnostics: [] };
}

/** Resolve only managed local files; external URLs and plugin code are never fetched. */
export async function preparePagePublication(input: unknown, expectedSlug: string, exists: (path: string) => Promise<boolean>, assetOptions: AssetResolutionOptions = {}): Promise<CompilationResult> {
	const result = compilePageDocument(input, expectedSlug, assetOptions);
	if (!result.ok) return result;
	const checked = new Map<string, Promise<boolean>>();
	const diagnostics: ValidationDiagnostic[] = [];
	for (const asset of result.page.assets) {
		const path = asset.identity.startsWith('assets/') ? asset.identity.slice('assets/'.length) : asset.identity;
		if (!checked.has(path)) checked.set(path, exists(path));
		if (!await checked.get(path)!) diagnostics.push({
			severity: 'error', code: 'missing_asset', message: 'فایل رسانهٔ صفحه پیدا نشد.',
			path: `node:${asset.nodeId}${asset.property ? `.${asset.property}` : ''}`, suggestion: 'تصویر را از کتابخانهٔ رسانه دوباره انتخاب کنید.',
		});
	}
	return diagnostics.length ? { ok: false, diagnostics } : result;
}
