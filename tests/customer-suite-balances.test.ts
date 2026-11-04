import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerSuiteMerchants, giftCardsFor, giftCardsConfigured, loyaltyFor, loyaltyConfigured, SUITE_BALANCE_RESPONSE_MAX } from '../lib/foodhub/customers/adapters';
import { saveCustomer, upsertVerifiedCustomer } from '../lib/foodhub/customers/store';
import { verifySuite } from '../lib/foodhub/suite/sign';
import type { MasterCustomer } from '../lib/foodhub/customers/types';

const PHONE = '+15145550101';
const MID = 'MERCHANT0001';
const KEY_L = 'loyalty-synthetic-signature-key-0123456789';
const KEY_R = 'rewards-synthetic-signature-key-0123456789';
let customer: MasterCustomer;
let calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }>;
let reply: (body: Record<string, unknown>) => unknown;

beforeEach(async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  vi.stubEnv('FOODHUB_CUSTOMER_TENANTS', 'pppmtl');
  vi.stubEnv('FOODHUB_CUSTOMER_SUITE_MERCHANTS', JSON.stringify({ on2go: MID, pppmtl: 'MERCHANT0002' }));
  vi.stubEnv('FOODHUB_SUITE_LOY4LTY_URL', 'https://loyalty.example.test/api/suite/events');
  vi.stubEnv('FOODHUB_SUITE_LOY4LTY_SECRET', KEY_L);
  vi.stubEnv('FOODHUB_SUITE_REW4RD_URL', 'https://cards.example.test/api/suite/events');
  vi.stubEnv('FOODHUB_SUITE_REW4RD_SECRET', KEY_R);
  vi.stubEnv('FOODHUB_LOYALTY_URL', ''); vi.stubEnv('FOODHUB_GIFTCARDS_URL', '');
  customer = (await upsertVerifiedCustomer({ phone: PHONE, tenant: 'on2go' })).customer;
  calls = [];
  reply = (body) => ({ ...body, ok: true, program: { scope: 'merchant', name: 'Demo restaurant' }, ...(body.app === 'loy4lty'
    ? { membership: 'linked', points: 37 } : { cards: [{ last4: 'A1Z9', balanceCents: 2537, code: 'DO-NOT-EXPOSE', hash: 'internal-card-hash' }] }) });
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(input), init, body });
    return Response.json(reply(body));
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('verified customer suite balance adapter', () => {
  it('calls the correct signed read endpoint using merchant-scoped pseudonym, never browser PII', async () => {
    expect(loyaltyConfigured()).toBe(true);expect(giftCardsConfigured()).toBe(true);
    expect(await loyaltyFor(customer, 'on2go')).toEqual({ connected: true, points: 37, program: { scope: 'merchant', name: 'Demo restaurant' } });
    expect(await giftCardsFor(customer, 'on2go')).toEqual({ connected: true, cards: [{ last4: 'A1Z9', balance: 25.37 }], program: { scope: 'merchant', name: 'Demo restaurant' } });
    expect(calls.map((c) => c.url)).toEqual(['https://loyalty.example.test/api/loyalty/customer-balance', 'https://cards.example.test/api/cards/customer-balances']);
    const ref = crypto.createHash('sha256').update(`${MID}:${PHONE}`).digest('hex').slice(0, 32);
    for (const c of calls) {
      expect(c.body).toMatchObject({ tenant: 'on2go', merchantId: MID, customerRef: ref, purpose: 'customer.balance.read' });
      expect(JSON.stringify(c.body)).not.toContain(PHONE);expect(JSON.stringify(c.body)).not.toContain(customer.id);
      expect(c.init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' });
      const headers = new Headers(c.init.headers);
      expect(headers.get('x-takatak-app')).toBe('foodhub');
      expect(verifySuite(c.body.app === 'loy4lty' ? KEY_L : KEY_R, headers.get('x-takatak-signature'), String(c.init.body))).toBe(true);
    }
    expect(calls[0].body.requestId).not.toEqual(calls[1].body.requestId);
  });
  it('never sends requests for stale, deleted, forged-phone or cross-website customer context', async () => {
    expect(await loyaltyFor({ ...customer, tokenVersion: 77 }, 'on2go')).toMatchObject({ connected: false, code: 'unverified_customer' });
    expect(await loyaltyFor({ ...customer, phone: '+15145550102' }, 'on2go')).toMatchObject({ connected: false, code: 'unverified_customer' });
    expect(await loyaltyFor(customer, 'pppmtl')).toMatchObject({ connected: false, code: 'unverified_customer' });
    await saveCustomer({ ...customer, deletedAt: new Date().toISOString() });
    expect(await giftCardsFor(customer, 'on2go')).toMatchObject({ connected: false, code: 'unverified_customer' });
    expect(calls).toHaveLength(0);
  });
  it('requires complete signed connection and a valid explicit merchant map, not a legacy URL', async () => {
    vi.stubEnv('FOODHUB_SUITE_LOY4LTY_SECRET', '');
    vi.stubEnv('FOODHUB_LOYALTY_URL', 'https://legacy.example.test');
    expect(loyaltyConfigured()).toBe(false);
    expect(await loyaltyFor(customer, 'on2go')).toMatchObject({ connected: false });
    expect(calls).toHaveLength(0);
    expect(customerSuiteMerchants(JSON.stringify({ on2go: [MID, 'MERCHANT0002'] }))).toBeNull();
    expect(customerSuiteMerchants('{invalid')).toBeNull();
    vi.stubEnv('FOODHUB_SUITE_REW4RD_URL', 'http://not-local.example.test');
    expect(giftCardsConfigured()).toBe(false);
    expect(await giftCardsFor(customer, 'on2go')).toMatchObject({ connected: false });
  });
  it('does not pool another website program or claim a membership without an existing link', async () => {
    vi.stubEnv('FOODHUB_CUSTOMER_SUITE_MERCHANTS', JSON.stringify({ pppmtl: MID }));
    expect(await loyaltyFor(customer, 'on2go')).toMatchObject({ connected: false, code: 'not_configured' });
    expect(calls).toHaveLength(0);
    vi.stubEnv('FOODHUB_CUSTOMER_SUITE_MERCHANTS', JSON.stringify({ on2go: MID }));
    reply = (body) => ({ ...body, ok: true, program: { scope: 'merchant' }, membership: 'not_linked' });
    const missing = await loyaltyFor(customer, 'on2go');
    expect(missing).toMatchObject({ connected: false, code: 'not_linked' });expect(missing).not.toHaveProperty('points');
  });
  it('accepts actual zero points and zero-balance linked cards while rejecting malformed financial data', async () => {
    reply = (body) => ({ ...body, ok: true, program: { scope: 'merchant' }, membership: 'linked', points: 0, cards: [{ last4: 'A1Z9', balanceCents: 0 }] });
    expect(await loyaltyFor(customer, 'on2go')).toMatchObject({ connected: true, points: 0 });
    expect(await giftCardsFor(customer, 'on2go')).toMatchObject({ connected: true, cards: [{ last4: 'A1Z9', balance: 0 }] });
    reply = (body) => ({ ...body, ok: true, program: { scope: 'merchant' }, membership: 'linked', points: 1.4, cards: [{ last4: 'A1Z9', balanceCents: -1 }] });
    expect(await loyaltyFor(customer, 'on2go')).toMatchObject({ connected: false, code: 'unavailable' });
    expect(await giftCardsFor(customer, 'on2go')).toMatchObject({ connected: false, code: 'unavailable' });
  });
  it('refuses foreign response context, excess body, failed service and timeout without fabricating zero', async () => {
    reply = (body) => ({ ...body, ok: true, merchantId: 'MERCHANT0002', program: { scope: 'merchant' }, membership: 'linked', points: 999 });
    expect(await loyaltyFor(customer, 'on2go')).toMatchObject({ connected: false, code: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(SUITE_BALANCE_RESPONSE_MAX + 1))));
    expect(await loyaltyFor(customer, 'on2go')).toMatchObject({ connected: false, code: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(await giftCardsFor(customer, 'on2go')).toMatchObject({ connected: false, code: 'unavailable' });
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error('missing timeout signal'));
      signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
    })));
    expect(await loyaltyFor(customer, 'on2go')).toMatchObject({ connected: false, code: 'unavailable' });
    expect(aborted).toBe(true);
  });
});
