// The tenant (merchant) of this ON2GO Hub instance and the contracts with the TAKATAK control plane
// (docs/ON2GO_HUB_ECOSYSTEM.md § 4): a single-tenant default that changes nothing, idempotent usage events with counts
// only, entitlements read defensively, and signatures with a replay window.
import { describe, expect, it } from 'vitest';
import {
  controlPlane, DEFAULT_TENANT_ID, parseEntitlements, signContract, SINGLE_TENANT_ENTITLEMENTS, tenantId, tenantInfo, usageEvent, verifyContract,
} from '../lib/foodhub/tenant';

describe('tenant id', () => {
  it('defaults to the owner’s group and accepts only a clean slug', () => {
    expect(tenantId(undefined)).toBe(DEFAULT_TENANT_ID);
    expect(tenantId('')).toBe('takatak');
    expect(tenantId('  Resto-Laval ')).toBe('resto-laval');
    expect(tenantId('../etc')).toBe('takatak');
    expect(tenantId('a')).toBe('takatak');
    expect(tenantId('x'.repeat(41))).toBe('takatak');
    expect(tenantInfo({ FOODHUB_TENANT_ID: 'resto-laval' } as any)).toMatchObject({ id: 'resto-laval', source: 'env', product: 'on2go_hub' });
    expect(tenantInfo({} as any)).toMatchObject({ id: 'takatak', source: 'default', controlPlane: { configured: false } });
  });

  it('needs an https control plane URL and its own key', () => {
    expect(controlPlane({ TAKATAK_CONTROL_PLANE_URL: 'http://takatak.ca', TAKATAK_ON2GO_HUB_KEY: 'k' } as any).configured).toBe(false);
    expect(controlPlane({ TAKATAK_CONTROL_PLANE_URL: 'https://takatak.ca/', TAKATAK_ON2GO_HUB_KEY: 'k' } as any)).toEqual({ url: 'https://takatak.ca', keySet: true, configured: true });
    expect(controlPlane({ TAKATAK_CONTROL_PLANE_URL: 'https://takatak.ca' } as any).configured).toBe(false);
  });
});

describe('entitlements (C4)', () => {
  it('single tenant: everything allowed, no limits', () => {
    expect(SINGLE_TENANT_ENTITLEMENTS.features).toEqual({ delivery: true, retail: true, alcohol: true, phone: true, ownFleet: true });
    expect(SINGLE_TENANT_ENTITLEMENTS.limits).toEqual({ brands: null, kitchens: null });
  });

  it('reads a control-plane answer defensively: missing = not included, junk = no answer', () => {
    expect(parseEntitlements({ plan: 'pro', features: { phone: true, delivery: 'yes' }, limits: { brands: 5, kitchens: -1 } })).toEqual({
      plan: 'pro', features: { delivery: false, retail: false, alcohol: false, phone: true, ownFleet: false }, limits: { brands: 5, kitchens: null }, source: 'control_plane',
    });
    expect(parseEntitlements(null)).toBeNull();
    expect(parseEntitlements({ features: {} })).toBeNull();
  });
});

describe('usage events (C5)', () => {
  it('are idempotent, carry counts only and drop anything else', () => {
    const a = usageEvent('order.created', 'IA-1043', { orders: 1, items: 3, 'phone number': 5, total_cents: 2873, negative: -1, half: 0.5 }, '2026-10-09T12:00:00Z', 'takatak');
    const b = usageEvent('order.created', 'IA-1043', { orders: 1 }, '2026-10-09T12:05:00Z', 'takatak');
    expect(a.event_id).toBe(b.event_id);
    expect(a.event_id).toMatch(/^evt_[a-f0-9]{32}$/);
    expect(usageEvent('order.created', 'IA-1044', {}, undefined, 'takatak').event_id).not.toBe(a.event_id);
    expect(usageEvent('order.created', 'IA-1043', {}, undefined, 'other').event_id).not.toBe(a.event_id);
    expect(a).toEqual({ event_id: a.event_id, type: 'order.created', product: 'on2go_hub', tenant_id: 'takatak', occurred_at: '2026-10-09T12:00:00Z', counts: { orders: 1, items: 3, total_cents: 2873 } });
  });
});

describe('contract signatures', () => {
  const body = JSON.stringify({ hello: 'world' });
  const now = Date.parse('2026-10-09T12:00:00Z');
  it('accept the right key and body inside the window; refuse anything else', () => {
    const h = new Headers(signContract(body, 'evt_1', 'secret', now));
    expect(h.get('idempotency-key')).toBe('evt_1');
    expect(h.get('x-integration-id')).toBe('on2go_hub');
    expect(verifyContract(h, body, 'secret', now + 60_000)).toBe(true);
    expect(verifyContract(h, body, 'other-secret', now)).toBe(false);
    expect(verifyContract(h, `${body} `, 'secret', now)).toBe(false);
    expect(verifyContract(h, body, 'secret', now + 6 * 60_000)).toBe(false);
    expect(verifyContract(h, body, '', now)).toBe(false);
    const swapped = new Headers(h);
    swapped.set('x-event-id', 'evt_2');
    expect(verifyContract(swapped, body, 'secret', now)).toBe(false);
  });
});
