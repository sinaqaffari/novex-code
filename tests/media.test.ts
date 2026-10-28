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
