import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createEmptyPageDocument, isValidPageSlug, validatePageDocument } from './document.ts';
import type { PageDocument } from './types.ts';

const DATABASE_SCHEMA_VERSION = 1;
const MAX_REVISIONS = 25;
const MAX_TEMPLATES = 50;

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

export interface BuilderPageRecord {
	slug: string;
	revision: number;
	updatedAt: string;
	draft: PageDocument;
	publishedDocument?: PageDocument;
	publishedRevision?: number;
	publishedAt?: string;
	revisions: BuilderRevision[];
}

interface BuilderDatabase {
	schemaVersion: number;
	pages: Record<string, BuilderPageRecord>;
	templates: Record<string, BuilderTemplateRecord>;
}

export class BuilderStoreError extends Error {
	readonly status: number;
	readonly code: string;
	readonly currentRevision?: number;

	constructor(message: string, status: number, code: string, currentRevision?: number) {
		super(message);
		this.name = 'BuilderStoreError';
		this.status = status;
		this.code = code;
		this.currentRevision = currentRevision;
	}
}

let writeQueue: Promise<unknown> = Promise.resolve();

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

export async function saveBuilderTemplate(input: { name: string; document: unknown }): Promise<BuilderTemplateRecord> {
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
}): Promise<BuilderPageRecord> {
	assertSlug(input.slug);
	return serializeWrite(async () => {
		const database = await readDatabase();
		const current = database.pages[input.slug];
		assertExpectedRevision(input.expectedRevision, current?.revision ?? 0);
		const document = validateDocument(input.document, input.slug);
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

export async function publishPage(input: {
	slug: string;
	expectedRevision: number;
	document: unknown;
}): Promise<BuilderPageRecord> {
	assertSlug(input.slug);
	return serializeWrite(async () => {
		const database = await readDatabase();
		const current = database.pages[input.slug];
		assertExpectedRevision(input.expectedRevision, current?.revision ?? 0);
		const document = validateDocument(input.document, input.slug);
		if (document.nodes.length === 0) {
			throw new BuilderStoreError('برای انتشار، دست‌کم یک مؤلفه به صفحه اضافه کنید.', 422, 'empty_page');
		}
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

async function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
	const next = writeQueue.then(operation, operation);
	writeQueue = next.then(() => undefined, () => undefined);
	return next;
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

async function readDatabase(): Promise<BuilderDatabase> {
	const pathName = builderDatabasePath();
	let source: string;
	try {
		source = await readFile(pathName, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { schemaVersion: DATABASE_SCHEMA_VERSION, pages: {}, templates: {} };
		throw new BuilderStoreError('خواندن داده‌های صفحه‌ساز ممکن نشد.', 500, 'storage_read_failed');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		throw new BuilderStoreError('فایل داده‌های صفحه‌ساز خراب است؛ برای جلوگیری از پاک‌شدن اطلاعات، بازنویسی نمی‌شود.', 500, 'storage_corrupt');
	}
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
	const pages: Record<string, BuilderPageRecord> = {};
	for (const [slug, raw] of Object.entries(candidate.pages)) {
		assertSlug(slug);
		if (!raw || typeof raw !== 'object' || raw.slug !== slug || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || !Array.isArray(raw.revisions)) {
			throw new BuilderStoreError(`رکورد صفحهٔ «${slug}» معتبر نیست و تغییر داده نمی‌شود.`, 500, 'record_invalid');
		}
		const draft = validateDocument(raw.draft, slug);
		const publishedDocument = raw.publishedDocument === undefined ? undefined : validateDocument(raw.publishedDocument, slug);
		const revisions = raw.revisions.map((revision) => {
			if (!revision || typeof revision !== 'object' || !Number.isSafeInteger(revision.revision) || typeof revision.savedAt !== 'string') {
				throw new BuilderStoreError(`تاریخچهٔ صفحهٔ «${slug}» معتبر نیست.`, 500, 'history_invalid');
			}
			return { revision: revision.revision, savedAt: revision.savedAt, document: validateDocument(revision.document, slug) };
		});
		pages[slug] = {
			slug,
			revision: raw.revision,
			updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
			draft,
			...(publishedDocument ? { publishedDocument } : {}),
			...(Number.isSafeInteger(raw.publishedRevision) ? { publishedRevision: raw.publishedRevision } : {}),
			...(typeof raw.publishedAt === 'string' ? { publishedAt: raw.publishedAt } : {}),
			revisions,
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
		templates[id] = { id, name: raw.name, createdAt: raw.createdAt, updatedAt: raw.updatedAt, document };
	}
	return { schemaVersion: DATABASE_SCHEMA_VERSION, pages, templates };
}

async function writeDatabase(database: BuilderDatabase): Promise<void> {
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
