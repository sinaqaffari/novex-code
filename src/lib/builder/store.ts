import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { createEmptyPageDocument, isValidPageSlug, serializePageDocument, validatePageDocument } from './document.ts';
import type { ContainerNode, PageDocument } from './types.ts';
import { isSharedSectionId, normalizeSectionNode, replaceSectionInstance, sectionHash, type SharedSectionRecord } from './shared-sections.ts';
import { traversePageNodes } from './operations.ts';
import { normalizeBreakpointWidths } from './responsive.ts';
import { mergeKitDocument, type KitFieldChoice, type KitFieldConflict } from './kit-merge.ts';
import { validateDeclarativePluginPackage, type DeclarativePluginRecord } from './declarative-plugin-package.ts';
import { collectDocumentAssets, type AssetResolutionOptions } from './assets.ts';
import { preparePagePublication } from './publishing.ts';
import type { ValidationDiagnostic } from './diagnostics.ts';
import { BuilderStoreError } from './store-error.ts';
export { BuilderStoreError } from './store-error.ts';
import { assetExists } from '../cms/media.ts';
import { compareSemVer, isSemVer } from '../plugins/validation.ts';
import { AppError } from '../errors.ts';
import { BackendError } from '../backend/inquiries.ts';
import { builderSnapshotClient } from '../backend/builder.ts';
import { assertFileStoreNotMigrated, exportSnapshotFile, migrateSnapshotFile, readSnapshotStore, writeSnapshotStore, type StoreMarker } from '../backend/snapshot-store.ts';

const DATABASE_SCHEMA_VERSION = 1;
const MAX_REVISIONS = 25;
const MAX_TEMPLATES = 50;
const MAX_SHARED_SECTIONS = 50;
const MAX_SHARED_VERSIONS = 25;

export interface BuilderTemplateRecord {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	document: PageDocument;
}

export interface BuilderRevision {
	revision: number;
	savedAt: string;
	document: PageDocument;
}

export interface SiteKitInstallation {
	kind: 'site-kit';
	id: string;
	version: string;
	prefix: string;
	baselineHash: string;
	/** Normalized upstream baseline; older installations have only a hash. */
	baselineDocument?: PageDocument;
	/** Complete installed page set; older records may not have it. */
	pageSlugs?: string[];
}
export type SiteKitInstallationInput = Pick<SiteKitInstallation, 'id' | 'version' | 'prefix'>;

export interface BuilderPageRecord {
	slug: string;
	revision: number;
	updatedAt: string;
	draft: PageDocument;
	publishedDocument?: PageDocument;
	publishedRevision?: number;
	publishedAt?: string;
	revisions: BuilderRevision[];
	installation?: SiteKitInstallation;
}

interface BuilderDatabase {
	schemaVersion: number;
	pages: Record<string, BuilderPageRecord>;
	templates: Record<string, BuilderTemplateRecord>;
	sections: Record<string, SharedSectionRecord>;
	declarativePlugins: Record<string, DeclarativePluginRecord>;
}

let writeQueue: Promise<unknown> = Promise.resolve();
// Enumerable symbols survive our immutable object spreads but are excluded from JSON.
// They carry the PostgreSQL CAS revision only through the current write operation.
const REMOTE_VERSION = Symbol('builder-postgres-version');
type VersionedBuilderDatabase = BuilderDatabase & { [REMOTE_VERSION]?: { marker: StoreMarker; revision: number } };

function builderStoreMode(): 'file' | 'postgres' {
	const mode = process.env.NOVEX_BUILDER_STORE ?? 'file';
	if (mode !== 'file' && mode !== 'postgres') throw new BuilderStoreError('تنظیم مخزن صفحه‌ساز معتبر نیست.', 503, 'storage_configuration');
	return mode;
}

function builderStorageError(error: unknown, failClosed = false): never {
	if (error instanceof BuilderStoreError) throw error;
	if (error instanceof AppError || error instanceof BackendError) {
		if (error.status === 409) throw new BuilderStoreError('مخزن صفحه‌ساز هم‌زمان تغییر کرد؛ دوباره ذخیره کنید. اگر خود صفحه تغییر کرده باشد، تعارض نسخه نمایش داده می‌شود.', 409, 'storage_conflict');
		if (error.status === 413) throw new BuilderStoreError('حجم داده‌های صفحه‌ساز بیش از ظرفیت مخزن است؛ داده‌ای بازنویسی نشد.', 413, 'storage_too_large');
		throw new BuilderStoreError('مخزن صفحه‌ساز در دسترس نیست یا انتقال آن کامل نشده است.', 503, 'storage_unavailable');
	}
	if (failClosed) throw new BuilderStoreError('خواندن مخزن صفحه‌ساز ممکن نیست؛ داده‌ای بازنشانی نشد.', 503, 'storage_unavailable');
	throw error;
}

export function builderDatabasePath(): string {
	return path.resolve(process.cwd(), process.env.BUILDER_DATA_FILE || 'data/builder-pages.json');
}

export async function getDraftPage(slug: string): Promise<BuilderPageRecord> {
	assertSlug(slug);
	const database = await readDatabase();
	return database.pages[slug] ?? {
		slug,
		revision: 0,
		updatedAt: '',
		draft: createEmptyPageDocument(slug),
		revisions: [],
	};
}

export async function listBuilderPages(): Promise<Array<Pick<BuilderPageRecord, 'slug' | 'revision' | 'updatedAt' | 'publishedAt' | 'publishedRevision'> & { title: string; nodeCount: number }>> {
	const database = await readDatabase();
	return Object.values(database.pages)
		.map(({ slug, revision, updatedAt, publishedAt, publishedRevision, draft }) => ({
			slug,
			revision,
			updatedAt,
			title: draft.title,
			nodeCount: countNodes(draft.nodes),
			...(publishedAt ? { publishedAt } : {}),
			...(publishedRevision ? { publishedRevision } : {}),
		}))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function countNodes(nodes: PageDocument['nodes']): number {
	return nodes.reduce((count, node) => count + 1 + (node.type === 'Container' ? countNodes(node.children) : 0), 0);
}

export async function getPageHistory(slug: string): Promise<BuilderRevision[]> {
	assertSlug(slug);
	const database = await readDatabase();
	return [...(database.pages[slug]?.revisions ?? [])].reverse();
}

export async function listBuilderTemplates(): Promise<Array<Pick<BuilderTemplateRecord, 'id' | 'name' | 'createdAt' | 'updatedAt'>>> {
	const database = await readDatabase();
	return Object.values(database.templates)
		.map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt }))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBuilderTemplate(id: string): Promise<BuilderTemplateRecord | null> {
	assertTemplateId(id);
	const database = await readDatabase();
	return database.templates[id] ?? null;
}

export async function saveBuilderTemplate(input: { name: string; document: unknown; origins?: readonly string[] }): Promise<BuilderTemplateRecord> {
	const name = input.name.trim();
	if (!name || name.length > 60) throw new BuilderStoreError('نام قالب باید بین ۱ تا ۶۰ نویسه باشد.', 422, 'invalid_template_name');
	let document: PageDocument;
	try {
		document = validatePageDocument(input.document);
	} catch (error) {
		throw new BuilderStoreError(error instanceof Error ? error.message : 'سند قالب معتبر نیست.', 422, 'invalid_template_document');
	}
	return serializeWrite(async () => {
		const database = await readDatabase();
		if (Object.keys(database.templates).length >= MAX_TEMPLATES) throw new BuilderStoreError('حداکثر ۵۰ قالب سفارشی قابل ذخیره است.', 422, 'template_limit');
		await assertNewDocumentAssetsExist(document, undefined, input.origins);
		const id = `template_${randomUUID()}`;
		const createdAt = new Date().toISOString();
		const template = { id, name, createdAt, updatedAt: createdAt, document };
		await writeDatabase({ ...database, templates: { ...database.templates, [id]: template } });
		return template;
	});
}

