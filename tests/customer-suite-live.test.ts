// Explicit local integration proof only: the runner starts actual app HTTP servers with isolated PostgreSQL schemas.
import { beforeEach, describe, expect, it } from 'vitest';
import { GET as meRoute } from '../app/api/public/on2go/me/route';
import { signCustomerToken } from '../lib/foodhub/customers/token';
import { giftCardsFor, loyaltyFor } from '../lib/foodhub/customers/adapters';
import { upsertVerifiedCustomer } from '../lib/foodhub/customers/store';
import type { MasterCustomer } from '../lib/foodhub/customers/types';

const enabled = process.env.FOODHUB_CUSTOMER_SUITE_PROOF === '1';
let customer: MasterCustomer;
describe.skipIf(!enabled)('actual customer suite HTTP + PostgreSQL bridge', () => {
  beforeEach(async () => {
    process.env.FOODHUB_FORCE_MEMORY = 'true';
    process.env.SESSION_SECRET = 'synthetic-customer-suite-proof-session-0123456789';
    (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
    customer = (await upsertVerifiedCustomer({ phone: '+15145550101', tenant: 'on2go' })).customer;
  });
  it('reads actual merchant-linked points through the signed app HTTP route', async () => {
    expect(await loyaltyFor(customer, 'on2go')).toEqual({ connected: true, points: 37, program: { scope: 'merchant', name: 'Demo restaurant' } });
  });
  it('reads only owned active cards and converts durable cents once', async () => {
    const result = await giftCardsFor(customer, 'on2go');
    expect(result).toEqual({ connected: true, cards: [{ last4: 'A1Z9', balance: 25.37 }], program: { scope: 'merchant', name: 'Demo restaurant' } });
    expect(JSON.stringify(result)).not.toMatch(/customerRef|merchantId|clover|hash|code/i);
  });
  it('does not enroll an unlinked customer or invent a points balance', async () => {
    const other = (await upsertVerifiedCustomer({ phone: '+15145550103', tenant: 'on2go' })).customer;
    const points = await loyaltyFor(other, 'on2go');
    expect(points).toMatchObject({ connected: false, code: 'not_linked' });expect(points).not.toHaveProperty('points');
    expect(await giftCardsFor(other, 'on2go')).toMatchObject({ connected: true, cards: [] });
  });
  it('projects actual app balances through the authenticated ON2GO /me handler, ignoring query overrides', async () => {
    const signed = await signCustomerToken(customer, 'on2go');
    const r = await meRoute(new Request('http://127.0.0.1/api/public/on2go/me?merchantId=MERCHANT0002&phone=15145550102&customerRef=other', { headers: { Authorization: `Bearer ${signed.token}`, Origin: 'https://on2go.ca' } }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.loyalty).toMatchObject({ connected: true, points: 37, program: { scope: 'merchant' } });
    expect(body.giftCards).toMatchObject({ connected: true, cards: [{ last4: 'A1Z9', balance: 25.37 }] });
  });
  it('refuses a different website token at the ON2GO customer route', async () => {
    const signed = await signCustomerToken(customer, 'pppmtl');
    const r = await meRoute(new Request('http://127.0.0.1/api/public/on2go/me', { headers: { Authorization: `Bearer ${signed.token}` } }));
    expect(r.status).toBe(403);
    expect(await r.json()).not.toHaveProperty('loyalty');
  });
  it('rejects stale/revoked caller context before contacting either app', async () => {
    expect(await loyaltyFor({ ...customer, tokenVersion: customer.tokenVersion + 1 }, 'on2go')).toMatchObject({ connected: false, code: 'unverified_customer' });
    expect(await giftCardsFor(customer, 'pppmtl')).toMatchObject({ connected: false, code: 'unverified_customer' });
  });
});
