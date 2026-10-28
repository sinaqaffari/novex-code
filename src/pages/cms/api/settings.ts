import type { APIRoute } from 'astro';
import { failure, json, readPayload, redirect } from '../../../lib/cms/http';
import { readSettings, writeSettings } from '../../../lib/cms/settings';
import { CmsError } from '../../../lib/cms/posts';

export const prerender = false;

export const GET: APIRoute = async () => {
	const settings = await readSettings();
	return json({ ok: true, settings });
};

export const POST: APIRoute = async ({ request }) => {
	const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
	try {
		const payload = await readPayload(request);
		const settings = await writeSettings(payload);
		if (wantsJson) return json({ ok: true, settings });
		return redirect(`/cms/settings?flash=settings-saved`);
	} catch (error) {
		const message = error instanceof CmsError ? error.message : 'ذخیرهٔ تنظیمات ناموفق بود.';
		const status = error instanceof CmsError ? error.status : 500;
		const field = error instanceof CmsError ? error.field : undefined;
		return wantsJson
			? failure(message, status, field)
			: redirect(`/cms/settings?error=${encodeURIComponent(message)}`);
	}
};
