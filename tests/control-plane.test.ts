import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredControlPlane } from '../lib/foodhub/control-plane/config';
import { deliverWireEvent, parseWireEvent, readMerchantObservation } from '../lib/foodhub/control-plane/client';
import { CONTROL_PLANE_OUTBOX, observeOrders, stableUuid, tickControlPlane, wireEvent, type OutboxEntry } from '../lib/foodhub/control-plane/outbox';
import { controlPlaneStatus } from '../lib/foodhub/control-plane/status';
import { getRepo } from '../lib/foodhub/repo';
import { GET as statusRoute } from '../app/api/foodhub/control-plane/route';
import { hashPassword } from '../lib/foodhub/auth';
import type { NormalizedOrder } from '../lib/foodhub/types';
import { masterApiFixture, masterApiSourceAvailable, SYNTHETIC_MASTER_ID, SYNTHETIC_MASTER_KEY } from './helpers/master-api-fixture';

const BASE = Date.parse('2026-11-04T12:00:00.000Z');
const cfg = () => configuredControlPlane().config!;
const mapping = () => ({ instanceTenantId: 'synthetic-group', merchants: [{ localVendorId: 'synthetic-vendor', masterMerchantId: SYNTHETIC_MASTER_ID, locationCodes: ['TEST_KITCHEN'] }] });
const input = (id = 'order-proof'): NormalizedOrder & { locationCode: string } => ({ channel: 'doordash', marketplace: 'doordash', externalOrderId: id, displayId: 'DEMO', brandName: 'Synthetic kitchen', channelStoreId: 'synthetic-store', customerName: 'NOT SENT',
  fulfillment: 'delivery', currency: 'CAD', placedAt: new Date(BASE).toISOString(), subtotal: 10, tax: 1, total: 11, deliveryFee: 0, tip: 0, discount: 0, locationCode: 'TEST_KITCHEN',
  lines: [{ name: 'NOT SENT', quantity: 1, unitPrice: 10, total: 10, modifiers: [] }], raw: { phone: '+15145550101', email: 'not-sent@example.test' } });
const queue = async () => (await getRepo().listDocs<OutboxEntry>(CONTROL_PLANE_OUTBOX)).map((d) => d.data);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });vi.setSystemTime(BASE);
  vi.stubEnv('NODE_ENV', 'test');vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  vi.stubEnv('TAKATAK_CONTROL_PLANE_URL', 'https://master.example.test');vi.stubEnv('TAKATAK_FOODHUB_API_KEY', SYNTHETIC_MASTER_KEY);
  vi.stubEnv('TAKATAK_ON2GO_HUB_KEY', '');vi.stubEnv('FOODHUB_TENANT_ID', 'synthetic-group');vi.stubEnv('FOODHUB_CONTROL_PLANE_MERCHANTS', JSON.stringify(mapping()));
  vi.stubEnv('DASHBOARD_PASSWORD', 'synthetic-owner-pass');
});
afterEach(() => { vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks(); });

