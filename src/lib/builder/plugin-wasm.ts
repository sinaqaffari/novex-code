import type { BuilderPluginPreset } from './plugin-presets.ts';

/** A deliberately small, import-free numeric WebAssembly ABI; this is never JavaScript. */
export interface WasmProcessorInput { key: string; label: string; min: number; max: number; defaultValue: number }
export interface WasmProcessor {
	id: string;
	label: string;
	description: string;
	presetId: string;
	outputParameter: string;
	prefix: string;
	suffix: string;
	inputs: WasmProcessorInput[];
	moduleBase64: string;
}
export type WasmProcessorSummary = Omit<WasmProcessor, 'moduleBase64' | 'presetId' | 'outputParameter' | 'prefix' | 'suffix'> & { packageId: string; revision: number };

const MAX_MODULE_BYTES = 64 * 1024;
const KEY = /^[a-z][a-z0-9-]{0,39}$/;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) => {
	if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('فیلد ناشناخته در پردازشگر افزونه مجاز نیست.');
};
const int32 = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;

/** Parse just the structural limits before any untrusted module reaches a compiler. */
export function validateWasmModuleBase64(value: unknown): string {
	if (typeof value !== 'string' || value.length < 12 || value.length > Math.ceil(MAX_MODULE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('ماژول WebAssembly معتبر نیست.');
	let decoded: string;
	try { decoded = atob(value); } catch { throw new Error('ماژول WebAssembly معتبر نیست.'); }
	if (decoded.length > MAX_MODULE_BYTES || btoa(decoded) !== value) throw new Error('اندازه یا کدگذاری ماژول معتبر نیست.');
	const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
	if (bytes.length < 8 || [0, 97, 115, 109, 1, 0, 0, 0].some((byte, i) => bytes[i] !== byte)) throw new Error('سرآیند WebAssembly معتبر نیست.');
	const readU32 = (offset: number, end: number): [number, number] => {
		let result = 0;
		for (let i = 0; i < 5; i++) {
			if (offset >= end) throw new Error('ساختار ماژول ناقص است.');
			const byte = bytes[offset++];
			result += (byte & 0x7f) * 2 ** (7 * i);
			if (!(byte & 0x80)) {
				if (result > 0xffffffff || (i > 0 && byte === 0)) throw new Error('عدد ماژول معتبر نیست.');
				return [result, offset];
			}
		}
		throw new Error('عدد ماژول بیش از حد بزرگ است.');
	};
	const seen = new Set<number>();
	let cursor = 8;
	while (cursor < bytes.length) {
		const id = bytes[cursor++];
		if (id > 12 || id === 8 || (id !== 0 && seen.has(id))) throw new Error('این بخش از WebAssembly پشتیبانی نمی‌شود.');
		if (id) seen.add(id);
		const [size, start] = readU32(cursor, bytes.length);
		const end = start + size;
		if (end > bytes.length) throw new Error('بخش WebAssembly ناقص است.');
		if (id === 2 || id === 4 || id === 5) {
			let [count, next] = readU32(start, end);
			if ((id === 2 || id === 4) && count !== 0) throw new Error('واردات و جدول‌های ماژول افزونه مجاز نیستند.');
			if (id === 5) {
				if (count > 1) throw new Error('تعداد حافظه‌های ماژول مجاز نیست.');
				if (count === 1) {
					let flags: number; let minimum: number; let maximum: number;
					[flags, next] = readU32(next, end);
					if (flags !== 1) throw new Error('حافظهٔ ماژول باید سقف مشخص و غیرمشترک داشته باشد.');
					[minimum, next] = readU32(next, end); [maximum, next] = readU32(next, end);
					if (minimum > maximum || maximum > 4) throw new Error('حافظهٔ ماژول بیش از حد مجاز است.');
				}
			}
			if (next !== end) throw new Error('بخش محدودشدهٔ ماژول معتبر نیست.');
		}
		cursor = end;
	}
	return value;
}

export function validateWasmProcessors(value: unknown, packageId: string, presets: BuilderPluginPreset[]): WasmProcessor[] {
	if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error('تعداد پردازشگرهای افزونه معتبر نیست.');
	const ids = new Set<string>();
	return value.map((raw: unknown): WasmProcessor => {
		if (!record(raw)) throw new Error('پردازشگر افزونه معتبر نیست.');
		onlyKeys(raw, ['id', 'label', 'description', 'presetId', 'outputParameter', 'prefix', 'suffix', 'inputs', 'moduleBase64']);
		const { id, label, description, presetId, outputParameter, prefix, suffix, inputs } = raw;
		if (typeof id !== 'string' || id.length > 80 || !id.startsWith(`${packageId}-`) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id) || typeof label !== 'string' || !label.trim() || label.length > 100 || typeof description !== 'string' || description.length > 300 || typeof presetId !== 'string' || typeof outputParameter !== 'string' || typeof prefix !== 'string' || prefix.length > 100 || typeof suffix !== 'string' || suffix.length > 100) throw new Error('مشخصات پردازشگر افزونه معتبر نیست.');
		const preset = presets.find((item) => item.id === presetId);
		const output = preset?.parameters?.find((parameter) => parameter.key === outputParameter);
		if (!output || !['text', 'label', 'alt', 'caption'].includes(output.property)) throw new Error('خروجی پردازشگر باید به یک پارامتر متنی پیش‌تنظیم همین بسته متصل باشد.');
		if (!Array.isArray(inputs) || !inputs.length || inputs.length > 4) throw new Error('تعداد ورودی‌های عددی معتبر نیست.');
		const keys = new Set<string>();
		const checkedInputs = inputs.map((input: unknown): WasmProcessorInput => {
			if (!record(input)) throw new Error('ورودی پردازشگر معتبر نیست.');
			onlyKeys(input, ['key', 'label', 'min', 'max', 'defaultValue']);
			const { key, label: inputLabel, min, max, defaultValue } = input;
			if (typeof key !== 'string' || !KEY.test(key) || keys.has(key) || typeof inputLabel !== 'string' || !inputLabel.trim() || inputLabel.length > 100 || !int32(min) || !int32(max) || !int32(defaultValue) || min > max || defaultValue < min || defaultValue > max) throw new Error('محدوده یا مشخصات ورودی پردازشگر معتبر نیست.');
			keys.add(key); return { key, label: inputLabel.trim(), min, max, defaultValue };
		});
		ids.add(id);
		return { id, label: label.trim(), description, presetId, outputParameter, prefix, suffix, inputs: checkedInputs, moduleBase64: validateWasmModuleBase64(raw.moduleBase64) };
	});
}

export function validateProcessorInputs(processor: WasmProcessor, value: unknown): number[] {
	if (!record(value) || Object.keys(value).some((key) => !processor.inputs.some((field) => field.key === key))) throw new Error('ورودی ناشناخته است.');
	const result = processor.inputs.map((field) => {
		const input = Object.hasOwn(value, field.key) ? value[field.key] : field.defaultValue;
		if (!int32(input) || input < field.min || input > field.max) throw new Error('مقدار عددی خارج از محدوده است.');
		return input;
	});
	while (result.length < 4) result.push(0);
	return result;
}

export function processorSummary(processor: WasmProcessor, packageId: string, revision: number): WasmProcessorSummary {
	return { id: processor.id, label: processor.label, description: processor.description, inputs: processor.inputs, packageId, revision };
}
