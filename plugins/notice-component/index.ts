import type { PluginApi } from '../../src/lib/plugins/types.ts';

/** Only a declarative snapshot is contributed; the host owns rendering and validation. */
export function register(api: PluginApi): void {
	api.addFilter('builder.components', (value: unknown) => {
		if (!Array.isArray(value)) throw new Error('Invalid component list');
		return [...value, {
			pluginId: api.id, componentId: 'notice-card', pluginVersion: api.manifest.version, label: 'کارت اعلان',
			fields: [
				{ key: 'title', label: 'عنوان اعلان', kind: 'text', value: 'اطلاعیه', maxLength: 120 },
				{ key: 'message', label: 'متن اعلان', kind: 'textarea', value: 'متن اطلاع‌رسانی خود را اینجا بنویسید.', maxLength: 1000 },
				{ key: 'link-label', label: 'متن پیوند', kind: 'text', value: 'بیشتر بدانید', maxLength: 80 },
				{ key: 'link-url', label: 'نشانی پیوند', kind: 'url', value: '/about', maxLength: 500 },
			],
			parts: [
				{ type: 'heading', textKey: 'title' }, { type: 'text', textKey: 'message' },
				{ type: 'button', textKey: 'link-label', hrefKey: 'link-url' },
			],
		}];
	});
}
