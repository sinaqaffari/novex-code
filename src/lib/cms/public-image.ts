/** نشانی تصویر عمومی: فقط مسیرهای ریشه‌ای و نشانی‌های کامل قابل نمایش‌اند. */
export function publicImageSrc(value: string | undefined | null): string {
	if (!value) return '';
	const trimmed = value.trim();
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	return trimmed.startsWith('/') && !trimmed.startsWith('//') ? trimmed : '';
}