export async function deleteBuilderTemplate(id: string): Promise<void> {
	assertTemplateId(id);
	await serializeWrite(async () => {
		const database = await readDatabase();
		if (!database.templates[id]) throw new BuilderStoreError('قالب پیدا نشد.', 404, 'template_not_found');
		const templates = { ...database.templates };
		delete templates[id];
		await writeDatabase({ ...database, templates });
	});
}

export async function getPublishedPage(slug: string): Promise<{ document: PageDocument; publishedAt: string; revision: number } | null> {
	assertSlug(slug);
	const database = await readDatabase();
	const record = database.pages[slug];
	if (!record?.publishedDocument || !record.publishedAt || !record.publishedRevision) return null;
	return {
		document: record.publishedDocument,
		publishedAt: record.publishedAt,
		revision: record.publishedRevision,
	};
}

export async function saveDraftPage(input: {
	slug: string;
	expectedRevision: number;
	document: unknown;
	origins?: readonly string[];
}): Promise<BuilderPageRecord> {
	assertSlug(input.slug);
	return serializeWrite(async () => {
		const database = await readDatabase();
		const current = database.pages[input.slug];
		assertExpectedRevision(input.expectedRevision, current?.revision ?? 0);
		const document = validateDocument(input.document, input.slug);
		await assertNewDocumentAssetsExist(document, current?.draft, input.origins);
		const revision = (current?.revision ?? 0) + 1;
		const savedAt = new Date().toISOString();
		const record: BuilderPageRecord = {
			...(current ?? { slug: input.slug, revisions: [] }),
			slug: input.slug,
			revision,
			updatedAt: savedAt,
			draft: document,
			revisions: appendRevision(current?.revisions ?? [], { revision, savedAt, document }),
		};
		await writeDatabase({ ...database, pages: { ...database.pages, [input.slug]: record } });
		return record;
	});
}

/** All-or-nothing for cooperating processes sharing the file-backed store; never replaces pages. */
export async function installDraftPages(documents: PageDocument[], installation?: SiteKitInstallationInput, options?: { requireAssets?: boolean; origins?: readonly string[] }): Promise<BuilderPageRecord[]> {
	if (!Array.isArray(documents) || !documents.length || documents.length > 20) throw new BuilderStoreError('تعداد صفحه‌ها معتبر نیست.', 422, 'invalid_kit');
	const normalized = documents.map((document) => validateDocument(document, document.slug));
	if (installation) validateInstallationInput(installation, normalized);
	if (new Set(normalized.map((document) => document.slug)).size !== normalized.length) throw new BuilderStoreError('نامک تکراری است.', 422, 'duplicate_slug');
	return serializeWrite(async () => {
		const database = await readDatabase();
		await assertKitAssetsExist(normalized, options?.origins);
		const collision = normalized.find((document) => database.pages[document.slug]);
		if (collision) throw new BuilderStoreError(`صفحهٔ ${collision.slug} از قبل وجود دارد؛ پیشوند دیگری انتخاب کنید.`, 409, 'page_exists');
		// Disjoint suffixes do not make a second installation with the same
		// identity safe: it would corrupt both copies' recorded complete page set.
		if (installation && Object.values(database.pages).some((page) => page.installation?.id === installation.id && page.installation.prefix === installation.prefix)) throw new BuilderStoreError('این بسته با همین پیشوند قبلاً نصب شده است؛ از به‌روزرسانی استفاده کنید.', 409, 'kit_already_installed');
		const now = new Date().toISOString();
		const records = normalized.map((document): BuilderPageRecord => ({ slug: document.slug, revision: 1, updatedAt: now, draft: document, revisions: [{ revision: 1, savedAt: now, document }], ...(installation ? { installation: installationForDocument(installation, document, normalized.map((item) => item.slug)) } : {}) }));
		await writeDatabase({ ...database, pages: { ...database.pages, ...Object.fromEntries(records.map((record) => [record.slug, record])) } });
		return records;
	});
}

/** Packages contain host-rendered snapshots; optional Wasm runs only in the isolated numeric sandbox. */
export async function listDeclarativePluginPackages(): Promise<DeclarativePluginRecord[]> {
	return Object.values((await readDatabase()).declarativePlugins).sort((a, b) => a.package.name.localeCompare(b.package.name, 'fa'));
}

