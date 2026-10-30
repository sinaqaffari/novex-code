import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ZipFile } from 'yazl';
import { inspectWordPressArchive } from '../src/lib/migrations/wordpress/archive.ts';
import { wxrToDraftPages } from '../src/lib/migrations/wordpress/wxr.ts';
import { getDraftPage, getPublishedPage, listBuilderAssetUsages, saveDraftPage } from '../src/lib/builder/store.ts';
import { createEmptyPageDocument } from '../src/lib/builder/document.ts';
import { deleteUpload, UPLOAD_DIR } from '../src/lib/cms/media.ts';

async function image(): Promise<Buffer> { return sharp(randomBytes(12 * 12 * 3), { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer(); }
function wxr(attachmentPath = '2024/hero.png', attachmentUrl = 'http://127.0.0.1/wp-content/uploads/2024/hero.png'): string {
	const html = `<p>متن وردپرس</p><img class="wp-image-42" src="${attachmentUrl}" alt="تصویر صفحه">`;
	const elementor = JSON.stringify([{ id: 'source-image', elType: 'widget', widgetType: 'image', settings: { image: { id: 42, url: attachmentUrl, alt: 'تصویر المنتور' } }, elements: [] }]);
	return `<rss><channel><wp:wxr_version>1.2</wp:wxr_version>
	<item><title>نوشته</title><wp:post_type>post</wp:post_type><content:encoded><![CDATA[${html}]]></content:encoded></item>
	<item><title>صفحه</title><wp:post_type>page</wp:post_type><content:encoded><![CDATA[<p>جایگزین</p>]]></content:encoded><wp:postmeta><wp:meta_key>_elementor_data</wp:meta_key><wp:meta_value><![CDATA[${elementor}]]></wp:meta_value></wp:postmeta></item>
	<item><title>تصویر</title><wp:post_type>attachment</wp:post_type><wp:post_id>42</wp:post_id><wp:attachment_url>${attachmentUrl}</wp:attachment_url><wp:postmeta><wp:meta_key>_wp_attached_file</wp:meta_key><wp:meta_value>${attachmentPath}</wp:meta_value></wp:postmeta></item>
	</channel></rss>`;
}
async function zip(entries: { name: string; data: Buffer; mode?: number }[]): Promise<Buffer> {
	const file = new ZipFile(); const chunks: Buffer[] = [];
	const result = new Promise<Buffer>((resolve, reject) => { file.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); file.outputStream.on('end', () => resolve(Buffer.concat(chunks))); file.outputStream.on('error', reject); });
	for (const entry of entries) file.addBuffer(entry.data, entry.name, entry.mode === undefined ? {} : { mode: entry.mode });
	file.end(); return result;
}
function request(bytes: Buffer, action: 'inspect' | 'install', prefix = 'wp-bundle', confirm = true, preferElementor = true): Request {
	const form = new FormData(); form.set('archive', new File([new Uint8Array(bytes)], 'wordpress.zip', { type: 'application/zip' })); form.set('action', action);
	if (action === 'install') { form.set('prefix', prefix); form.set('preferElementor', String(preferElementor)); if (confirm) form.set('confirm', 'true'); }
	return new Request('http://local/cms/api/builder/imports/wordpress-archive', { method: 'POST', body: form });
}
async function isolated(run: (created: Set<string>) => Promise<void>) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'novex-wxr-archive-')); const old = process.env.BUILDER_DATA_FILE; const created = new Set<string>(); process.env.BUILDER_DATA_FILE = path.join(dir, 'builder.json');
	try { await run(created); } finally {
		if (old === undefined) delete process.env.BUILDER_DATA_FILE; else process.env.BUILDER_DATA_FILE = old;
		await rm(dir, { recursive: true, force: true });
		for (const name of created) await deleteUpload(name).catch(() => undefined);
	}
}

