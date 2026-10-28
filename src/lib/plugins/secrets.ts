/** Plugin secret settings are supplied by the deployment environment, never JSON state. */

const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SETTING_KEY = /^[a-z][a-zA-Z0-9_]{0,63}$/;

export function pluginSecretEnvironmentName(pluginId: string, key: string): string {
	if (!PLUGIN_ID.test(pluginId) || !SETTING_KEY.test(key)) throw new Error('شناسهٔ راز افزونه معتبر نیست.');
	const pluginPart = pluginId.replaceAll('-', '_').toUpperCase();
	const keyPart = key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
	return `NOVEX_PLUGIN_${pluginPart}_${keyPart}`;
}

export function readPluginSecret(pluginId: string, key: string): string {
	return process.env[pluginSecretEnvironmentName(pluginId, key)] ?? '';
}

export function hasPluginSecret(pluginId: string, key: string): boolean {
	return readPluginSecret(pluginId, key).length > 0;
}
