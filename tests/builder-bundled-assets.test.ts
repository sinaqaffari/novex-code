import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import { lstat, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(os.tmpdir(), 'novex-bundled-artwork-'));
const previous = process.env.CMS_ASSETS_DIR;
process.env.CMS_ASSETS_DIR = path.join(root, 'assets');
await mkdir(process.env.CMS_ASSETS_DIR, { recursive: true });
const { assetExists, listMedia, readAsset, resolveAssetPath } = await import('../src/lib/cms/media.ts');

after(async () => {
	if (previous === undefined) delete process.env.CMS_ASSETS_DIR;
	else process.env.CMS_ASSETS_DIR = previous;
	await rm(root, { recursive: true, force: true });
});

it('serves bundled starter artwork when a custom library is empty without copying or overwriting files', async () => {
	const names = ['builder-studio.jpg', 'builder-journey.jpg', 'builder-portfolio.jpg', 'builder-shop.jpg'];
	for (const name of names) {
		assert.equal(await assetExists(name), true);
		assert.equal((await readAsset(name)).type, 'image/jpeg');
		await assert.rejects(lstat(path.join(root, 'assets', name)), { code: 'ENOENT' });
	}
	const media = await listMedia();
	for (const name of names) {
		const item = media.find((entry) => entry.name === name);
		assert.equal(item?.builtin, true);
		assert.equal(item?.publicUrl, `/media/${name}`);
		assert.equal(item?.reference, `/media/${name}`);
		assert.equal(item?.previewUrl, `/cms/media/file/${name}`);
	}
	assert.equal(await assetExists('other-missing.jpg'), false);
	assert.equal(await assetExists('uploads/builder-studio.jpg'), false);
});

it('never masks a user-owned file or a symlink with bundled artwork', async () => {
	const target = path.join(root, 'assets', 'builder-studio.jpg');
	await writeFile(target, 'user-owned');
	assert.equal(resolveAssetPath('builder-studio.jpg'), target);
	assert.equal((await readAsset('builder-studio.jpg')).body.toString(), 'user-owned');
	assert.equal((await listMedia()).filter((entry) => entry.name === 'builder-studio.jpg').length, 1);
	await unlink(target);
	await symlink(path.join(root, 'not-an-asset'), target);
	assert.equal(resolveAssetPath('builder-studio.jpg'), target);
	assert.equal(await assetExists('builder-studio.jpg'), false);
});
