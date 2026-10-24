import type { APIRoute } from 'astro';
import { asBoolean, asText, failure, json, readPayload, redirect } from '../../../lib/cms/http';
import {
	activatePlugin,
	deactivatePlugin,
	findPlugin,
	savePluginOption,
} from '../../../lib/plugins/registry';
import type { PluginSetting } from '../../../lib/plugins/types';

export const prerender = false;

const FLASH: Record<string, string> = {
	activate: 'plugin-activated',
	deactivate: 'plugin-deactivated',
	'save-options': 'plugin-options-saved',
};

function readSetting(setting: PluginSetting, payload: Record<string, unknown>): unknown {
	if (setting.type === 'switch') return asBoolean(payload[`opt_${setting.key}`]);
	return asText(payload[`opt_${setting.key}`]).trim();
}

export const POST: APIRoute = async ({ request }) => {
	const wantsJsonRequest = (request.headers.get('accept') ?? '').includes('application/json');

	try {
		const payload = await readPayload(request);
		const action = asText(payload.action);
		const id = asText(payload.pluginId);
		const plugin = findPlugin(id);

		if (!plugin) return failure('افزونهٔ مورد نظر نصب نشده است.', 404);
		if (!FLASH[action]) return failure('درخواست نامعتبر است.', 400);

		if (action === 'activate') await activatePlugin(id);
		if (action === 'deactivate') await deactivatePlugin(id);

		if (action === 'save-options') {
			if (!plugin.active) {
				return failure('برای ذخیرهٔ تنظیمات، افزونه باید فعال باشد.', 409);
			}
			for (const setting of plugin.manifest.settings ?? []) {
				await savePluginOption(id, setting.key, readSetting(setting, payload));
			}
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