export async function installDeclarativePluginPackage(input: unknown, action: 'install' | 'update', expectedRevision?: number, origins?: readonly string[]): Promise<DeclarativePluginRecord> {
	const valid = validateDeclarativePluginPackage(input);
	return withBuilderAssetLock(async () => {
		const database = await readDatabase();
		const current = database.declarativePlugins[valid.id];
		if (action === 'install' && current) throw new BuilderStoreError('این بسته قبلاً نصب شده است.', 409, 'plugin_package_exists');
		if (action === 'update' && (!current || current.revision !== expectedRevision)) throw new BuilderStoreError('نسخهٔ نصب بسته تغییر کرده است؛ دوباره بارگیری کنید.', 409, 'plugin_package_conflict', current?.revision);
		if (current && compareSemVer(valid.version, current.package.version) <= 0) throw new BuilderStoreError('نسخهٔ جدید باید بالاتر باشد.', 409, 'plugin_package_version');
		const entries = Object.values(database.declarativePlugins);
		if ((!current && entries.length >= 25) || entries.reduce((count, item) => count + (item.package.id === valid.id ? 0 : item.package.components.length), valid.components.length) > 50) throw new BuilderStoreError('حداکثر تعداد بسته یا مؤلفه رسیده است.', 422, 'plugin_package_limit');
		if (entries.reduce((count, item) => count + (item.package.id === valid.id ? 0 : (item.package.presets?.length ?? 0)), valid.presets?.length ?? 0) > 50) throw new BuilderStoreError('حداکثر تعداد پیش‌تنظیم بسته‌ها رسیده است.', 422, 'plugin_package_limit');
		if (entries.reduce((count, item) => count + (item.package.id === valid.id ? 0 : (item.package.processors?.length ?? 0)), valid.processors?.length ?? 0) > 20) throw new BuilderStoreError('حداکثر تعداد پردازشگرهای افزونه رسیده است.', 422, 'plugin_package_limit');
		await assertKitAssetsExist((valid.presets ?? []).map((preset) => preset.document), origins);
		const record: DeclarativePluginRecord = { package: valid, active: current?.active ?? true, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
		await writeDatabase({ ...database, declarativePlugins: { ...database.declarativePlugins, [valid.id]: record } });
		return record;
	});
}

export async function changeDeclarativePluginPackage(id: string, expectedRevision: number, active: boolean | null): Promise<void> {
	return withBuilderAssetLock(async () => {
		const database = await readDatabase();
		const current = database.declarativePlugins[id];
		if (!current || current.revision !== expectedRevision) throw new BuilderStoreError('نسخهٔ نصب بسته تغییر کرده است؛ دوباره بارگیری کنید.', 409, 'plugin_package_conflict', current?.revision);
		const packages = { ...database.declarativePlugins };
		if (active === null) delete packages[id];
		else packages[id] = { ...current, active, revision: current.revision + 1, updatedAt: new Date().toISOString() };
		await writeDatabase({ ...database, declarativePlugins: packages });
	});
}

/** Recheck referenced files while holding the same lock used by deletion. */
function assetOptions(origins: readonly string[] = []): AssetResolutionOptions {
	return { origins: [...origins, ...(process.env.SITE_URL ? [process.env.SITE_URL] : [])] };
}

/** Verify only newly introduced managed images while holding the shared lock.
 * Existing missing legacy images remain editable, but a deletion that wins a
 * race against a new save cannot leave a newly dangling reference. */
async function assertNewDocumentAssetsExist(document: PageDocument, previous?: PageDocument, origins?: readonly string[]): Promise<void> {
	const options = assetOptions(origins);
	const prior = new Set(previous ? collectDocumentAssets(previous, options).map((asset) => asset.identity) : []);
	const checked = new Set<string>();
	for (const asset of collectDocumentAssets(document, options)) {
		if (prior.has(asset.identity) || checked.has(asset.identity)) continue;
		checked.add(asset.identity);
		const file = asset.identity.startsWith('assets/') ? asset.identity.slice('assets/'.length) : asset.identity;
		if (!await assetExists(file)) throw new BuilderStoreError('رسانهٔ محلی پیدا نشد؛ پیش از ذخیره دوباره آن را انتخاب کنید.', 409, 'missing_asset', undefined, [{ severity: 'error', code: 'missing_asset', message: 'فایل رسانهٔ صفحه پیدا نشد.', path: `node:${asset.nodeId}${asset.property ? `.${asset.property}` : ''}`, suggestion: 'تصویر را از کتابخانهٔ رسانه دوباره انتخاب کنید.' }]);
	}
}

async function assertKitAssetsExist(documents: PageDocument[], origins?: readonly string[]): Promise<void> {
	const checked = new Set<string>();
	for (const document of documents) for (const asset of collectDocumentAssets(document, assetOptions(origins))) {
		const file = asset.identity.startsWith('assets/') ? asset.identity.slice('assets/'.length) : asset.identity;
		if (checked.has(file)) continue;
		checked.add(file);
		if (!await assetExists(file)) throw new BuilderStoreError('دارایی محلی پیدا نشد؛ هیچ صفحه‌ای تغییر نکرد.', 422, 'missing_asset');
	}
}

function documentHash(document: PageDocument): string {
	return createHash('sha256').update(serializePageDocument(document)).digest('hex');
}

/** Recognize exact legacy hashes without rewriting old data on read. */
function matchesInstalledBaseline(document: PageDocument, baseline: string): boolean {
	if (documentHash(document) === baseline) return true;
	const normalized = validatePageDocument(document);
	const legacyV4 = { ...normalized, schemaVersion: 4 };
	if (createHash('sha256').update(JSON.stringify(legacyV4)).digest('hex') === baseline) return true;
	if (normalized.breakpoints?.custom?.length) return false;
	const legacyV3 = { ...normalized, schemaVersion: 3 };
	if (createHash('sha256').update(JSON.stringify(legacyV3)).digest('hex') === baseline) return true;
	if (normalized.breakpoints !== undefined) return false;
	const legacyV2 = { ...normalized, schemaVersion: 2 };
	return createHash('sha256').update(JSON.stringify(legacyV2)).digest('hex') === baseline;
}

function validateInstallationInput(input: SiteKitInstallationInput, documents: PageDocument[]): void {
	if (!input || !isValidPageSlug(input.id) || !isValidPageSlug(input.prefix) || !isSemVer(input.version) || documents.some((document) => !document.slug.startsWith(`${input.prefix}-`))) {
		throw new BuilderStoreError('منشأ یا نسخهٔ بسته معتبر نیست.', 422, 'invalid_kit_provenance');
	}
}
function installationForDocument(input: SiteKitInstallationInput, document: PageDocument, pageSlugs: string[]): SiteKitInstallation {
	return { kind: 'site-kit', id: input.id, version: input.version, prefix: input.prefix, baselineHash: documentHash(document), baselineDocument: document, pageSlugs: [...pageSlugs].sort() };
}

export interface KitUpdateReviewField extends KitFieldConflict { slug: string }
export interface KitUpdateReview {
	token: string;
	fields: KitUpdateReviewField[];
	/** Oversized or otherwise unreviewable conflicts require manual editing. */
	unresolved: Array<{ slug: string; path: string }>;
	truncated: boolean;
}
export interface KitUpdateDecision {
	token: string;
	choices: Array<{ slug: string; path: string; choice: KitFieldChoice }>;
}

function normalizeKitUpdate(documents: PageDocument[], installation: SiteKitInstallationInput): PageDocument[] {
	if (!Array.isArray(documents) || !documents.length || documents.length > 20) throw new BuilderStoreError('تعداد صفحه‌ها معتبر نیست.', 422, 'invalid_kit');
	const normalized = documents.map((document) => validateDocument(document, document.slug));
	validateInstallationInput(installation, normalized);
	if (new Set(normalized.map((document) => document.slug)).size !== normalized.length) throw new BuilderStoreError('نامک تکراری است.', 422, 'duplicate_slug');
	return normalized;
}

function planInstalledKitUpdate(database: BuilderDatabase, normalized: PageDocument[], installation: SiteKitInstallationInput, choices = new Map<string, Map<string, KitFieldChoice>>()): { review: KitUpdateReview; drafts: Map<string, PageDocument> } {
	const installed = Object.values(database.pages).filter((page) => page.installation?.id === installation.id && page.installation.prefix === installation.prefix).sort((a, b) => a.slug.localeCompare(b.slug));
	if (!installed.length) throw new BuilderStoreError('نصب قبلی بسته پیدا نشد.', 404, 'kit_not_installed');
	const previous = installed[0].installation!;
	const expectedPages = previous.pageSlugs;
	const actualSlugs = new Set(installed.map((page) => page.slug));
	if (!expectedPages || expectedPages.length !== installed.length || expectedPages.some((slug) => !actualSlugs.has(slug)) || installed.some((page) => page.installation!.version !== previous.version || JSON.stringify(page.installation!.pageSlugs) !== JSON.stringify(expectedPages))) {
		throw new BuilderStoreError('فهرست نصب قبلی کامل یا یکسان نیست؛ به‌روزرسانی امن ممکن نیست.', 409, 'kit_update_conflict');
	}
	const slugs = new Set(normalized.map((document) => document.slug));
	if (installed.some((page) => !slugs.has(page.slug))) throw new BuilderStoreError('بستهٔ تازه همهٔ صفحه‌های نصب‌شده را ندارد؛ محتوایی حذف نشد.', 409, 'kit_update_conflict');
	for (const document of normalized) {
		const current = database.pages[document.slug];
		if (current && (current.installation?.id !== installation.id || current.installation.prefix !== installation.prefix)) throw new BuilderStoreError(`صفحهٔ ${document.slug} به این بسته تعلق ندارد.`, 409, 'kit_update_conflict');
	}
	// Bind approval to the exact upstream documents, provenance, baseline, and
	// current draft/revision of every installed page; no server session is needed.
	const token = createHash('sha256').update(JSON.stringify({ installation, normalized, pages: installed.map(({ slug, revision, draft, installation: origin }) => ({ slug, revision, draft, origin })) })).digest('hex');
	const review: KitUpdateReview = { token, fields: [], unresolved: [], truncated: false };
	const drafts = new Map<string, PageDocument>();
	let previewBytes = 0;
	for (const page of installed) {
		const origin = page.installation!;
		if (compareSemVer(installation.version, origin.version) <= 0) throw new BuilderStoreError('نسخهٔ جدیدتری از بسته در دسترس نیست.', 409, 'kit_no_update');
		const incoming = normalized.find((item) => item.slug === page.slug)!;
		if (matchesInstalledBaseline(page.draft, origin.baselineHash)) { drafts.set(page.slug, incoming); continue; }
		if (!origin.baselineDocument) throw new BuilderStoreError(`صفحهٔ ${page.slug} ویرایش شده و نسخهٔ پایه برای ادغام موجود نیست.`, 409, 'kit_update_conflict');
		const merged = mergeKitDocument(origin.baselineDocument, page.draft, incoming, choices.get(page.slug));
		if (merged.ok) { drafts.set(page.slug, merged.document); continue; }
		if (merged.truncated) review.truncated = true;
		const fields = new Map(merged.fields.map((field) => [field.path, field]));
		for (const path of merged.conflicts) {
			const field = fields.get(path);
			const bytes = field ? field.base.length + field.local.length + field.incoming.length + field.path.length + page.slug.length : 0;
			if (field && review.fields.length < 100 && previewBytes + bytes <= 200_000) {
				review.fields.push({ ...field, slug: page.slug }); previewBytes += bytes;
			} else if (review.unresolved.length < 100) review.unresolved.push({ slug: page.slug, path });
			else review.truncated = true;
		}
	}
	return { review, drafts };
}

function validateKitDecision(value: unknown): KitUpdateDecision {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BuilderStoreError('تصمیم بررسی معتبر نیست.', 400, 'invalid_kit_review');
	const input = value as Record<string, unknown>;
	if (Object.keys(input).some((key) => !['token', 'choices'].includes(key)) || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token) || !Array.isArray(input.choices) || input.choices.length > 100) throw new BuilderStoreError('تصمیم بررسی معتبر نیست.', 400, 'invalid_kit_review');
	const choices: KitUpdateDecision['choices'] = [];
	const seen = new Set<string>();
	for (const choice of input.choices) {
		if (!choice || typeof choice !== 'object' || Array.isArray(choice)) throw new BuilderStoreError('تصمیم بررسی معتبر نیست.', 400, 'invalid_kit_review');
		const item = choice as Record<string, unknown>;
		if (Object.keys(item).some((key) => !['slug', 'path', 'choice'].includes(key)) || typeof item.slug !== 'string' || !isValidPageSlug(item.slug) || typeof item.path !== 'string' || !item.path || item.path.length > 1_000 || (item.choice !== 'local' && item.choice !== 'incoming')) throw new BuilderStoreError('تصمیم بررسی معتبر نیست.', 400, 'invalid_kit_review');
		const key = `${item.slug}\0${item.path}`;
		if (seen.has(key)) throw new BuilderStoreError('تصمیم تکراری است.', 400, 'invalid_kit_review');
		seen.add(key); choices.push({ slug: item.slug, path: item.path, choice: item.choice });
	}
	return { token: input.token, choices };
}

