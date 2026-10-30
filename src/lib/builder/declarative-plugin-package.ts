import { collectPluginComponents } from './plugin-components.ts';
import { validateBuilderPresets, type BuilderPluginPreset } from './plugin-presets.ts';
import { nodeImageReferences } from './assets.ts';
import { traversePageNodes } from './operations.ts';
import { parseBuilderMediaReference } from './media-reference.ts';
import { isSemVer } from '../plugins/validation.ts';
import { validateWasmProcessors, type WasmProcessor } from './plugin-wasm.ts';
import type { PluginBlockProps } from './types.ts';

/** V1/V2 are data-only; V3 adds isolated, import-free numeric WebAssembly processors. */
export interface DeclarativePluginPackage {
	schemaVersion: 1 | 2 | 3;
	id: string;
	version: string;
	name: string;
	description: string;
	components: PluginBlockProps[];
	/** Version 2 additionally supplies parameterized, host-owned native fragments. */
	presets?: BuilderPluginPreset[];
	processors?: WasmProcessor[];
}
export interface DeclarativePluginRecord { package: DeclarativePluginPackage; active: boolean; revision: number; updatedAt: string }

export function validateDeclarativePluginPackage(input: unknown): DeclarativePluginPackage {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('بستهٔ مؤلفه معتبر نیست.');
	const value = input as Record<string, unknown>;
	if (Object.keys(value).some((key) => !['schemaVersion', 'id', 'version', 'name', 'description', 'components', ...(value.schemaVersion === 2 || value.schemaVersion === 3 ? ['presets'] : []), ...(value.schemaVersion === 3 ? ['processors'] : [])].includes(key))) throw new Error('بستهٔ داده‌محور فیلد ناشناخته یا کد اجرایی دارد.');
	if ((value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) || typeof value.id !== 'string' || value.id.length > 80 || !/^data-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) || !isSemVer(value.version) || value.version.length > 80 || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || typeof value.description !== 'string' || value.description.length > 500) throw new Error('شناسه یا مشخصات بستهٔ مؤلفه معتبر نیست.');
	if (!Array.isArray(value.components) || value.components.length > 20 || (value.schemaVersion === 1 && !value.components.length)) throw new Error('فهرست مؤلفه‌های بسته معتبر نیست.');
	const result = collectPluginComponents(value.components);
	if (result.rejected || result.components.length !== value.components.length || result.components.some((component) => component.pluginId !== value.id || component.pluginVersion !== value.version)) throw new Error('مؤلفه‌ها باید معتبر و متعلق به همین شناسه و نسخه باشند.');
	let presets: BuilderPluginPreset[] | undefined;
	if (value.schemaVersion === 2 || value.schemaVersion === 3) {
		if (!Array.isArray(value.presets) || value.presets.length > 10 || (!value.presets.length && !value.components.length)) throw new Error('بسته باید حداقل یک مؤلفه یا پیش‌تنظیم و حداکثر ۱۰ پیش‌تنظیم داشته باشد.');
		presets = validateBuilderPresets(value.presets);
		for (const preset of presets) {
			if (!preset.id.startsWith(`${value.id}-`)) throw new Error('شناسهٔ پیش‌تنظیم باید در فضای نام بسته باشد.');
			traversePageNodes(preset.document, (node) => {
				if (node.type === 'Container' && node.sharedSection) throw new Error('پیش‌تنظیم نمی‌تواند به منبع مشترک سایت دیگری پیوند داشته باشد.');
				if (node.type === 'PluginBlock' && (node.props.pluginId !== value.id || node.props.pluginVersion !== value.version || !result.components.some((component) => component.componentId === node.props.componentId))) throw new Error('مؤلفهٔ پیش‌تنظیم متعلق به این بسته نیست.');
				for (const image of nodeImageReferences(node)) if (image.src && !parseBuilderMediaReference(image.src)) throw new Error('تصویر پیش‌تنظیم باید یک رسانهٔ محلی مدیریت‌شده باشد.');
			});
		}
	}
	const processors = value.schemaVersion === 3 ? validateWasmProcessors(value.processors, value.id, presets ?? []) : undefined;
	return { schemaVersion: value.schemaVersion, id: value.id, version: value.version, name: value.name.trim(), description: value.description, components: result.components, ...(presets ? { presets } : {}), ...(processors ? { processors } : {}) };
}
