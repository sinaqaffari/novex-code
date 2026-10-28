import type { Order } from './types.ts';
import { isRevenue } from './types.ts';

export type OrderPaymentNotice = {
	tone: 'error' | 'plain' | 'success';
	text: string;
};

/**
 * Query parameters only describe a browser return; the persisted order state is
 * authoritative. Never tell a customer that payment succeeded from the URL.
 */
export function getOrderPaymentNotice(
	order: Pick<Order, 'status' | 'paymentState'> | null,
	returnStatus: string,
): OrderPaymentNotice | null {
	if (!order || order.status === 'cancelled' || order.status === 'refunded') return null;

	if (order.paymentState === 'verified' && isRevenue(order.status)) {
		return { tone: 'success', text: 'پرداخت در سمت سرور تأیید و در سفارش ثبت شده است.' };
	}
	if (order.paymentState === 'unknown') {
		return {
			tone: 'error',
			text: 'نتیجهٔ پرداخت هنوز قابل تأیید نیست. برای جلوگیری از پرداخت تکراری، دوباره پرداخت نکنید و وضعیت را با پشتیبانی بررسی کنید.',
		};
	}
	if (order.paymentState === 'initiating' || order.paymentState === 'verifying') {
		return { tone: 'plain', text: 'درخواست پرداخت در حال بررسی است؛ این صفحه را کمی بعد دوباره ببینید.' };
	}
	if (order.paymentState === 'not-configured') {
		return { tone: 'plain', text: 'سفارش ثبت شد، اما درگاه پرداخت آنلاین برای این فروشگاه فعال نیست.' };
	}
	if (returnStatus === 'not-confirmed' && order.status === 'pending') {
		return {
			tone: 'plain',
			text: 'بازگشت از درگاه به‌تنهایی پرداخت را تأیید نمی‌کند؛ سفارش همچنان در انتظار است. اگر مبلغی کسر شده، دوباره پرداخت نکنید و وضعیت را با پشتیبانی بررسی کنید.',
		};
	}
	if (returnStatus === 'success') {
		return {
			tone: 'error',
			text: 'بازگشت از درگاه به‌تنهایی تأیید پرداخت نیست و تأییدی در وضعیت سفارش ثبت نشده است. دوباره پرداخت نکنید و وضعیت را با پشتیبانی بررسی کنید.',
		};
	}
	return null;
}