function assertKitPlanReady(review: KitUpdateReview): void {
	const paths = [...review.fields.map(({ slug, path }) => ({ slug, path })), ...review.unresolved];
	if (!paths.length && !review.truncated) return;
	const diagnostics: ValidationDiagnostic[] = paths.slice(0, 100).map(({ slug, path }) => ({ severity: 'error', code: 'kit_merge_conflict', message: `تعارض در ${slug}: ${path}`, path, suggestion: 'تغییرهای محلی و بسته را بررسی کنید.' }));
	throw new BuilderStoreError('صفحه‌های ویرایش شده با بسته تعارض دارند؛ هیچ صفحه‌ای تغییر نکرد.', 409, 'kit_update_conflict', undefined, diagnostics);
}

/** Preview all conflicts under the store lock; no files, drafts or publications are changed. */
export async function reviewInstalledKitUpdate(documents: PageDocument[], installation: SiteKitInstallationInput): Promise<KitUpdateReview> {
	const normalized = normalizeKitUpdate(documents, installation);
	return serializeWrite(async () => planInstalledKitUpdate(await readDatabase(), normalized, installation).review);
}

/** Atomically merge all drafts, optionally applying choices from the exact reviewed state. */
export async function updateInstalledKitDrafts(documents: PageDocument[], installation: SiteKitInstallationInput, decisionInput?: unknown, options?: { origins?: readonly string[] }): Promise<BuilderPageRecord[]> {
	const normalized = normalizeKitUpdate(documents, installation);
	const decision = decisionInput === undefined ? undefined : validateKitDecision(decisionInput);
	return serializeWrite(async () => {
		const database = await readDatabase();
		await assertKitAssetsExist(normalized, options?.origins);
		let plan = planInstalledKitUpdate(database, normalized, installation);
		if (decision) {
			if (decision.token !== plan.review.token) throw new BuilderStoreError('صفحه یا بسته پس از بررسی تغییر کرده است؛ دوباره بررسی کنید.', 409, 'kit_review_stale');
			if (plan.review.unresolved.length || plan.review.truncated || decision.choices.length !== plan.review.fields.length) throw new BuilderStoreError('همهٔ تعارض‌های قابل‌بررسی باید انتخاب شوند؛ تعارض بزرگ یا بررسی‌نشده را دستی برطرف کنید.', 409, 'invalid_kit_review');
			const expected = new Set(plan.review.fields.map(({ slug, path }) => `${slug}\0${path}`));
			const choices = new Map<string, Map<string, KitFieldChoice>>();
			for (const item of decision.choices) {
				if (!expected.has(`${item.slug}\0${item.path}`)) throw new BuilderStoreError('انتخاب با بررسی مطابقت ندارد.', 409, 'invalid_kit_review');
				let pageChoices = choices.get(item.slug);
				if (!pageChoices) { pageChoices = new Map(); choices.set(item.slug, pageChoices); }
				pageChoices.set(item.path, item.choice);
			}
			plan = planInstalledKitUpdate(database, normalized, installation, choices);
		}
		assertKitPlanReady(plan.review);
		const now = new Date().toISOString();
		const records = normalized.map((document): BuilderPageRecord => {
			const current = database.pages[document.slug];
			const revision = (current?.revision ?? 0) + 1;
			const draft = plan.drafts.get(document.slug) ?? document;
			return {
				...(current ?? { slug: document.slug, revisions: [] }),
				slug: document.slug, revision, updatedAt: now, draft,
				revisions: appendRevision(current?.revisions ?? [], { revision, savedAt: now, document: draft }),
				installation: { ...current?.installation, ...installationForDocument(installation, document, normalized.map((item) => item.slug)) },
			};
		});
		await writeDatabase({ ...database, pages: { ...database.pages, ...Object.fromEntries(records.map((record) => [record.slug, record])) } });
		return records;
	});
}

