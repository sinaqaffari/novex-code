import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALLOWED_EXTENSIONS, ALLOWED_UPLOAD_EXTENSIONS, resolveAssetPath, saveUpload, validateUploadFile } from '../src/lib/cms/media.ts';

describe('CMS media upload policy', () => {
	it('rejects new SVG uploads while retaining support for existing SVG media', async () => {
		assert.ok(ALLOWED_EXTENSIONS.includes('svg'));
		assert.ok(!ALLOWED_UPLOAD_EXTENSIONS.includes('svg' as never));
		const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'unsafe.svg', {
			type: 'image/svg+xml',
		});
		await assert.rejects(saveUpload(file), /فقط تصاویر JPG، PNG، WebP، AVIF و GIF مجاز هستند/);
	});

	it('checks image signatures and keeps asset reads within the managed assets directory', async () => {
		const spoofedPng = new File(['not actually a PNG'], 'photo.png', { type: 'image/png' });
		await assert.rejects(validateUploadFile(spoofedPng), /محتوای فایل با قالب تصویر انتخاب‌شده سازگار نیست/);
		assert.equal(resolveAssetPath('../../../../etc/passwd'), null);
	});
});

it('inspects image dimensions and rejects truncated or excessive pixel headers', async () => {
	const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=', 'base64');
	await validateUploadFile(new File([png], 'valid.png', { type: 'image/png' }));
	await assert.rejects(validateUploadFile(new File([png.subarray(0, 12)], 'truncated.png', { type: 'image/png' })), /ساختار یا ابعاد تصویر معتبر نیست/);
	const oversized = Buffer.from(png);
	oversized.writeUInt32BE(10_000, 16); oversized.writeUInt32BE(10_000, 20);
	await assert.rejects(validateUploadFile(new File([oversized], 'large.png', { type: 'image/png' })), /ساختار یا ابعاد تصویر معتبر نیست/);
});
