import { crc32 } from 'node:zlib';
import type { Readable } from 'node:stream';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';

export interface ZipEntryPolicy { directory?: boolean; maxBytes: number }
export interface BoundedZipPolicy {
	maxArchiveBytes: number;
	maxExpandedBytes: number;
	maxEntries: number;
	/** Return null for any name not explicitly permitted by the caller. */
	entry: (name: string) => ZipEntryPolicy | null;
}

function openZip(bytes: Buffer): Promise<ZipFile> {
	return new Promise((resolve, reject) => fromBuffer(bytes, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true, autoClose: false }, (error, zip) => error ? reject(error) : resolve(zip)));
}
async function readEntry(zip: ZipFile, entry: Entry, limit: number): Promise<Buffer> {
	const stream = await new Promise<Readable>((resolve, reject) => zip.openReadStream(entry, (error, input) => error ? reject(error) : resolve(input)));
	const chunks: Buffer[] = [];
	let size = 0;
	let checksum = 0;
	for await (const chunk of stream) {
		const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += data.length;
		if (size > limit) { stream.destroy(); throw new Error('حجم فایل بازشده بیش از حد مجاز است.'); }
		checksum = crc32(data, checksum);
		chunks.push(data);
	}
	if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw new Error('اندازه یا checksum یکی از فایل‌های بسته معتبر نیست.');
	return Buffer.concat(chunks, size);
}

/** Lazy, bounded, checksum-checked archive reading. No entry is ever extracted to disk. */
export async function readBoundedZip(bytes: Uint8Array, policy: BoundedZipPolicy): Promise<Map<string, Buffer>> {
	if (!bytes.byteLength || bytes.byteLength > policy.maxArchiveBytes) throw new Error('حجم بسته بیش از حد مجاز است.');
	const zip = await openZip(Buffer.from(bytes));
	const entries = new Map<string, Buffer>();
	const names = new Set<string>();
	let expanded = 0;
	try {
		if (zip.entryCount < 1 || zip.entryCount > policy.maxEntries) throw new Error('تعداد فایل‌های بسته معتبر نیست.');
		await new Promise<void>((resolve, reject) => {
			let complete = false;
			const fail = (error: unknown) => { if (!complete) { complete = true; reject(error instanceof Error ? error : new Error('فایل ZIP معتبر نیست.')); } };
			zip.on('error', fail);
			zip.on('end', () => { if (!complete) { complete = true; resolve(); } });
			zip.on('entry', (entry: Entry) => {
				void (async () => {
					const name = entry.fileName;
					if (names.has(name)) throw new Error('نام فایل تکراری در بسته مجاز نیست.');
					names.add(name);
					const rule = policy.entry(name);
					if (!rule) throw new Error(`فایل ${name.slice(0, 150)} در بسته مجاز نیست.`);
					const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
					if ((entry.versionMadeBy >>> 8) === 3 && mode !== 0 && mode !== (rule.directory ? 0o040000 : 0o100000)) throw new Error('پیوند نمادین یا فایل ویژه در بسته مجاز نیست.');
					if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) throw new Error('فایل رمزگذاری‌شده یا روش فشرده‌سازی پشتیبانی نمی‌شود.');
					if (rule.directory) { if (entry.uncompressedSize !== 0) throw new Error('پوشهٔ بسته نامعتبر است.'); zip.readEntry(); return; }
					if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 1 || entry.uncompressedSize > rule.maxBytes || expanded + entry.uncompressedSize > policy.maxExpandedBytes) throw new Error('حجم محتوای بسته بیش از حد مجاز است.');
					const contents = await readEntry(zip, entry, rule.maxBytes);
					expanded += contents.length;
					entries.set(name, contents);
					zip.readEntry();
				})().catch(fail);
			});
			zip.readEntry();
		});
		return entries;
	} finally { if (zip.isOpen) zip.close(); }
}