export async function publishPage(input: {
	slug: string;
	expectedRevision: number;
	document: unknown;
	/** Derived from server-side RBAC, never trusted directly from request data. */
	allowHostCode?: boolean;
	acknowledgeExecutableCode?: boolean;
	origins?: readonly string[];
}): Promise<BuilderPageRecord> {
	assertSlug(input.slug);
	return serializeWrite(async () => {
		const database = await readDatabase();
		const current = database.pages[input.slug];
		assertExpectedRevision(input.expectedRevision, current?.revision ?? 0);
		const compilation = await preparePagePublication(input.document, input.slug, assetExists, assetOptions(input.origins));
		if (!compilation.ok) {
			const first = compilation.diagnostics[0];
			const code = first.code === 'empty_page' ? 'empty_page' : first.code === 'missing_asset' ? 'missing_asset' : 'invalid_document';
			throw new BuilderStoreError(first.message, 422, code, undefined, compilation.diagnostics);
		}
		const document = compilation.page.document;
		let globalCode = false;
		let executableCode = false;
		traversePageNodes(document, (node) => { if (node.type === 'GlobalCode') globalCode = true; if (node.type === 'CodeWidget' || node.type === 'GlobalCode') executableCode = true; });
		if (globalCode && input.allowHostCode !== true) throw new BuilderStoreError('فقط مدیر اجازهٔ انتشار کد صفحه با دسترسی کامل را دارد.', 403, 'global_code_forbidden');
		if (executableCode && input.acknowledgeExecutableCode !== true) throw new BuilderStoreError('پیش از انتشار باید کد اجرایی را بررسی و تأیید کنید.', 422, 'code_review_required');
		const revision = (current?.revision ?? 0) + 1;
		const publishedAt = new Date().toISOString();
		const record: BuilderPageRecord = {
			...(current ?? { slug: input.slug, revisions: [] }),
			slug: input.slug,
			revision,
			updatedAt: publishedAt,
			draft: document,
			publishedDocument: document,
			publishedRevision: revision,
			publishedAt,
			revisions: appendRevision(current?.revisions ?? [], { revision, savedAt: publishedAt, document }),
		};
		await writeDatabase({ ...database, pages: { ...database.pages, [input.slug]: record } });
		return record;
	});
}

/** Manage centrally owned section sources without executing user code. */
export async function listSharedSections(): Promise<Array<Pick<SharedSectionRecord, 'id' | 'name' | 'revision' | 'updatedAt'>>> {
	const database = await readDatabase();
	return Object.values(database.sections).map(({ id, name, revision, updatedAt }) => ({ id, name, revision, updatedAt })).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

export async function getSharedSection(id: string): Promise<SharedSectionRecord | null> {
	if (!isSharedSectionId(id)) throw new BuilderStoreError('شناسهٔ بخش مشترک معتبر نیست.', 400, 'invalid_section_id');
	return (await readDatabase()).sections[id] ?? null;
}

export async function createSharedSection(name: string, input: unknown, breakpointInput?: unknown, origins?: readonly string[]): Promise<SharedSectionRecord> {
	if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) throw new BuilderStoreError('نام بخش باید بین ۱ تا ۶۰ نویسه باشد.', 422, 'invalid_section_name');
	let node: ContainerNode;
	let breakpoints: PageDocument['breakpoints'];
	try { breakpoints = normalizeBreakpointWidths(breakpointInput); node = normalizeSectionNode(input, breakpoints); } catch (error) { throw new BuilderStoreError(error instanceof Error ? error.message : 'بخش معتبر نیست.', 422, 'invalid_section'); }
	return serializeWrite(async () => {
		const database = await readDatabase();
		if (Object.keys(database.sections).length >= MAX_SHARED_SECTIONS) throw new BuilderStoreError('حداکثر ۵۰ بخش مشترک قابل ذخیره است.', 422, 'section_limit');
		await assertNewDocumentAssetsExist({ ...createEmptyPageDocument('shared-section'), breakpoints, nodes: [node] }, undefined, origins);
		const section: SharedSectionRecord = { id: `section_${randomUUID()}`, name: name.trim(), revision: 1, updatedAt: new Date().toISOString(), node, ...(breakpoints ? { breakpoints } : {}), versions: [{ revision: 1, hash: sectionHash(node, breakpoints) }] };
		await writeDatabase({ ...database, sections: { ...database.sections, [section.id]: section } });
		return section;
	});
}

export async function updateSharedSection(id: string, expectedRevision: number, input: unknown, breakpointInput?: unknown, origins?: readonly string[]): Promise<SharedSectionRecord> {
	if (!isSharedSectionId(id)) throw new BuilderStoreError('شناسهٔ بخش مشترک معتبر نیست.', 400, 'invalid_section_id');
	return serializeWrite(async () => {
		const database = await readDatabase();
		const current = database.sections[id];
		if (!current) throw new BuilderStoreError('بخش مشترک پیدا نشد.', 404, 'section_not_found');
		assertExpectedRevision(expectedRevision, current.revision);
		let node: ContainerNode;
		let breakpoints: PageDocument['breakpoints'];
		try { breakpoints = normalizeBreakpointWidths(breakpointInput ?? current.breakpoints); node = normalizeSectionNode(input, breakpoints); } catch (error) { throw new BuilderStoreError(error instanceof Error ? error.message : 'بخش معتبر نیست.', 422, 'invalid_section'); }
		const hash = sectionHash(node, breakpoints);
		if (hash === sectionHash(current.node, current.breakpoints)) return current;
		await assertNewDocumentAssetsExist({ ...createEmptyPageDocument('shared-section'), breakpoints, nodes: [node] }, { ...createEmptyPageDocument('shared-section'), breakpoints: current.breakpoints, nodes: [current.node] }, origins);
		const revision = current.revision + 1;
		const section = { ...current, node, breakpoints, revision, updatedAt: new Date().toISOString(), versions: [...current.versions, { revision, hash }].slice(-MAX_SHARED_VERSIONS) };
		await writeDatabase({ ...database, sections: { ...database.sections, [id]: section } });
		return section;
	});
}

/** Apply a source revision atomically to unmodified linked draft snapshots only. */
export async function synchronizeSharedSection(id: string, expectedRevision: number, origins?: readonly string[]): Promise<BuilderPageRecord[]> {
	if (!isSharedSectionId(id)) throw new BuilderStoreError('شناسهٔ بخش مشترک معتبر نیست.', 400, 'invalid_section_id');
	return serializeWrite(async () => {
		const database = await readDatabase();
		const section = database.sections[id];
		if (!section) throw new BuilderStoreError('بخش مشترک پیدا نشد.', 404, 'section_not_found');
		assertExpectedRevision(expectedRevision, section.revision);
		const pages: BuilderPageRecord[] = [];
		for (const page of Object.values(database.pages)) {
			const instances: ContainerNode[] = [];
			traversePageNodes(page.draft, (node) => { if (node.type === 'Container' && node.sharedSection?.id === id) instances.push(node); });
			let draft = page.draft;
			let changed = false;
			for (const instance of instances) {
				const ref = instance.sharedSection!;
				const known = section.versions.find((version) => version.revision === ref.revision);
				if (!known || known.hash !== ref.baselineHash || sectionHash(instance, draft.breakpoints) !== known.hash) throw new BuilderStoreError(`بخش مشترک صفحهٔ ${page.slug} تغییر کرده یا نسخهٔ پایهٔ آن در دسترس نیست؛ هیچ پیش‌نویسی به‌روزرسانی نشد.`, 409, 'section_update_conflict');
				if (ref.revision === section.revision) continue;
				try { draft = replaceSectionInstance(draft, instance.id, section); }
				catch { throw new BuilderStoreError(`نقاط شکست بخش مشترک با صفحهٔ ${page.slug} تعارض دارند؛ هیچ پیش‌نویسی تغییر نکرد.`, 409, 'section_update_conflict'); }
				changed = true;
			}
			if (!changed) continue;
			await assertNewDocumentAssetsExist(draft, page.draft, origins);
			const revision = page.revision + 1;
			const savedAt = new Date().toISOString();
			pages.push({ ...page, revision, updatedAt: savedAt, draft, revisions: appendRevision(page.revisions, { revision, savedAt, document: draft }) });
		}
		if (pages.length) await writeDatabase({ ...database, pages: { ...database.pages, ...Object.fromEntries(pages.map((page) => [page.slug, page])) } });
		return pages;
	});
}

