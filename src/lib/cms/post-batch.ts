import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../errors.ts';

interface Identity { dev: string; ino: string }
interface Entry extends Identity { id: string; stage: string; sha256: string }
interface Journal { version: 1; state: 'pending' | 'committed'; entries: Entry[] }
export interface PreparedBlogPost { id: string; contents: string }
const JOURNAL = /^\.post-batch-([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.json$/;
const MAX_BATCH = 20;
const MAX_POST_BYTES = 5 * 1024 * 1024;
const MAX_BATCH_BYTES = 32 * 1024 * 1024;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const journalError = () => new AppError('بازیابی ورود گروهی نوشته‌ها کامل نیست؛ هیچ فایل نامرتبطی حذف نشد. پیش از ادامه وضعیت ذخیره‌سازی را بررسی کنید.', undefined, 503);

async function exists(file: string) {
	try { return await lstat(file, { bigint: true }); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
const matches = (info: { dev: bigint; ino: bigint }, identity: Identity) => info.dev.toString() === identity.dev && info.ino.toString() === identity.ino;

async function writeExclusive(file: string, contents: string, created: (identity: Identity) => void): Promise<void> {
	const handle = await open(file, 'wx', 0o600);
	try {
		const info = await handle.stat({ bigint: true });
		created({ dev: info.dev.toString(), ino: info.ino.toString() });
		await handle.writeFile(contents, 'utf8');
		await handle.sync();
	} finally { await handle.close(); }
}

async function removeOwned(file: string, identity: Identity): Promise<void> {
	const info = await exists(file);
	if (!info) return;
	if (!info.isFile() || info.isSymbolicLink() || !matches(info, identity)) throw journalError();
	await unlink(file);
}

function parseJournal(value: unknown, token: string): Journal {
	if (!isRecord(value) || Object.keys(value).some((key) => !['version', 'state', 'entries'].includes(key)) || value.version !== 1 || (value.state !== 'pending' && value.state !== 'committed') || !Array.isArray(value.entries) || !value.entries.length || value.entries.length > MAX_BATCH) throw journalError();
	const seen = new Set<string>();
	const entries: Entry[] = value.entries.map((item, index) => {
		if (!isRecord(item) || Object.keys(item).some((key) => !['id', 'stage', 'sha256', 'dev', 'ino'].includes(key)) || typeof item.id !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}-]{0,119}\.md$/u.test(item.id) || seen.has(item.id) || item.stage !== `.post-batch-${token}-${index}.tmp` || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || typeof item.dev !== 'string' || !/^\d{1,30}$/.test(item.dev) || typeof item.ino !== 'string' || !/^\d{1,30}$/.test(item.ino)) throw journalError();
		seen.add(item.id);
		return { id: item.id, stage: item.stage, sha256: item.sha256, dev: item.dev, ino: item.ino };
	});
	return { version: 1, state: value.state, entries };
}

/** Caller must hold the shared Builder/media/post filesystem lock. Pending
 * batches are rolled back only when a destination is still our unmodified
 * staged inode. Committed batches are retained and only staging is cleaned. */
export async function recoverPostBatchesUnderLock(blogDir: string): Promise<void> {
	let names: string[];
	try { names = await readdir(blogDir); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw journalError(); }
	for (const name of names.filter((entry) => JOURNAL.test(entry)).sort()) {
		const token = JOURNAL.exec(name)![1];
		const journalPath = path.join(blogDir, name);
		let journal: Journal;
		try {
			const info = await lstat(journalPath);
			if (!info.isFile() || info.isSymbolicLink() || info.size > 32_000) throw journalError();
			journal = parseJournal(JSON.parse(await readFile(journalPath, 'utf8')) as unknown, token);
		} catch { throw journalError(); }
		const ownedTargets: string[] = [];
		try {
			for (const entry of journal.entries) {
				const stagePath = path.join(blogDir, entry.stage);
				const targetPath = path.join(blogDir, entry.id);
				const stage = await exists(stagePath);
				const target = await exists(targetPath);
				if (stage && (!stage.isFile() || stage.isSymbolicLink() || !matches(stage, entry) || stage.size > BigInt(MAX_POST_BYTES))) throw journalError();
				if (journal.state === 'committed') {
					// Do not erase a possible last surviving copy if an external actor
					// changed a committed target before recovery completed.
					if (stage && (!target || !matches(target, entry))) throw journalError();
					continue;
				}
				if (!target) continue;
				if (!stage) throw journalError();
				// A different inode belongs to another writer; never remove it.
				if (!matches(target, entry)) continue;
				if (!target.isFile() || target.isSymbolicLink() || hash(await readFile(stagePath)) !== entry.sha256) throw journalError();
				ownedTargets.push(targetPath);
			}
			for (const target of ownedTargets) await unlink(target);
			for (const entry of journal.entries) await removeOwned(path.join(blogDir, entry.stage), entry);
			await unlink(journalPath);
		} catch { throw journalError(); }
	}
}

/** Stage a bounded batch, publish complete files under exclusive names, then
 * mark the journal committed. No unrelated target is ever overwritten. */
export async function commitPostBatchUnderLock(blogDir: string, posts: PreparedBlogPost[]): Promise<string[]> {
	if (!posts.length || posts.length > MAX_BATCH) throw new AppError('تعداد نوشته‌ها برای ورود گروهی معتبر نیست.', undefined, 422);
	const sizes = posts.map((post) => Buffer.byteLength(post.contents, 'utf8'));
	if (sizes.some((size) => size > MAX_POST_BYTES) || sizes.reduce((total, size) => total + size, 0) > MAX_BATCH_BYTES) throw new AppError('حجم نوشته‌های گروهی بیش از حد مجاز است.', undefined, 413);
	const token = randomUUID();
	const journalPath = path.join(blogDir, `.post-batch-${token}.json`);
	const temporaryJournal = path.join(blogDir, `.post-batch-${token}.journal.tmp`);
	const entries: Entry[] = [];
	const stagesOwned: Array<{ path: string; identity: Identity }> = [];
	let temporaryOwned: Identity | undefined;
	let journalOwned = false;
	let committed = false;
	try {
		// Staging precedes the journal, so a crash during this phase can leave
		// only hidden orphan files, never a partially visible batch.
		for (let index = 0; index < posts.length; index++) {
			const stage = `.post-batch-${token}-${index}.tmp`;
			const stagePath = path.join(blogDir, stage);
			let identity: Identity | undefined;
			await writeExclusive(stagePath, posts[index].contents, (created) => { identity = created; stagesOwned.push({ path: stagePath, identity: created }); });
			if (!identity) throw journalError();
			entries.push({ id: posts[index].id, stage, sha256: hash(posts[index].contents), ...identity });
		}
		const pending = parseJournal({ version: 1, state: 'pending', entries }, token);
		await writeExclusive(temporaryJournal, JSON.stringify(pending), (identity) => { temporaryOwned = identity; });
		await link(temporaryJournal, journalPath); journalOwned = true;
		await removeOwned(temporaryJournal, temporaryOwned!); temporaryOwned = undefined;
		for (const entry of entries) await link(path.join(blogDir, entry.stage), path.join(blogDir, entry.id));
		await writeExclusive(temporaryJournal, JSON.stringify({ ...pending, state: 'committed' }), (identity) => { temporaryOwned = identity; });
		await rename(temporaryJournal, journalPath); temporaryOwned = undefined;
		committed = true;
		await recoverPostBatchesUnderLock(blogDir);
		return entries.map((entry) => entry.id);
	} catch (error) {
		if (temporaryOwned) {
			try { await removeOwned(temporaryJournal, temporaryOwned); } catch { throw journalError(); }
		}
		if (journalOwned) {
			try { await recoverPostBatchesUnderLock(blogDir); } catch { throw journalError(); }
		} else {
			try { for (const stage of stagesOwned) await removeOwned(stage.path, stage.identity); } catch { throw journalError(); }
		}
		if (committed) throw new AppError('نتیجهٔ ورود گروهی نامشخص است؛ پیش از تلاش دوباره فهرست نوشته‌ها را بررسی کنید.', undefined, 503);
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError('یکی از نامک‌ها قبلاً استفاده شده است؛ هیچ نوشته‌ای بازنویسی نشد.', 'slug', 409);
		throw error;
	}
}
