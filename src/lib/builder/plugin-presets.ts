import { validatePageDocument } from './document.ts';
import { findNode, updateNodeProps } from './operations.ts';
import type { PageDocument } from './types.ts';

/** Declarative native compositions; never executable renderers or arbitrary HTML. */
export interface BuilderPresetParameter {
	key: string;
	label: string;
	nodeId: string;
	property: 'text' | 'label' | 'href' | 'alt' | 'caption';
	defaultValue: string;
	maxLength: number;
}
export interface BuilderPluginPreset { id: string; label: string; description: string; document: PageDocument; parameters?: BuilderPresetParameter[] }
const FIELD_LIMITS: Record<string, Record<string, number>> = {
	Heading: { text: 240 }, Text: { text: 5000 }, Button: { label: 80, href: 500 }, Image: { alt: 240, caption: 240 },
};
const KEY = /^[a-z][a-z0-9-]{0,39}$/;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => {
	if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error('فیلد ناشناخته در تعریف افزونه مجاز نیست.');
};

export function validateBuilderPresets(value: unknown): BuilderPluginPreset[] {
	if (!Array.isArray(value) || value.length > 50) throw new Error('فهرست پیش‌تنظیم‌ها نامعتبر است.');
	const ids = new Set<string>();
	return value.map((item: unknown) => {
		if (!record(item)) throw new Error('پیش‌تنظیم نامعتبر است.');
		onlyKeys(item, ['id', 'label', 'description', 'document', 'parameters']);
		if (typeof item.id !== 'string' || item.id.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || ids.has(item.id) || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 100 || typeof item.description !== 'string' || item.description.length > 300) throw new Error('شناسه یا مشخصات پیش‌تنظیم نامعتبر است.');
		ids.add(item.id);
		const document = validatePageDocument(item.document);
		if (item.parameters === undefined) return { id: item.id, label: item.label, description: item.description, document };
		if (!Array.isArray(item.parameters) || item.parameters.length > 12) throw new Error('فهرست ورودی‌ها نامعتبر است.');
		const parameterKeys = new Set<string>();
		const targets = new Set<string>();
		const parameters: BuilderPresetParameter[] = item.parameters.map((parameter: unknown) => {
			if (!record(parameter)) throw new Error('ورودی نامعتبر است.');
			onlyKeys(parameter, ['key', 'label', 'nodeId', 'property', 'defaultValue', 'maxLength']);
			const { key, label, nodeId, property, defaultValue, maxLength } = parameter;
			if (typeof key !== 'string' || !KEY.test(key) || parameterKeys.has(key) || typeof label !== 'string' || !label.trim() || label.length > 100 || typeof nodeId !== 'string' || typeof property !== 'string' || typeof defaultValue !== 'string' || typeof maxLength !== 'number' || !Number.isInteger(maxLength)) throw new Error('مشخصات ورودی نامعتبر است.');
			const node = findNode(document.nodes, nodeId);
			const limit = node && Object.hasOwn(FIELD_LIMITS, node.type) && Object.hasOwn(FIELD_LIMITS[node.type], property) ? FIELD_LIMITS[node.type][property] : undefined;
			if (!limit || maxLength < 1 || maxLength > limit || defaultValue.length > maxLength || targets.has(`${nodeId}:${property}`)) throw new Error('هدف یا محدودیت ورودی نامعتبر است.');
			// Run the canonical prop validator, including URL restrictions, on defaults.
			updateNodeProps(document, nodeId, { [property]: defaultValue });
			parameterKeys.add(key); targets.add(`${nodeId}:${property}`);
			return { key, label, nodeId, property: property as BuilderPresetParameter['property'], defaultValue, maxLength };
		});
		return { id: item.id, label: item.label, description: item.description, document, parameters };
	});
}

/** Materialize inputs to a validated native fragment, before fresh IDs are allocated. */
export function materializeBuilderPreset(preset: BuilderPluginPreset, values: Record<string, string>): PageDocument {
	const checked = validateBuilderPresets([preset])[0];
	const parameters = checked.parameters ?? [];
	if (Object.keys(values).some((key) => !parameters.some((parameter) => parameter.key === key))) throw new Error('ورودی ناشناخته است.');
	let document = checked.document;
	for (const parameter of parameters) {
		const value = Object.hasOwn(values, parameter.key) ? values[parameter.key] : parameter.defaultValue;
		if (typeof value !== 'string' || value.length > parameter.maxLength) throw new Error('مقدار ورودی نامعتبر است.');
		document = updateNodeProps(document, parameter.nodeId, { [parameter.property]: value });
	}
	return document;
}

/** Isolate invalid contributions so one malformed entry cannot hide valid peers. */
export function collectBuilderPresets(value: unknown): { presets: BuilderPluginPreset[]; rejected: number } {
	if (!Array.isArray(value)) return { presets: [], rejected: 1 };
	const presets: BuilderPluginPreset[] = [];
	const ids = new Set<string>();
	let rejected = Math.max(0, value.length - 50);
	for (const item of value.slice(0, 50)) {
		try {
			const preset = validateBuilderPresets([item])[0];
			if (ids.has(preset.id)) throw new Error('Duplicate preset');
			ids.add(preset.id);
			presets.push(preset);
		} catch { rejected += 1; }
	}
	return { presets, rejected };
}
