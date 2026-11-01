import { describe, expect, it, vi } from 'vitest';
import { bmoMessageId, type BmoStatusObservation } from '../lib/foodhub/delivery/bmo-gateway';
import {
  beginBmoCheckout, reconcileBmoCheckout, sendBmoCheckoutSms,
  type BmoFlowDependencies, type BmoFlowRecord,
} from '../lib/foodhub/delivery/bmo-flow';

const order = { merchantKey: 'test-restaurant', orderId: 'PHONE-1001', amountCents: 2575 };
const msg = bmoMessageId(order);
function harness() {
  const rows = new Map<string, BmoFlowRecord>();
  const key = (merchant: string, id: string) => merchant + '|' + id;
  const requestMoney = vi.fn(async () => ({
    messageId: msg, bankPaymentId: 'bank-tx-1',
    fulfillmentUrl: 'https://bmo-approved.test/request/one',
  }));
  const observation: BmoStatusObservation = {
    messageId: msg, orderReference: order.orderId, amountCents: 2575,
    currency: 'CAD', statusCode: 'ACSP', providerPaymentId: 'bank-tx-1',
  };
  const getRequestStatus = vi.fn(async () => ({ ...observation }));
  const send = vi.fn(async (_to: string, _msg: string) => {});
  const deps: BmoFlowDependencies = {
    store: {
      async insertIfAbsent(record) {
        const k = key(record.merchantKey, record.orderId);
        if (rows.has(k)) return false;
        rows.set(k, record);
        return true;
      },
      async read(merchant, id) { return rows.get(key(merchant, id)) ?? null; },
      async compareAndSwap(previous, next) {
        const k = key(previous.merchantKey, previous.orderId);
        if (rows.get(k) !== previous) return false;
        rows.set(k, next);
        return true;
      },
    },
    bank: { requestMoney, getRequestStatus },
    sms: { send },
    allowedPaymentHosts: ['bmo-approved.test'],
  };
  return { deps, requestMoney, getRequestStatus, send, rows };
}

