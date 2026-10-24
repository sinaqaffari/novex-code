/**
 * خطاهای قابل‌نمایش به کاربر.
 * `field` به رابط کاربری می‌گوید کدام ورودی را نشانه‌گذاری کند و `status` به
 * API می‌گوید چه کد HTTP برگرداند.
 */
export class AppError extends Error {
	readonly field?: string;
	readonly status: number;

	constructor(message: string, field?: string, status = 400) {
		super(message);
		this.name = 'AppError';
		this.field = field;
		this.status = status;
	}
}