describe('offline WordPress WXR and media ZIP', () => {
	it('inspects attachments without writing and maps HTML and embedded Elementor to local references', async () => {
		const pixels = await image(); const bytes = await zip([{ name: 'wordpress.xml', data: Buffer.from(wxr()) }, { name: 'wp-content/uploads/2024/hero.png', data: pixels }]);
		const inspected = await inspectWordPressArchive(bytes);
		const hash = createHash('sha256').update(pixels).digest('hex');
		assert.equal(inspected.assets[0].destination, `media://uploads/kit-${hash}.png`);
		assert.equal(inspected.matchedAttachments, 1); assert.equal(inspected.unmatchedAttachments, 0);
		const documents = wxrToDraftPages(inspected.inspection, 'local-wp', true, inspected.mediaMap);
		assert.equal(documents[0].nodes[1].type === 'Image' && documents[0].nodes[1].props.src, inspected.assets[0].destination);
		assert.equal(documents[1].nodes[0].type === 'Image' && documents[1].nodes[0].props.src, inspected.assets[0].destination);
		assert.doesNotMatch(JSON.stringify(documents), /127\.0\.0\.1/);
		await assert.rejects(stat(path.join(UPLOAD_DIR, `kit-${hash}.png`)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
	});
	it('rejects very large embedded Elementor arrays without argument-stack exhaustion', async () => {
		const elementor = JSON.stringify(Array.from({ length: 130_000 }, () => 0));
		const xml = `<rss><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Oversized</title><wp:post_type>page</wp:post_type><wp:postmeta><wp:meta_key>_elementor_data</wp:meta_key><wp:meta_value><![CDATA[${elementor}]]></wp:meta_value></wp:postmeta></item></channel></rss>`;
		const bytes = await zip([{ name: 'wordpress.xml', data: Buffer.from(xml) }]);
		await assert.rejects(inspectWordPressArchive(bytes), (error: unknown) => error instanceof Error && !(error instanceof RangeError) && /Elementor/.test(error.message));
	});
	it('rejects executable, duplicate, invalid, traversal and ambiguous archive contents', async () => {
		const pixels = await image();
		const entries = [{ name: 'wordpress.xml', data: Buffer.from(wxr()) }, { name: 'wp-content/uploads/2024/hero.png', data: pixels }];
		for (const extra of [{ name: 'plugins/evil.php', data: Buffer.from('<?php') }, { name: 'wp-content/uploads/2024/hero.png', data: pixels }, { name: 'second.xml', data: Buffer.from(wxr()) }, { name: 'wp-content/uploads/2024/link.png', data: pixels, mode: 0o120777 }]) await assert.rejects(inspectWordPressArchive(await zip([...entries, extra])));
		await assert.rejects(inspectWordPressArchive(await zip([entries[0], { name: 'wp-content/uploads/2024/hero.png', data: Buffer.from('not an image') }])));
		await assert.rejects(inspectWordPressArchive(await zip([{ name: 'wordpress.xml', data: Buffer.from(wxr('../secret.png')) }, entries[1]])));
		await assert.rejects(inspectWordPressArchive(await zip([{ name: 'wordpress.xml', data: Buffer.from(wxr('2024/other.png')) }, entries[1]])), /تعارض/);
		const missing = await inspectWordPressArchive(await zip([entries[0]]));
		assert.equal(missing.unmatchedAttachments, 1); assert.equal(missing.assets.length, 0);
	});
	it('requires role and confirmation, creates all drafts with protected assets and never publishes', async () => isolated(async (created) => {
		const { POST } = await import('../src/pages/cms/api/builder/imports/wordpress-archive.ts');
		const pixels = await image(); const bytes = await zip([{ name: 'wordpress.xml', data: Buffer.from(wxr()) }, { name: 'wp-content/uploads/2024/hero.png', data: pixels }]);
		const call = (role: string, action: 'inspect' | 'install', confirm = true) => POST({ locals: { cmsUser: { role } }, request: request(bytes, action, 'wp-bundle', confirm) } as never);
		assert.equal((await call('subscriber', 'inspect')).status, 403);
		const review = await call('contributor', 'inspect'); assert.equal(review.status, 200);
		const summary = (await review.json()).summary; assert.equal(summary.items.length, 2); assert.equal(summary.assetCount, 1); assert.equal(summary.matchedAttachments, 1);
		assert.equal((await call('contributor', 'install')).status, 403);
		assert.equal((await call('editor', 'install', false)).status, 400);
		const response = await call('editor', 'install'); assert.equal(response.status, 201);
		const installed = await response.json(); for (const name of installed.createdUploads as string[]) created.add(name);
		assert.equal(installed.uploaded, 1); assert.deepEqual(installed.pages.map((page: { slug: string }) => page.slug), ['wp-bundle-1', 'wp-bundle-2']);
		const name = installed.createdUploads[0] as string;
		const first = (await getDraftPage('wp-bundle-1')).draft; const second = (await getDraftPage('wp-bundle-2')).draft;
		assert.equal(first.nodes[1].type === 'Image' && first.nodes[1].props.src, `media://uploads/${name}`);
		assert.equal(second.nodes[0].type === 'Image' && second.nodes[0].props.src, `media://uploads/${name}`);
		assert.equal(await getPublishedPage('wp-bundle-1'), null);
		assert.ok((await listBuilderAssetUsages(`uploads/${name}`)).some((use) => use.scope === 'draft'));
		await assert.rejects(deleteUpload(name), (error: unknown) => (error as { status?: number }).status === 409);
	}));
	it('rolls back new images when a draft slug collides', async () => isolated(async () => {
		const { POST } = await import('../src/pages/cms/api/builder/imports/wordpress-archive.ts');
		await saveDraftPage({ slug: 'collide-1', expectedRevision: 0, document: createEmptyPageDocument('collide-1') });
		const pixels = await image(); const hash = createHash('sha256').update(pixels).digest('hex');
		const bytes = await zip([{ name: 'wordpress.xml', data: Buffer.from(wxr()) }, { name: 'wp-content/uploads/2024/hero.png', data: pixels }]);
		const response = await POST({ locals: { cmsUser: { role: 'editor' } }, request: request(bytes, 'install', 'collide') } as never);
		assert.equal(response.status, 409);
		assert.equal((await getDraftPage('collide-1')).revision, 1);
		assert.equal((await getDraftPage('collide-2')).revision, 0);
		await assert.rejects(stat(path.join(UPLOAD_DIR, `kit-${hash}.png`)), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
	}));
});