export interface BuilderAssetUsage {
	scope: 'draft' | 'published' | 'revision' | 'template' | 'section' | 'kit-baseline' | 'plugin-preset';
	nodeId: string;
	slug?: string;
	revision?: number;
	templateId?: string;
	sectionId?: string;
	pluginId?: string;
	presetId?: string;
}

function collectAssetUsages(database: BuilderDatabase, identity: string): BuilderAssetUsage[] {
	const usages: BuilderAssetUsage[] = [];
	const add = (document: PageDocument, context: Omit<BuilderAssetUsage, 'nodeId'>) => {
		for (const asset of collectDocumentAssets(document, { anyAbsolute: true })) if (asset.identity === identity) usages.push({ ...context, nodeId: asset.nodeId });
	};
	for (const page of Object.values(database.pages)) {
		add(page.draft, { scope: 'draft', slug: page.slug });
		if (page.installation?.baselineDocument) add(page.installation.baselineDocument, { scope: 'kit-baseline', slug: page.slug });
		if (page.publishedDocument) add(page.publishedDocument, { scope: 'published', slug: page.slug });
		for (const revision of page.revisions) add(revision.document, { scope: 'revision', slug: page.slug, revision: revision.revision });
	}
	for (const template of Object.values(database.templates)) add(template.document, { scope: 'template', templateId: template.id });
	for (const section of Object.values(database.sections)) add({ ...createEmptyPageDocument('shared-section'), breakpoints: section.breakpoints, nodes: [section.node] }, { scope: 'section', sectionId: section.id });
	for (const item of Object.values(database.declarativePlugins)) for (const preset of item.package.presets ?? []) add(preset.document, { scope: 'plugin-preset', pluginId: item.package.id, presetId: preset.id });
	return usages;
}

/** References include drafts, published snapshots, history and saved templates. */
export async function listBuilderAssetUsages(identity: string): Promise<BuilderAssetUsage[]> {
	return collectAssetUsages(await readDatabase(), identity);
}

/** Share the store lock so a committed save cannot slip between the usage check and unlink. */
export async function withUnusedBuilderUpload<T>(name: string, remove: () => Promise<T>): Promise<T> {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:avif|gif|jpe?g|png|webp|svg)$/i.test(name) || name.includes('..')) {
		throw new BuilderStoreError('نام فایل معتبر نیست.', 400, 'invalid_asset_name');
	}
	return serializeWrite(async () => {
		const usages = collectAssetUsages(await readDatabase(), `uploads/${name}`);
		if (usages.length) throw new BuilderStoreError('این تصویر در صفحه، تاریخچه یا قالب ذخیره‌شده استفاده شده است و حذف نمی‌شود.', 409, 'asset_in_use');
		return remove();
	});
}

/** Coordinate media operations with Builder saves and deletions on the same store. */
export async function withBuilderAssetLock<T>(operation: () => Promise<T>): Promise<T> {
	return serializeWrite(operation);
}

async function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
	const run = () => withStoreLock(builderDatabasePath(), operation);
	const next = writeQueue.then(run, run);
	writeQueue = next.then(() => undefined, () => undefined);
	return next;
}

/**
 * Exclusive-create lock for cooperating processes on the same filesystem.
 * No time-based lock stealing: a crashed owner leaves a lock requiring an
 * operator to verify its owner and remove it. This favors data safety over
 * availability and is not a distributed transaction/fencing mechanism.
 */
async function withStoreLock<T>(target: string, operation: () => Promise<T>): Promise<T> {
	const lockPath = `${target}.lock`;
	try { await mkdir(path.dirname(target), { recursive: true }); }
	catch { throw new BuilderStoreError('آماده‌سازی قفل ذخیره‌سازی ممکن نشد.', 500, 'storage_lock_failed'); }
	const configured = Number(process.env.BUILDER_LOCK_TIMEOUT_MS ?? 10000);
	const timeout = Number.isSafeInteger(configured) && configured >= 25 && configured <= 30000 ? configured : 10000;
	const deadline = Date.now() + timeout;
	let lock: Awaited<ReturnType<typeof open>>;
	while (true) {
		try { lock = await open(lockPath, 'wx', 0o600); break; }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new BuilderStoreError('قفل ذخیره‌سازی در دسترس نیست.', 500, 'storage_lock_failed');
			if (Date.now() >= deadline) throw new BuilderStoreError('ذخیره‌سازی صفحه‌ساز در حال استفاده یا قفل مانده است؛ دوباره تلاش کنید.', 503, 'storage_locked');
			await new Promise((resolve) => setTimeout(resolve, 15 + Math.floor(Math.random() * 20)));
		}
	}
	let result: T;
	let operationError: unknown;
	try {
		await lock.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), createdAt: new Date().toISOString(), token: randomUUID() }));
		result = await operation();
	} catch (error) {
		operationError = error;
	} finally {
		try { await lock.close(); } catch (error) { operationError ??= error; }
		try { await unlink(lockPath); } catch (error) { operationError ??= error; }
	}
	if (operationError !== undefined) throw operationError;
	return result!;
}

function validateDocument(input: unknown, slug: string): PageDocument {
	try {
		return validatePageDocument(input, slug);
	} catch (error) {
		throw new BuilderStoreError(error instanceof Error ? error.message : 'سند صفحه معتبر نیست.', 422, 'invalid_document');
	}
}

function assertSlug(slug: string): void {
	if (!isValidPageSlug(slug)) throw new BuilderStoreError('شناسهٔ صفحه معتبر نیست.', 400, 'invalid_slug');
}

function assertTemplateId(id: string): void {
	if (!/^template_[A-Za-z0-9_-]{8,80}$/.test(id)) throw new BuilderStoreError('شناسهٔ قالب معتبر نیست.', 400, 'invalid_template_id');
}

function assertExpectedRevision(expected: number, current: number): void {
	if (!Number.isSafeInteger(expected) || expected < 0) {
		throw new BuilderStoreError('شمارهٔ نسخهٔ مورد انتظار معتبر نیست.', 400, 'invalid_revision');
	}
	if (expected !== current) {
		throw new BuilderStoreError(
			'این صفحه در جای دیگری تغییر کرده است. نسخهٔ تازه را بارگیری کنید یا تغییرات محلی را به‌صورت فایل خروجی بگیرید.',
			409,
			'revision_conflict',
			current,
		);
	}
}

