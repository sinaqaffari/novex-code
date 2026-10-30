import assert from 'node:assert/strict';
import { it } from 'node:test';
import { PUT } from '../src/pages/cms/api/builder/pages/[slug].ts';
import { POST as createPage } from '../src/pages/cms/api/builder/pages/index.ts';
import { POST as createTemplate } from '../src/pages/cms/api/builder/templates/index.ts';
import { POST as installKit } from '../src/pages/cms/api/builder/kits/index.ts';

function streamingRequest(bytes: number): Request {
	const chunks = Math.ceil(bytes / 16_000);
	let count = 0;
	return new Request('http://localhost/', {
		method: 'POST', headers: { 'content-type': 'application/json' }, duplex: 'half',
		body: new ReadableStream({ pull(controller) {
			if (count++ >= chunks) controller.close();
			else controller.enqueue(new Uint8Array(Math.min(16_000, bytes - (count - 1) * 16_000)).fill(32));
		} }),
	} as RequestInit & { duplex: 'half' });
}

it('bounds chunked page, template and kit writes even without Content-Length', async () => {
	const locals = { cmsUser: { role: 'editor' } };
	const page = await PUT({ params: { slug: 'limits' }, locals, request: streamingRequest(1_200_001) } as never);
	assert.equal(page.status, 413);
	assert.equal((await page.json()).code, 'payload_too_large');
	const template = await createTemplate({ locals, request: streamingRequest(1_200_001) } as never);
	assert.equal(template.status, 413);
	const kit = await installKit({ locals, request: streamingRequest(4097) } as never);
	assert.equal(kit.status, 413);
	const form = streamingRequest(1_200_001);
	form.headers.set('content-type', 'application/x-www-form-urlencoded');
	form.headers.set('accept', 'application/json');
	assert.equal((await createPage({ locals, request: form } as never)).status, 413);
});

it('bounds chunked multipart media uploads before parsing the form', async () => {
	const { POST: upload } = await import('../src/pages/cms/api/media/upload.ts');
	const request = streamingRequest(16 * 1024 * 1024 + 64 * 1024 + 1);
	request.headers.set('content-type', 'multipart/form-data; boundary=test');
	request.headers.set('accept', 'application/json');
	const response = await upload({ locals: { cmsUser: { role: 'editor' } }, request } as never);
	assert.equal(response.status, 413);
});
