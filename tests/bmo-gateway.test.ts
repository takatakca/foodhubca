import { describe, expect, it, vi } from 'vitest';
import {
  bmoMessageId, bmoMayRelease, bmoPaymentLink, bmoRequest, bmoStatus,
  type BmoOrderFingerprint, type BmoStatusObservation,
} from '../lib/foodhub/delivery/bmo-gateway';

const order: BmoOrderFingerprint = { merchantKey: 'restaurant-A', orderId: 'ORDER-1048', amountCents: 3875 };
const msg = bmoMessageId(order);
const complete: BmoStatusObservation = {
  messageId: msg, orderReference: order.orderId, amountCents: 3875,
  currency: 'CAD', statusCode: 'ACCC', providerPaymentId: 'BANK-TXN-1',
};
const config = {
  environment: 'sandbox' as const, baseUrl: 'https://sandbox.bmo.example',
  allowedApiOrigins: ['https://sandbox.bmo.example'],
  apiKey: 'test-key', accessToken: 'test-oauth',
};

describe('BMO Request Money settlement guard', () => {
  it('accepts only ACCC as a terminal successful Interac status', () => {
    expect(bmoStatus(' ACCC ')).toBe('completed');
    expect(bmoStatus('ACTC')).toBe('processing');
    expect(bmoStatus('ACSP')).toBe('processing');
    expect(bmoStatus('ACSC')).toBe('processing');
    expect(bmoStatus('RJCT')).toBe('rejected');
    expect(bmoStatus('CANC')).toBe('cancelled');
    expect(bmoStatus('made_up')).toBe('unknown');
  });
  it('uses a stable, per-merchant payment message ID of <=35 characters', () => {
    expect(msg).toMatch(/^FH[a-f0-9]{33}$/);
    expect(bmoMessageId(order)).toBe(msg);
    expect(bmoMessageId({ ...order, merchantKey: 'restaurant-B' })).not.toBe(msg);
    expect(bmoMessageId({ ...order, orderId: 'ORDER-1049' })).not.toBe(msg);
  });
  it('rejects invalid CAD cents before asking the bank', () => {
    for (const amountCents of [0, -1, 10.5, NaN, Infinity]) {
      expect(() => bmoMessageId({ ...order, amountCents })).toThrow();
    }
  });
  it('never releases on accepted/processing state or mismatched transaction', () => {
    expect(bmoMayRelease(order, msg, complete)).toBe(true);
    const changes: Partial<BmoStatusObservation>[] = [
      { statusCode: 'ACSC' }, { statusCode: 'ACTC' }, { statusCode: 'RJCT' },
      { statusCode: 'CANC' }, { statusCode: 'unknown' },
      { messageId: 'another' }, { orderReference: 'other-order' },
      { amountCents: 3874 }, { currency: 'USD' }, { providerPaymentId: '' },
    ];
    for (const update of changes) expect(bmoMayRelease(order, msg, { ...complete, ...update })).toBe(false);
    expect(bmoMayRelease(order, 'wrong-message', complete)).toBe(false);
  });
  it('permits only an explicitly allowlisted HTTPS fulfillment host', () => {
    const hosts = ['approved-payments.example'];
    expect(bmoPaymentLink('https://approved-payments.example/pay/abc', hosts))
      .toBe('https://approved-payments.example/pay/abc');
    for (const url of [
      'http://approved-payments.example/pay',
      'https://approved-payments.example.evil.test/pay',
      'https://user:pass@approved-payments.example/pay',
      'https://approved-payments.example:444/pay',
      'https://approved-payments.example/pay#foo',
      'javascript:alert(1)',
    ]) expect(() => bmoPaymentLink(url, hosts)).toThrow();
    expect(() => bmoPaymentLink('https://approved-payments.example/pay', [])).toThrow();
  });
});

