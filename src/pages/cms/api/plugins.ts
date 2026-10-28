import type { APIRoute } from 'astro';
import { asText, failure, json, readPayload, redirect } from '../../../lib/cms/http';
import {
	activatePlugin,
	deactivatePlugin,
	findPlugin,
	savePluginOptions,
	uninstallPlugin,
} from '../../../lib/plugins/registry';

export const prerender = false;

const FLASH: Record<string, string> = {
	activate: 'plugin-activated',
	deactivate: 'plugin-deactivated',
	'save-options': 'plugin-options-saved',
	uninstall: 'plugin-uninstalled',
};

export const POST: APIRoute = async ({ request }) => {
	const wantsJsonRequest = (request.headers.get('accept') ?? '').includes('application/json');

	try {
		const payload = await readPayload(request);
		const action = asText(payload.action);
		const id = asText(payload.pluginId);
		const plugin = findPlugin(id);

		if (!plugin) return failure('افزونهٔ مورد نظر نصب نشده است.', 404);
		if (!Object.hasOwn(FLASH, action)) return failure('درخواست نامعتبر است.', 400);

		if (action === 'activate') await activatePlugin(id);
		if (action === 'deactivate') await deactivatePlugin(id);
		if (action === 'uninstall') await uninstallPlugin(id);

		if (action === 'save-options') {
			if (!plugin.active) {
				return failure('برای ذخیرهٔ تنظیمات، افزونه باید فعال باشد.', 409);
			}
			const settings = plugin.manifest.settings ?? [];
			const values: Record<string, unknown> = {};
			for (const setting of settings) {
				if (setting.secret) continue;
				values[setting.key] = payload[`opt_${setting.key}`];
			}
			await savePluginOptions(id, values);
		}

		const target = `/cms/plugins?flash=${FLASH[action]}`;
		return wantsJsonRequest ? json({ ok: true, redirect: target }) : redirect(target);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'عملیات افزونه انجام نشد.';
		return wantsJsonRequest
			? failure(message, 400)
			: redirect(`/cms/plugins?error=${encodeURIComponent(message)}`);
	}
};