function appendRevision(revisions: BuilderRevision[], revision: BuilderRevision): BuilderRevision[] {
	return [...revisions, revision].slice(-MAX_REVISIONS);
}

function emptyBuilderDatabase(): BuilderDatabase {
	return { schemaVersion: DATABASE_SCHEMA_VERSION, pages: Object.create(null) as Record<string, BuilderPageRecord>, templates: {}, sections: {}, declarativePlugins: {} };
}

async function readDatabase(): Promise<BuilderDatabase> {
	const pathName = builderDatabasePath();
	let parsed: unknown;
	let remote: Awaited<ReturnType<typeof readSnapshotStore>> | undefined;
	if (builderStoreMode() === 'postgres') {
		try { remote = await readSnapshotStore(pathName, builderSnapshotClient); parsed = remote.raw; }
		catch (error) { return builderStorageError(error, true); }
	} else {
		try { await assertFileStoreNotMigrated(pathName); }
		catch (error) { return builderStorageError(error, true); }
		let source: string;
		try { source = await readFile(pathName, 'utf8'); }
		catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return emptyBuilderDatabase();
			throw new BuilderStoreError('خواندن داده‌های صفحه‌ساز ممکن نشد.', 500, 'storage_read_failed');
		}
		try { parsed = JSON.parse(source); }
		catch { throw new BuilderStoreError('فایل داده‌های صفحه‌ساز خراب است؛ برای جلوگیری از پاک‌شدن اطلاعات، بازنویسی نمی‌شود.', 500, 'storage_corrupt'); }
	}
	const database = normalizeBuilderDatabase(parsed);
	if (remote) Object.defineProperty(database, REMOTE_VERSION, { value: { marker: remote.marker, revision: remote.revision }, enumerable: true });
	return database;
}

function normalizeBuilderDatabase(parsed: unknown): BuilderDatabase {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new BuilderStoreError('ساختار فایل صفحه‌ساز معتبر نیست.', 500, 'storage_invalid');
	}
	const candidate = parsed as Partial<BuilderDatabase>;
	if (candidate.schemaVersion !== DATABASE_SCHEMA_VERSION || !candidate.pages || typeof candidate.pages !== 'object' || Array.isArray(candidate.pages)) {
		throw new BuilderStoreError('نسخه یا ساختار فایل صفحه‌ساز پشتیبانی نمی‌شود.', 500, 'storage_version');
	}
	if (candidate.templates !== undefined && (!candidate.templates || typeof candidate.templates !== 'object' || Array.isArray(candidate.templates))) {
		throw new BuilderStoreError('ساختار قالب‌های صفحه‌ساز معتبر نیست.', 500, 'templates_invalid');
	}
	if (candidate.sections !== undefined && (!candidate.sections || typeof candidate.sections !== 'object' || Array.isArray(candidate.sections))) {
		throw new BuilderStoreError('ساختار بخش‌های مشترک معتبر نیست.', 500, 'sections_invalid');
	}
	if (candidate.declarativePlugins !== undefined && (!candidate.declarativePlugins || typeof candidate.declarativePlugins !== 'object' || Array.isArray(candidate.declarativePlugins))) throw new BuilderStoreError('ساختار بسته‌های مؤلفه معتبر نیست.', 500, 'plugin_packages_invalid');
	const pages: Record<string, BuilderPageRecord> = Object.create(null) as Record<string, BuilderPageRecord>;
	for (const [slug, raw] of Object.entries(candidate.pages)) {
		assertSlug(slug);
		if (!raw || typeof raw !== 'object' || raw.slug !== slug || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || !Array.isArray(raw.revisions) ||
			(raw.updatedAt !== undefined && typeof raw.updatedAt !== 'string') ||
			(raw.publishedAt !== undefined && typeof raw.publishedAt !== 'string') ||
			(raw.publishedRevision !== undefined && (!Number.isSafeInteger(raw.publishedRevision) || raw.publishedRevision < 1))) {
			throw new BuilderStoreError(`رکورد صفحهٔ «${slug}» معتبر نیست و تغییر داده نمی‌شود.`, 500, 'record_invalid');
		}
		const draft = validateDocument(raw.draft, slug);
		const publishedDocument = raw.publishedDocument === undefined ? undefined : validateDocument(raw.publishedDocument, slug);
		const revisions = raw.revisions.map((revision) => {
			if (!revision || typeof revision !== 'object' || !Number.isSafeInteger(revision.revision) || typeof revision.savedAt !== 'string') {
				throw new BuilderStoreError(`تاریخچهٔ صفحهٔ «${slug}» معتبر نیست.`, 500, 'history_invalid');
			}
			return { ...revision, revision: revision.revision, savedAt: revision.savedAt, document: validateDocument(revision.document, slug) };
		});
		let installation: SiteKitInstallation | undefined;
		if (raw.installation !== undefined) {
			const value = raw.installation;
			if (!value || value.kind !== 'site-kit' || !isValidPageSlug(value.id) || !isValidPageSlug(value.prefix) || !isSemVer(value.version) || typeof value.baselineHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.baselineHash) || !slug.startsWith(`${value.prefix}-`)) {
				throw new BuilderStoreError(`منشأ نصب صفحهٔ «${slug}» معتبر نیست.`, 500, 'installation_invalid');
			}
			const pageSlugs = value.pageSlugs;
			if (pageSlugs !== undefined && (!Array.isArray(pageSlugs) || !pageSlugs.length || pageSlugs.length > 20 || new Set(pageSlugs).size !== pageSlugs.length || pageSlugs.some((item) => !isValidPageSlug(item) || !item.startsWith(`${value.prefix}-`)) || !pageSlugs.includes(slug))) {
				throw new BuilderStoreError(`فهرست صفحه‌های نصب‌شدهٔ «${slug}» معتبر نیست.`, 500, 'installation_invalid');
			}
			const baselineDocument = value.baselineDocument === undefined ? undefined : validateDocument(value.baselineDocument, slug);
			if (baselineDocument && !matchesInstalledBaseline(baselineDocument, value.baselineHash)) throw new BuilderStoreError(`نسخهٔ پایهٔ بستهٔ «${slug}» معتبر نیست.`, 500, 'installation_invalid');
			installation = { ...value, kind: 'site-kit', id: value.id, prefix: value.prefix, version: value.version, baselineHash: value.baselineHash, ...(baselineDocument ? { baselineDocument } : {}), ...(pageSlugs ? { pageSlugs: [...pageSlugs].sort() } : {}) };
		}
		pages[slug] = {
			...raw,
			slug,
			revision: raw.revision,
			updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
			draft,
			...(publishedDocument ? { publishedDocument } : {}),
			...(Number.isSafeInteger(raw.publishedRevision) ? { publishedRevision: raw.publishedRevision } : {}),
			...(typeof raw.publishedAt === 'string' ? { publishedAt: raw.publishedAt } : {}),
			revisions,
			...(installation ? { installation } : {}),
		};
	}
	const templates: Record<string, BuilderTemplateRecord> = {};
	for (const [id, raw] of Object.entries(candidate.templates ?? {})) {
		assertTemplateId(id);
		if (!raw || typeof raw !== 'object' || raw.id !== id || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 60 || typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') {
			throw new BuilderStoreError(`قالب «${id}» معتبر نیست و تغییر داده نمی‌شود.`, 500, 'template_invalid');
		}
		let document: PageDocument;
		try {
			document = validatePageDocument(raw.document);
		} catch (error) {
			throw new BuilderStoreError(error instanceof Error ? error.message : 'سند قالب معتبر نیست.', 500, 'template_document_invalid');
		}
		templates[id] = { ...raw, id, name: raw.name, createdAt: raw.createdAt, updatedAt: raw.updatedAt, document };
	}
	const sections: Record<string, SharedSectionRecord> = {};
	if (Object.keys(candidate.sections ?? {}).length > MAX_SHARED_SECTIONS) throw new BuilderStoreError('تعداد بخش‌های مشترک معتبر نیست.', 500, 'sections_invalid');
	for (const [id, raw] of Object.entries(candidate.sections ?? {})) {
		if (!raw || Object.keys(raw).some((key) => !['id', 'name', 'revision', 'updatedAt', 'node', 'breakpoints', 'versions'].includes(key)) || !isSharedSectionId(id) || raw.id !== id || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 60 || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || typeof raw.updatedAt !== 'string' || !Array.isArray(raw.versions) || !raw.versions.length || raw.versions.length > MAX_SHARED_VERSIONS) {
			throw new BuilderStoreError('رکورد بخش مشترک معتبر نیست و بازنویسی نمی‌شود.', 500, 'section_invalid');
		}
		let node: ContainerNode;
		let breakpoints: PageDocument['breakpoints'];
		if (raw.node?.sharedSection !== undefined) throw new BuilderStoreError('منبع بخش مشترک نباید پیوند تو‌در‌تو داشته باشد.', 500, 'section_invalid');
		try { breakpoints = normalizeBreakpointWidths(raw.breakpoints); node = normalizeSectionNode(raw.node, breakpoints); }
		catch { throw new BuilderStoreError('سند بخش مشترک معتبر نیست و بازنویسی نمی‌شود.', 500, 'section_invalid'); }
		const versions = raw.versions.map((item) => {
			if (!item || Object.keys(item).some((key) => !['revision', 'hash'].includes(key)) || !Number.isSafeInteger(item.revision) || item.revision < 1 || typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash)) throw new BuilderStoreError('تاریخچهٔ بخش مشترک معتبر نیست.', 500, 'section_invalid');
			return { revision: item.revision, hash: item.hash };
		});
		if (versions.some((item, index) => index > 0 && item.revision <= versions[index - 1].revision) || versions.at(-1)?.revision !== raw.revision || versions.at(-1)?.hash !== sectionHash(node, breakpoints)) throw new BuilderStoreError('نسخهٔ بخش مشترک معتبر نیست.', 500, 'section_invalid');
		sections[id] = { id, name: raw.name, revision: raw.revision, updatedAt: raw.updatedAt, node, ...(breakpoints ? { breakpoints } : {}), versions };
	}
	const declarativePlugins: Record<string, DeclarativePluginRecord> = {};
	if (Object.keys(candidate.declarativePlugins ?? {}).length > 25) throw new BuilderStoreError('تعداد بسته‌های مؤلفه معتبر نیست.', 500, 'plugin_packages_invalid');
	let componentCount = 0;
	let presetCount = 0;
	let processorCount = 0;
	for (const [id, raw] of Object.entries(candidate.declarativePlugins ?? {})) {
		if (!raw || typeof raw !== 'object' || Object.keys(raw).some((key) => !['package', 'active', 'revision', 'updatedAt'].includes(key)) || typeof raw.active !== 'boolean' || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || typeof raw.updatedAt !== 'string') throw new BuilderStoreError('رکورد بستهٔ مؤلفه معتبر نیست.', 500, 'plugin_package_invalid');
		let valid: DeclarativePluginRecord['package'];
		try { valid = validateDeclarativePluginPackage(raw.package); } catch { throw new BuilderStoreError('بستهٔ مؤلفه معتبر نیست و بازنویسی نمی‌شود.', 500, 'plugin_package_invalid'); }
		if (valid.id !== id) throw new BuilderStoreError('شناسهٔ بستهٔ مؤلفه معتبر نیست.', 500, 'plugin_package_invalid');
		componentCount += valid.components.length;
		presetCount += valid.presets?.length ?? 0;
		processorCount += valid.processors?.length ?? 0;
		declarativePlugins[id] = { package: valid, active: raw.active, revision: raw.revision, updatedAt: raw.updatedAt };
	}
	if (componentCount > 50 || presetCount > 50 || processorCount > 20) throw new BuilderStoreError('تعداد مؤلفه‌ها یا پیش‌تنظیم‌های بسته‌ها معتبر نیست.', 500, 'plugin_packages_invalid');
	return { ...candidate, schemaVersion: DATABASE_SCHEMA_VERSION, pages, templates, sections, declarativePlugins };
}

