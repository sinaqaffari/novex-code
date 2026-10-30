import type { APIRoute } from 'astro';
import { can } from '../../../../lib/cms/rbac.ts';
import { failure, json } from '../../../../lib/cms/http.ts';
import { BuilderStoreError, listDeclarativePluginPackages } from '../../../../lib/builder/store.ts';
import { readBoundedRequestText } from '../../../../lib/builder/request.ts';
import { validateProcessorInputs } from '../../../../lib/builder/plugin-wasm.ts';
import { materializeBuilderPreset } from '../../../../lib/builder/plugin-presets.ts';
import { PluginSandboxError, runSandboxedWasmProcessor } from '../../../../lib/builder/plugin-sandbox.ts';

export const prerender = false;

/** Execute only a previously installed, active processor; submitted bytes are never executed. */
export const POST: APIRoute = async ({ locals, request }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:write')) return failure('اجازهٔ ویرایش صفحه ندارید.', 403);
	try {
		if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return failure('درخواست باید JSON باشد.', 415);
		let raw: unknown; try { raw = JSON.parse(await readBoundedRequestText(request, 8192)); } catch (error) { if (error instanceof BuilderStoreError) throw error; return failure('JSON معتبر نیست.', 400); }
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return failure('درخواست معتبر نیست.', 400);
		const input = raw as Record<string, unknown>;
		if (Object.keys(input).some((key) => !['packageId', 'processorId', 'expectedRevision', 'inputs', 'confirm'].includes(key)) || typeof input.packageId !== 'string' || typeof input.processorId !== 'string' || !Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 1 || input.confirm !== true) return failure('شناسه، نسخه و تأیید اجرای پردازشگر لازم است.', 400);
		const record = (await listDeclarativePluginPackages()).find((item) => item.package.id === input.packageId);
		if (!record || !record.active || record.revision !== input.expectedRevision) return json({ ok: false, code: 'plugin_processor_conflict', message: 'بسته تغییر کرده یا غیرفعال است؛ صفحه را دوباره بارگیری کنید.' }, 409);
		const processor = record.package.processors?.find((item) => item.id === input.processorId);
		const preset = record.package.presets?.find((item) => item.id === processor?.presetId);
		if (!processor || !preset) return json({ ok: false, code: 'plugin_processor_missing', message: 'پردازشگر پیدا نشد.' }, 404);
		let values: number[];
		try { values = validateProcessorInputs(processor, input.inputs); }
		catch (error) { return json({ ok: false, code: 'plugin_processor_input', message: error instanceof Error ? error.message : 'ورودی معتبر نیست.' }, 422); }
		const result = await runSandboxedWasmProcessor(processor.moduleBase64, values);
		// A disable or update during execution must not return a stale insertion.
		const latest = (await listDeclarativePluginPackages()).find((item) => item.package.id === input.packageId);
		if (!latest || !latest.active || latest.revision !== record.revision) return json({ ok: false, code: 'plugin_processor_conflict', message: 'بسته هنگام اجرا تغییر کرد؛ نتیجه درج نشد.' }, 409);
		const document = materializeBuilderPreset(preset, { [processor.outputParameter]: `${processor.prefix}${result}${processor.suffix}` });
		return json({ ok: true, document });
	} catch (error) {
		if (error instanceof PluginSandboxError || error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message }, error.status);
		return json({ ok: false, code: 'plugin_processor_invalid', message: error instanceof Error ? error.message : 'پردازشگر معتبر نیست.' }, 422);
	}
};
