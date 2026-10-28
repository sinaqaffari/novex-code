/** Browser-return query strings must never be treated as payment proof. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getOrderPaymentNotice } from '../src/lib/commerce/payment-notice.ts';

const pendingOrder = { status: 'pending', paymentState: 'initiated' } as const;
const paidOrder = { status: 'paid', paymentState: 'verified' } as const;

describe('order payment notices', () => {
	it('does not claim success from a user-controlled return status', () => {
		const notice = getOrderPaymentNotice(pendingOrder, 'success');
		assert.equal(notice?.tone, 'error');
		assert.match(notice?.text ?? '', /به‌تنهایی تأیید پرداخت نیست/);
	});

	it('reports success only when the persisted order is verified and revenue-bearing', () => {
		assert.equal(getOrderPaymentNotice(paidOrder, 'not-confirmed')?.tone, 'success');
		assert.equal(getOrderPaymentNotice({ status: 'paid', paymentState: 'initiated' }, 'success')?.tone, 'error');
	});

	it('does not let a forged failed status claim that an order was cancelled', () => {
		assert.equal(getOrderPaymentNotice(pendingOrder, 'failed'), null);
		assert.equal(getOrderPaymentNotice({ status: 'cancelled', paymentState: 'verified' }, 'success'), null);
	});
});
