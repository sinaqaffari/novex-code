import { createEmptyPageDocument } from '../../src/lib/builder/document.ts';
import { addNode, updateNodeProps } from '../../src/lib/builder/operations.ts';
import type { PluginApi } from '../../src/lib/plugins/types.ts';

export function register(api: PluginApi): void {
	api.addFilter('builder.presets', (value: unknown) => {
		if (!Array.isArray(value)) throw new Error('Invalid preset list');
		let document = addNode(createEmptyPageDocument('announcement-preset', 'اطلاع‌رسانی'), 'Container', { id: 'node_announce01' });
		document = updateNodeProps(document, 'node_announce01', { background: 'soft', padding: 16 });
		document = addNode(document, 'Text', { parentId: 'node_announce01', id: 'node_announcetext01' });
		document = updateNodeProps(document, 'node_announcetext01', { text: 'متن اطلاع‌رسانی خود را اینجا بنویسید.', align: 'center' });
		return [...value, { id: 'announcement-preset-bar', label: 'نوار اطلاع‌رسانی', description: 'رونوشت بومی و قابل ویرایش؛ وابستگی اجرایی ندارد.', document, parameters: [{ key: 'message', label: 'متن اطلاع‌رسانی', nodeId: 'node_announcetext01', property: 'text', defaultValue: 'متن اطلاع‌رسانی خود را اینجا بنویسید.', maxLength: 500 }]  }];
	});
}
