import type { APIRoute } from 'astro';
import { asBoolean, asText, failure, json, readPayload, redirect } from '../../../lib/cms/http';
import {
	activatePlugin,
	deactivatePlugin,
	findPlugin,
	savePluginOption,
	uninstallPlugin,
} from '../../../lib/plugins/registry';
import type { PluginSetting } from '../../../lib/plugins/types';

export const prerender = false;

const FLASH: Record<string, string> = {
	activate: 'plugin-activated',
	deactivate: 'plugin-deactivated',
	'save-options': 'plugin-options-saved',
	uninstall: 'plugin-uninstalled',
};

/**
 * مقدار فرم را به همان تایپی تبدیل می‌کند که در مانیفست اعلام شده است؛
 * بدون این کار عددها رشته ذخیره می‌شدند و مقایسه‌ها در افزونه‌ها می‌شکست.
 */
function readSetting(setting: PluginSetting, payload: Record<string, unknown>): unknown {
	const raw = payload[`opt_${setting.key}`];

	if (setting.type === 'switch') return asBoolean(raw);

	const text = asText(raw).trim();
	if (setting.type === 'number') {
		const value = Number(text);
		if (!Number.isFinite(value)) throw new Error(`مقدار «${setting.label}» باید عدد باشد.`);
		return value;
	}

	return text;
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
		if (action === 'uninstall') await uninstallPlugin(id);

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