async function writeDatabase(database: BuilderDatabase): Promise<void> {
	if (builderStoreMode() === 'postgres') {
		const remote = (database as VersionedBuilderDatabase)[REMOTE_VERSION];
		if (!remote) throw new BuilderStoreError('نسخهٔ مخزن صفحه‌ساز در دسترس نیست؛ هیچ تغییری ذخیره نشد.', 503, 'storage_state_missing');
		try { await writeSnapshotStore(remote.marker, remote.revision, database, builderSnapshotClient); }
		catch (error) { builderStorageError(error, true); }
		return;
	}
	const target = builderDatabasePath();
	await mkdir(path.dirname(target), { recursive: true });
	const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
	const data = `${JSON.stringify(database, null, '\t')}\n`;
	try {
		await writeFile(temporary, data, { encoding: 'utf8', flag: 'wx' });
		await rename(temporary, target);
	} catch (error) {
		await import('node:fs/promises').then(({ unlink }) => unlink(temporary).catch(() => undefined));
		throw new BuilderStoreError('ذخیرهٔ صفحه‌ساز انجام نشد؛ تغییرات محلی نگه داشته شده‌اند.', 500, 'storage_write_failed');
	}
}

/** Explicit offline import; existing documents, publications and revisions remain in the source file. */
export async function migrateBuilderToPostgres(options: { allowEmpty?: boolean } = {}): Promise<void> {
	try { await serializeWrite(() => migrateSnapshotFile(builderDatabasePath(), emptyBuilderDatabase(), (raw) => { normalizeBuilderDatabase(raw); }, options.allowEmpty === true, builderSnapshotClient)); }
	catch (error) {
		if (error instanceof AppError && error.status === 409) throw new BuilderStoreError('مقصد PostgreSQL از پیش دارای داده است یا انتقال قبلی تغییر کرده است؛ هیچ داده‌ای بازنویسی نشد.', 409, 'migration_conflict');
		builderStorageError(error);
	}
}

/** Export a consistent builder snapshot to a new private file, never over the source. */
export async function exportPostgresBuilder(destination: string): Promise<void> {
	if (builderStoreMode() !== 'postgres') throw new BuilderStoreError('برای خروجی‌گرفتن، مخزن PostgreSQL باید فعال باشد.', 503, 'storage_configuration');
	try { await exportSnapshotFile(builderDatabasePath(), destination, (raw) => { normalizeBuilderDatabase(raw); }, builderSnapshotClient); }
	catch (error) { builderStorageError(error); }
}
