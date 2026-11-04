import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../lib/foodhub/auth';
import { COL, type ReconCase } from '../lib/foodhub/recon/engine';
import { getRepo } from '../lib/foodhub/repo';
import { scopeHref } from '../lib/foodhub/scope';

process.env.FOODHUB_FORCE_MEMORY = 'true';
process.env.DASHBOARD_PASSWORD = 'Dispute-link-owner-42';
process.env.FOODHUB_TRUST_PROXY = 'true';
const pass = 'Dispute-link-limited-42';
const request = (query: string, user = 'owner') => new Request(`http://hub.local/api/foodhub/recon/cases?${query}`, { headers: { authorization: `Basic ${Buffer.from(`${user}:${user === 'owner' ? process.env.DASHBOARD_PASSWORD : pass}`).toString('base64')}`, 'x-forwarded-for': '10.2.42.5' } });
const make = (id: string, patch: Partial<ReconCase> = {}): ReconCase => ({ id, type: 'short_paid', channel: 'doordash', ref: 'DD-42', orderId: 'order-target', brandName: 'Alpha', locationCode: 'NDG', orderDate: '2026-11-04', amount: 2, status: 'open', notes: [], openedAt: '2026-11-04', updatedAt: '2026-11-04', ...patch });
const read = async (query: string, user = 'owner') => {
  const { GET } = await import('../app/api/foodhub/recon/cases/route');
  const res = await GET(request(query, user), {});
  return { res, body: await res.json() };
};
beforeAll(async () => {
  const repo = getRepo();
  await repo.saveUser({ username: 'limited_disputes', name: 'Manager', role: 'manager', locations: ['NDG'], active: true, lastLoginAt: null, passwordHash: hashPassword(pass) });
  const cases = [make('open'), make('recovered', { status: 'recovered' }), make('other-order', { orderId: 'order-other' }), make('other-provider', { channel: 'uber_eats' }), make('other-brand', { brandName: 'Beta' }), make('other-location', { locationCode: 'SL' })];
  await repo.putDocs(COL.cases, cases.map((c) => ({ id: c.id, key: c.channel, at: c.openedAt, data: c })));
});
describe('exact order dispute navigation', () => {
  it('links by exact order identity while keeping its real provider, brand and restaurant', () => {
    const url = new URL(scopeHref('/money/disputes?order=order-target', { kitchen: 'NDG', brand: 'Alpha', channel: 'doordash' }), 'http://hub.local');
    expect(Object.fromEntries(url.searchParams)).toEqual({ order: 'order-target', kitchen: 'NDG', brand: 'Alpha', channel: 'doordash' });
  });
  it('returns only this order AND selected scope, including closed/recovered cases', async () => {
    const { res, body } = await read('order=order-target&channels=doordash&brands=Alpha&locations=NDG');
    expect(res.status).toBe(200);
    expect(body.cases.map((c: ReconCase) => c.id).sort()).toEqual(['open', 'recovered']);
    expect((await getRepo().listDocs(COL.cases, {}))).toHaveLength(6); // read-only: no case is changed or removed.
  });
  it('an unknown exact order yields an empty selection rather than all cases', async () => {
    expect((await read('order=unknown')).body.cases).toEqual([]);
  });
  it('retains the all-location finance permission boundary', async () => {
    expect((await read('order=order-target&locations=NDG', 'limited_disputes')).res.status).toBe(403);
  });
});