describe('BMO sandbox HTTP transport', () => {
  it('uses OAuth, BMO trace headers, no-store and does not repeat a POST', async () => {
    const network = vi.fn(async (_u: string | URL | Request, _r?: RequestInit) =>
      new Response(JSON.stringify({ messageId: 'm1' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    const r = await bmoRequest<{ messageId: string }>(config, 'POST', '/approved', { test: 1 }, network as typeof fetch);
    expect(r.messageId).toBe('m1');
    expect(network).toHaveBeenCalledTimes(1);
    const [url, request] = network.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sandbox.bmo.example/approved');
    expect(request.cache).toBe('no-store');
    expect(request.redirect).toBe('error');
    const h = request.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer test-oauth');
    expect(h['x-api-key']).toBe('test-key');
    expect(h['x-fapi-financial-id']).toBeUndefined(); // no unverified bank header
    expect(h['x-request-id']).toBeTruthy();
    expect(h['x-fapi-interaction-id']).toBeTruthy();
  });
  it('refuses production without ever calling a network adapter', async () => {
    const network = vi.fn();
    await expect(bmoRequest({ ...config, environment: 'production' }, 'POST', '/pay', {}, network as typeof fetch))
      .rejects.toThrow('production');
    expect(network).not.toHaveBeenCalled();
  });
  it('refuses off-origin paths, insecure origins and GET bodies', async () => {
    const network = vi.fn();
    await expect(bmoRequest(config, 'GET', '//evil.test/', undefined, network as typeof fetch)).rejects.toThrow();
    await expect(bmoRequest(config, 'POST', '/pay?secret=1', {}, network as typeof fetch)).rejects.toThrow();
    await expect(bmoRequest(config, 'POST', '/pay/../other', {}, network as typeof fetch)).rejects.toThrow();
    await expect(bmoRequest({ ...config, baseUrl: 'http://sandbox.bmo.example' }, 'GET', '/x', undefined, network as typeof fetch)).rejects.toThrow();
    await expect(bmoRequest(config, 'GET', '/x', {}, network as typeof fetch)).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
  it('does not automatically retry uncertain submissions or leak credentials', async () => {
    const network = vi.fn(async () => { throw new Error('secret test-oauth in upstream error'); });
    await expect(bmoRequest(config, 'POST', '/request-money', {}, network as typeof fetch))
      .rejects.toThrow(/outcome uncertain/);
    expect(network).toHaveBeenCalledTimes(1);
    await expect(bmoRequest(config, 'POST', '/request-money', {}, network as typeof fetch))
      .rejects.not.toThrow('test-oauth');
  });
  it('fails closed on HTTP errors or malformed provider response', async () => {
    const badStatus = vi.fn(async () => new Response('bad', { status: 503 }));
    await expect(bmoRequest(config, 'POST', '/x', {}, badStatus as typeof fetch)).rejects.toThrow('HTTP 503');
    const badBody = vi.fn(async () => new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(bmoRequest(config, 'GET', '/x', undefined, badBody as typeof fetch)).rejects.toThrow('Invalid BMO JSON');
  });
});

describe('BMO bank-grade hostile-input protections', () => {
  it('never sends bearer credentials to an unpinned API destination', async () => {
    const network = vi.fn();
    await expect(bmoRequest({ ...config, baseUrl: 'https://attacker.test' }, 'POST', '/pay', {}, network as typeof fetch))
      .rejects.toThrow('Unapproved BMO API origin');
    await expect(bmoRequest({ ...config, allowedApiOrigins: [] }, 'POST', '/pay', {}, network as typeof fetch))
      .rejects.toThrow('allowlist');
    await expect(bmoRequest({ ...config, allowedApiOrigins: ['https://sandbox.bmo.example.evil.test'] }, 'POST', '/pay', {}, network as typeof fetch))
      .rejects.toThrow('Unapproved');
    await expect(bmoRequest({ ...config, baseUrl: 'https://sandbox.bmo.example/pay' }, 'POST', '/pay', {}, network as typeof fetch))
      .rejects.toThrow('clean HTTPS');
    await expect(bmoRequest({ ...config, baseUrl: 'https://sandbox.bmo.example@attacker.test' }, 'POST', '/pay', {}, network as typeof fetch))
      .rejects.toThrow('Unapproved');
    expect(network).not.toHaveBeenCalled();
  });
  it('rejects unknown environment values, unsafe headers and traversal paths without networking', async () => {
    const network = vi.fn();
    await expect(bmoRequest({ ...config, environment: 'prod' as 'sandbox' }, 'POST', '/pay', {}, network as typeof fetch))
      .rejects.toThrow('disabled');
    await expect(bmoRequest({ ...config, accessToken: 'abc\r\nx-injected: x' }, 'POST', '/pay', {}, network as typeof fetch))
      .rejects.toThrow('BMO OAuth token');
    await expect(bmoRequest(config, 'POST', '/pay/%2e%2e/x', {}, network as typeof fetch)).rejects.toThrow();
    await expect(bmoRequest(config, 'POST', '/pay\\evil', {}, network as typeof fetch)).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
  it('rejects CRLF in order references or payment links and changes identity on amount changes', () => {
    expect(bmoMessageId({ ...order, amountCents: order.amountCents + 1 })).not.toBe(msg);
    for (const bad of ['order\nPAY TO ATTACKER', '../order', 'a'.repeat(65), 'order code']) {
      expect(() => bmoMessageId({ ...order, orderId: bad })).toThrow();
    }
    for (const badLink of [
      'https://approved-payments.example/pay\nPAY TO ATTACKER',
      'https://approved-payments.example/pay\r\n',
      'https://approved-payments.example/pay/' + 'a'.repeat(2048),
    ]) expect(() => bmoPaymentLink(badLink, ['approved-payments.example'])).toThrow();
  });
  it('enforces a bounded JSON response and rejects fake JSON content types', async () => {
    const huge = new Response(JSON.stringify({ data: 'x'.repeat(130_000) }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    await expect(bmoRequest(config, 'GET', '/status', undefined,
      vi.fn(async () => huge) as typeof fetch)).rejects.toThrow('too large');
    await expect(bmoRequest(config, 'GET', '/status', undefined,
      vi.fn(async () => new Response('<html>login</html>', {
        status: 200, headers: { 'content-type': 'text/html' },
      })) as typeof fetch)).rejects.toThrow('response type');
  });
});
// — signé : INTER-ACT (ChatGPT) · 2026-11-01