describe('actual master wire contract', () => {
  it('requires a dedicated key and explicit unambiguous instance/merchant/location mapping', () => {
    expect(configuredControlPlane().readiness.configured).toBe(true);
    vi.stubEnv('TAKATAK_FOODHUB_API_KEY', '');vi.stubEnv('TAKATAK_ON2GO_HUB_KEY', 'legacy-only-key');
    expect(configuredControlPlane().config).toBeNull();
    vi.stubEnv('TAKATAK_FOODHUB_API_KEY', SYNTHETIC_MASTER_KEY);
    const m = mapping();m.merchants.push({ ...m.merchants[0], localVendorId: 'other' });
    vi.stubEnv('FOODHUB_CONTROL_PLANE_MERCHANTS', JSON.stringify(m));expect(configuredControlPlane().readiness.problem).toBe('ambiguous_mapping');
    vi.stubEnv('FOODHUB_CONTROL_PLANE_MERCHANTS', JSON.stringify({ ...mapping(), instanceTenantId: 'another' }));expect(configuredControlPlane().config).toBeNull();
  });
  it('reads only source subscription metadata and refuses unknown or mismatched merchant identities', async () => {
    const api = masterApiFixture(BASE);const config = cfg();
    expect(await readMerchantObservation(config, config.merchants[0], BASE, api.fetcher)).toMatchObject({ verified: true, subscriptionPlan: 'Source plan', subscriptionStatus: 'source-reported' });
    expect(api.calls[0]).toMatchObject({ authorization: `Bearer ${SYNTHETIC_MASTER_KEY}` });
    api.setKnown(false);expect(await readMerchantObservation(config, config.merchants[0], BASE, api.fetcher)).toMatchObject({ known: false, verified: false });
    api.setKnown(true);api.sourceMerchant.merchantId = '00000000-0000-4000-8000-000000000001';
    expect(await readMerchantObservation(config, config.merchants[0], BASE, api.fetcher)).toMatchObject({ verified: false, error: 'merchant_mismatch' });
  });
  it.skipIf(!masterApiSourceAvailable)('uses actual V1 handlers for scope validation and exact-byte idempotency', async () => {
    const api = masterApiFixture(BASE);expect(api.source).toBe('actual-v1');
    const config = cfg();const stored = (await getRepo().insertOrderIfNew(input())).order;
    const event = wireEvent(config, config.merchants[0], stored, 'order.created')!;const body = JSON.stringify(event);
    expect(event.event_id).toMatch(/^[0-9a-f-]{14}5/); // receiver accepts RFC UUID versions 1–5, not old evt_ IDs.
    expect(await deliverWireEvent(config, body, api.fetcher)).toEqual({ duplicate: false });
    expect(await deliverWireEvent(config, body, api.fetcher)).toEqual({ duplicate: true });
    const changed = JSON.stringify({ ...event, payload: { ...event.payload, occurred_at: new Date(BASE + 1000).toISOString() } });
    await expect(deliverWireEvent(config, changed, api.fetcher)).rejects.toMatchObject({ code: 'http_409', permanent: true });
    const response = await api.fetcher('https://master.example.test/api/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SYNTHETIC_MASTER_KEY}`, 'Idempotency-Key': event.event_id }, body: JSON.stringify({ ...event, source_application: 'on2go' }) });
    expect(response.status).toBe(400);
  });
  it('strictly excludes PII, provider payloads, payment and extra identity fields from wire events', async () => {
    const config = cfg();const stored = (await getRepo().insertOrderIfNew(input())).order;
    const event = wireEvent(config, config.merchants[0], stored, 'order.created')!;
    expect(JSON.stringify(event)).not.toMatch(/NOT SENT|15145550101|example.test|customer|payment|subtotal|tax|lines/);
    expect(event.payload.counts).toEqual({ orders: 1 });
    expect(parseWireEvent(JSON.stringify({ ...event, payload: { ...event.payload, customer_local_id: 'private' } }))).toBeNull();
    const fetcher = vi.fn();await expect(deliverWireEvent(config, JSON.stringify({ ...event, private: 'data' }), fetcher)).rejects.toMatchObject({ code: 'invalid_event' });expect(fetcher).not.toHaveBeenCalled();
    expect(wireEvent(config, config.merchants[0], { ...stored, status: 'accepted', timeline: { posPaymentId: 'paid' } }, 'order.fulfilled')).toBeNull();
  });
  it('does not acknowledge HTML, foreign aggregate responses or rate limits, and bounds Retry-After', async () => {
    const config = cfg();const stored = (await getRepo().insertOrderIfNew(input())).order;
    const event = wireEvent(config, config.merchants[0], stored, 'order.created')!;const body = JSON.stringify(event);
    await expect(deliverWireEvent(config, body, async () => new Response('<html>Login</html>', { status: 200 }))).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(deliverWireEvent(config, body, async () => Response.json({ ok: true, id: SYNTHETIC_MASTER_ID, aggregate_type: 'order', aggregate_id: stableUuid('other'), duplicate: false }))).rejects.toMatchObject({ code: 'event_response_mismatch' });
    await expect(deliverWireEvent(config, body, async () => new Response('', { status: 429, headers: { 'Retry-After': '7200' } }))).rejects.toMatchObject({ code: 'http_429', permanent: false, retryAfterMs: 3600_000 });
    await expect(deliverWireEvent(config, body, async () => new Response('', { status: 503, headers: { 'Retry-After': new Date(BASE + 120_000).toUTCString() } }))).rejects.toMatchObject({ code: 'http_503', retryAfterMs: 120_000 });
  });
});

describe('durable optional order reporting', () => {
  it('observes persisted final state, freezes bodies and de-duplicates later status changes', async () => {
    const api = masterApiFixture(BASE);expect((await tickControlPlane(BASE, api.fetcher)).queued).toBe(0);
    vi.setSystemTime(BASE + 1000);const order = (await getRepo().insertOrderIfNew(input())).order;
    expect((await tickControlPlane(BASE + 1000, api.fetcher)).queued).toBe(1);
    expect((await queue()).filter((e) => e.state === 'pending')).toHaveLength(1);
    vi.setSystemTime(BASE + 31_000);expect((await tickControlPlane(BASE + 31_000, api.fetcher)).sent).toBe(1);
    vi.setSystemTime(BASE + 32_000);await getRepo().patchOrder(order.id, { completedAt: new Date(BASE + 32_000).toISOString() }, { status: 'completed' });
    expect((await tickControlPlane(BASE + 32_000, api.fetcher)).queued).toBe(1);
    vi.setSystemTime(BASE + 62_000);expect((await tickControlPlane(BASE + 62_000, api.fetcher)).sent).toBe(1);
    expect(api.events.size).toBe(2);expect((await tickControlPlane(BASE + 93_000, api.fetcher)).queued).toBe(0);
    expect((await getRepo().getOrder(order.id))?.status).toBe('completed');
  });
  it('keeps orders operational during an outage and retries the identical event after a lost response', async () => {
    const api = masterApiFixture(BASE);await tickControlPlane(BASE, api.fetcher);
    vi.setSystemTime(BASE + 1000);const order = (await getRepo().insertOrderIfNew(input())).order;await tickControlPlane(BASE + 1000, api.fetcher);
    let drop = true;
    const dropping: typeof fetch = async (url, init) => { const res = await api.fetcher(url, init);if (String(url).endsWith('/events') && drop) { drop = false;throw new Error('response lost'); }return res; };
    vi.setSystemTime(BASE + 31_000);await tickControlPlane(BASE + 31_000, dropping);
    expect(api.events.size).toBe(1);expect((await queue())[0].state).toBe('pending');
    vi.setSystemTime(BASE + 62_000);expect((await tickControlPlane(BASE + 62_000, dropping)).sent).toBe(1);
    const sent = api.calls.filter((c) => c.path.endsWith('/events'));expect(sent[0].body).toBe(sent[1].body);expect(sent[0].idempotency).toBe(sent[1].idempotency);
    api.setAvailable(false);vi.setSystemTime(BASE + 94_000);expect((await tickControlPlane(BASE + 94_000, api.fetcher)).skipped).toBeUndefined();
    await getRepo().patchOrder(order.id, { printedAt: new Date(BASE + 94_000).toISOString() }, { status: 'ready' });
    expect((await getRepo().getOrder(order.id))?.timeline?.printedAt).toBeTruthy();
  });
  it('does not advance the change cursor past a failed durable enqueue', async () => {
    const config = cfg();await observeOrders(config, BASE);
    vi.setSystemTime(BASE + 1000);await getRepo().insertOrderIfNew(input());
    const original = getRepo().putDocs;
    const spy = vi.spyOn(getRepo(), 'putDocs').mockRejectedValueOnce(new Error('database unavailable'));
    await expect(observeOrders(config, BASE + 1000)).rejects.toThrow();spy.mockRestore();
    expect(getRepo().putDocs).toBe(original);
    expect((await observeOrders(config, BASE + 2000)).queued).toBe(1);expect(await queue()).toHaveLength(1);
  });
  it('holds old target mappings and never auto-creates an unknown merchant', async () => {
    const api = masterApiFixture(BASE);await tickControlPlane(BASE, api.fetcher);
    vi.setSystemTime(BASE + 1000);await getRepo().insertOrderIfNew(input());await tickControlPlane(BASE + 1000, api.fetcher);
    const m = mapping();m.merchants[0].locationCodes.push('NEW_KITCHEN');vi.stubEnv('FOODHUB_CONTROL_PLANE_MERCHANTS', JSON.stringify(m));
    await tickControlPlane(BASE + 31_000, api.fetcher);expect((await controlPlaneStatus()).held).toBe(1);expect(api.events.size).toBe(0);
    expect(api.calls.some((c) => c.path.includes('resolve'))).toBe(false);
  });
  it('holds the cursor on a corrupt or mismatched canonical claim and repairs only after its original scope is restored', async () => {
    const config = cfg();const repo = getRepo();await observeOrders(config, BASE);
    vi.setSystemTime(BASE + 1000);const order = (await repo.insertOrderIfNew(input())).order;
    const event = wireEvent(config, config.merchants[0], order, 'order.created')!;
    const key = `control-plane:canonical:${event.event_id}`;
    await repo.claimKv(key, { bindingKey: 'wrong-target', origin: config.url, instanceTenantId: config.instanceTenantId, rawBody: JSON.stringify(event) });
    await expect(observeOrders(config, BASE + 1000)).rejects.toThrow('canonical_event_mismatch');
    expect(await repo.getKv(`control-plane:cursor:${config.fingerprint}`)).toEqual({ startedAt: new Date(BASE).toISOString() });
    expect(await queue()).toHaveLength(0);
    await repo.setKv(key, { bindingKey: config.merchants[0].key, origin: config.url, instanceTenantId: config.instanceTenantId, rawBody: JSON.stringify({ ...event, event_id: stableUuid('corrupt') }) });
    await expect(observeOrders(config, BASE + 2000)).rejects.toThrow('canonical_event_mismatch');
    await repo.setKv(key, { bindingKey: config.merchants[0].key, origin: config.url, instanceTenantId: config.instanceTenantId, rawBody: JSON.stringify(event), state: 'pending', attempts: 0, nextAt: new Date(BASE + 1000).toISOString(), createdAt: new Date(BASE + 1000).toISOString() } satisfies OutboxEntry);
    expect((await observeOrders(config, BASE + 2000)).queued).toBe(1);
  });
  it('does nothing when unconfigured and refuses non-persistent production reporting', async () => {
    vi.stubEnv('TAKATAK_FOODHUB_API_KEY', '');const fetcher = vi.fn();expect((await tickControlPlane(BASE, fetcher)).skipped).toBe('not_configured');expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv('TAKATAK_FOODHUB_API_KEY', SYNTHETIC_MASTER_KEY);vi.stubEnv('NODE_ENV', 'production');
    expect((await tickControlPlane(BASE, fetcher)).skipped).toBe('durable_storage_required');
  });
  it('limits status to administrators and returns no credentials or private event payloads', async () => {
    const api = masterApiFixture(BASE);await tickControlPlane(BASE, api.fetcher);
    const anonymous = await statusRoute(new Request('https://hub.example.test/api/foodhub/control-plane'), undefined);expect(anonymous.status).toBe(401);
    await getRepo().saveUser({ username: 'operator-proof', name: 'Operator', role: 'operator', locations: ['TEST_KITCHEN'], active: true, passwordHash: hashPassword('synthetic-operator-pass') });
    const operator = await statusRoute(new Request('https://hub.example.test/api/foodhub/control-plane', { headers: { Authorization: `Basic ${Buffer.from('operator-proof:synthetic-operator-pass').toString('base64')}` } }), undefined);expect(operator.status).toBe(403);
    const owner = await statusRoute(new Request('https://hub.example.test/api/foodhub/control-plane', { headers: { Authorization: `Basic ${Buffer.from('owner:synthetic-owner-pass').toString('base64')}` } }), undefined);
    expect(owner.status).toBe(200);const text = await owner.text();expect(text).not.toContain(SYNTHETIC_MASTER_KEY);expect(text).not.toContain(SYNTHETIC_MASTER_ID);expect(text).not.toContain('synthetic-vendor');expect(text).not.toContain('rawBody');
    expect(JSON.parse(text).controlPlane.featureGates).toBe('not_implemented');
  });
});

describe('repository read cursor and exact document matching', () => {
  it('paginates equal update timestamps by id and observes old orders completed later', async () => {
    const repo = getRepo();const a = (await repo.insertOrderIfNew(input('a'))).order;const b = (await repo.insertOrderIfNew(input('b'))).order;
    const first = await repo.listChangedOrders({ since: new Date(BASE).toISOString(), limit: 1 });
    const second = await repo.listChangedOrders({ since: new Date(BASE).toISOString(), after: { at: first[0].updatedAt, id: first[0].id }, limit: 1 });
    expect(new Set([first[0].id, second[0].id])).toEqual(new Set([a.id, b.id]));
    vi.setSystemTime(BASE + 1000);await repo.updateOrder(a.id, { status: 'completed' });
    expect((await repo.listChangedOrders({ since: new Date(BASE + 500).toISOString() })).map((o) => o.id)).toEqual([a.id]);
  });
  it('matches nested JSON before limit and never traverses prototypes or coerces number/string', async () => {
    const repo = getRepo();await repo.putDocs('proof', [
      { id: 'wrong', at: new Date(BASE + 1000).toISOString(), data: { number: 'D-1', paylink: { merchantId: 'OTHER', marker: 'marker' } } },
      { id: 'right', at: new Date(BASE).toISOString(), data: { number: 'D-1', paylink: { merchantId: 'MERCHANT', marker: 'marker', status: 'PAID' } } },
    ]);
    expect((await repo.listDocs('proof', { dataEquals: { number: 'D-1', paylink: { merchantId: 'MERCHANT', marker: 'marker' } }, limit: 1 })).map((d) => d.id)).toEqual(['right']);
    expect(await repo.listDocs('proof', { dataEquals: { number: 1 } })).toEqual([]);
    await expect(repo.listDocs('proof', { dataEquals: JSON.parse('{"__proto__":{"polluted":true}}') })).rejects.toThrow('Invalid exact document filter');
    expect(stableUuid('same')).toBe(stableUuid('same'));expect(stableUuid('other')).not.toBe(stableUuid('same'));
  });
});