describe('BMO sandbox order/SMS flow', () => {
  it('reserves before bank call, never creates a second request, and sends one bilingual SMS', async () => {
    const h = harness();
    const created = await beginBmoCheckout(order, h.deps);
    expect(created.state).toBe('link_ready');
    expect(created.messageId).toBe(msg);
    expect(await beginBmoCheckout(order, h.deps)).toEqual(created);
    expect(h.requestMoney).toHaveBeenCalledTimes(1);
    const sent = await sendBmoCheckoutSms(order, '+15145550000', 'fr', h.deps);
    expect(sent.state).toBe('sms_sent');
    expect(h.send).toHaveBeenCalledTimes(1);
    const text = h.send.mock.calls[0][1];
    expect(text).toContain('25.75 $ CAD');
    expect(text).toContain('https://bmo-approved.test/request/one');
    await expect(sendBmoCheckoutSms(order, '+15145550000', 'fr', h.deps)).rejects.toThrow();
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('never releases processing payment, verifies exactly matching ACCC only', async () => {
    const h = harness();
    await beginBmoCheckout(order, h.deps);
    const waiting = await reconcileBmoCheckout(order, h.deps);
    expect(waiting.verifiedPaid).toBe(false);
    expect(waiting.record.state).toBe('link_ready');
    h.getRequestStatus.mockResolvedValue({
      messageId: msg, orderReference: order.orderId, amountCents: 2575,
      currency: 'CAD', statusCode: 'ACCC', providerPaymentId: 'bank-tx-1',
    });
    const paid = await reconcileBmoCheckout(order, h.deps);
    expect(paid.verifiedPaid).toBe(true);
    expect(paid.record.state).toBe('paid_verified');
    expect((await reconcileBmoCheckout(order, h.deps)).verifiedPaid).toBe(true);
    expect(h.getRequestStatus).toHaveBeenCalledTimes(2);
  });
  it('rejects inconsistent provider transaction, even with ACCC', async () => {
    const h = harness();
    await beginBmoCheckout(order, h.deps);
    h.getRequestStatus.mockResolvedValue({
      messageId: msg, orderReference: order.orderId, amountCents: 2575,
      currency: 'CAD', statusCode: 'ACCC', providerPaymentId: 'ANOTHER-TXN',
    });
    const result = await reconcileBmoCheckout(order, h.deps);
    expect(result.verifiedPaid).toBe(false);
    expect(result.record.state).not.toBe('paid_verified');
  });
  it('never re-submits after an uncertain BMO response or an invalid link', async () => {
    const h = harness();
    h.requestMoney.mockRejectedValue(new Error('provider error possibly after acceptance'));
    await expect(beginBmoCheckout(order, h.deps)).rejects.toThrow('outcome uncertain');
    expect((await h.deps.store.read(order.merchantKey, order.orderId))?.state).toBe('submission_uncertain');
    await beginBmoCheckout(order, h.deps);
    expect(h.requestMoney).toHaveBeenCalledTimes(1);
  });
  it('refuses a poisoned stored fulfillment URL before Twilio sends any text', async () => {
    const h = harness();
    await beginBmoCheckout(order, h.deps);
    const k = order.merchantKey + '|' + order.orderId;
    const original = h.rows.get(k)!;
    h.rows.set(k, { ...original, paymentUrl: 'https://attacker.test/pay' });
    await expect(sendBmoCheckoutSms(order, '+15145550000', 'fr', h.deps)).rejects.toThrow('Unapproved');
    expect(h.send).not.toHaveBeenCalled();
  });
  it('marks SMS outcome uncertain instead of resending automatically', async () => {
    const h = harness();
    await beginBmoCheckout(order, h.deps);
    h.send.mockRejectedValue(new Error('Twilio timeout'));
    await expect(sendBmoCheckoutSms(order, '+15145550000', 'en', h.deps))
      .rejects.toThrow('SMS outcome uncertain');
    expect((await h.deps.store.read(order.merchantKey, order.orderId))?.state).toBe('sms_uncertain');
    await expect(sendBmoCheckoutSms(order, '+15145550000', 'en', h.deps)).rejects.toThrow();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('blocks payment creation when approved bank delivery hosts are not configured', async () => {
    const h = harness();
    h.deps.allowedPaymentHosts = [];
    await expect(beginBmoCheckout(order, h.deps)).rejects.toThrow('hostnames');
    expect(h.requestMoney).not.toHaveBeenCalled();
    expect(h.rows.size).toBe(0);
  });
  it('rejects invalid phone and runtime language before claiming or sending a link', async () => {
    const h = harness();
    await beginBmoCheckout(order, h.deps);
    for (const phone of ['5145550000', '+1\n5550000', '+123', '+0'.padEnd(16, '1')]) {
      await expect(sendBmoCheckoutSms(order, phone, 'en', h.deps)).rejects.toThrow('E.164');
    }
    await expect(sendBmoCheckoutSms(order, '+15145550000', 'xx' as 'en', h.deps))
      .rejects.toThrow('language');
    expect((await h.deps.store.read(order.merchantKey, order.orderId))?.state).toBe('link_ready');
    expect(h.send).not.toHaveBeenCalled();
  });
  it('never automatically marks an already cancelled order paid on late ACCC', async () => {
    const h = harness();
    const reserved = await beginBmoCheckout(order, h.deps);
    const cancelled: BmoFlowRecord = { ...reserved, state: 'cancelled' };
    h.rows.set(order.merchantKey + '|' + order.orderId, cancelled);
    h.getRequestStatus.mockResolvedValue({
      messageId: msg, orderReference: order.orderId, amountCents: order.amountCents,
      currency: 'CAD', statusCode: 'ACCC', providerPaymentId: 'bank-tx-1',
    });
    const r = await reconcileBmoCheckout(order, h.deps);
    expect(r.verifiedPaid).toBe(false);
    expect(r.record.state).toBe('cancelled');
    expect(h.getRequestStatus).not.toHaveBeenCalled();
  });
  it('prevents an automatic paid outcome on a concurrent bank-state write', async () => {
    const h = harness();
    await beginBmoCheckout(order, h.deps);
    h.getRequestStatus.mockResolvedValue({
      messageId: msg, orderReference: order.orderId, amountCents: order.amountCents,
      currency: 'CAD', statusCode: 'ACCC', providerPaymentId: 'bank-tx-1',
    });
    const original = h.deps.store.compareAndSwap;
    h.deps.store.compareAndSwap = async (previous, next) => {
      if (next.state === 'paid_verified') {
        h.rows.set(order.merchantKey + '|' + order.orderId, { ...previous, state: 'cancelled' });
        return false;
      }
      return original(previous, next);
    };
    const r = await reconcileBmoCheckout(order, h.deps);
    expect(r.verifiedPaid).toBe(false);
    expect(r.record.state).toBe('cancelled');
  });
});
// — signé : INTER-ACT (ChatGPT) · 2026-11-01
