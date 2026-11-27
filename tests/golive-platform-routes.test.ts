import { afterEach, describe, expect, it, vi } from 'vitest';
import { goLiveProgress, platformGoLiveStep, type GoLivePlatform, type PlatformGoLiveInput } from '@/app/(console)/settings/go-live/steps';
import { GET as getChannels } from '@/app/api/foodhub/channels/route';
import type { T } from '@/lib/i18n';

const t: T = (_fr, en) => en;
const configured = (viaClover = false) => ({ label: 'Platform fixture', configured: true, missing: [], viaClover });
const mapping = (channel: GoLivePlatform, channelStoreId: string, locationCode = 'ACTIVE') => ({ channel, channelStoreId, locationCode });
const input = (fields: Partial<PlatformGoLiveInput> = {}): PlatformGoLiveInput => ({
  readiness: configured(), stores: [], activeLocations: new Set(['ACTIVE']), ...fields,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Go-live order intake', () => {
  it.each(['doordash', 'skip'] as const)('keeps %s direct incomplete with only relay, inactive or invalid mappings', (platform) => {
    const step = platformGoLiveStep(platform, input({
      stores: [mapping(platform, 'relay:partner'), mapping(platform, 'inactive-store', 'INACTIVE'), mapping(platform, ' '), mapping('uber_eats', 'other-provider')],
    }), t);
    expect(step).toMatchObject({ state: 'todo', href: '/stores/mapping' });
    expect(step.body).toMatch(/no direct store mapped to an active kitchen/i);
    expect(goLiveProgress([step])).toMatchObject({ complete: false, todo: 1 });
  });

  it.each(['doordash', 'skip'] as const)('describes a real local %s direct mapping without claiming order receipt', (platform) => {
    const step = platformGoLiveStep(platform, input({
      stores: [mapping(platform, 'direct-store'), mapping(platform, 'relay:partner'), mapping(platform, 'closed-store', 'INACTIVE')],
    }), t);
    expect(step).toMatchObject({ state: 'warn', href: '/stores/mapping' });
    expect(step.body).toMatch(/1 direct store mapping.*test order/i);
  });

  it.each([false, undefined])('requires an intake secret for an advertised order relay channel (%s)', (webhookReady) => {
    const step = platformGoLiveStep('doordash', input({ relay: { channels: ['doordash'], webhookReady } }), t);
    expect(step).toMatchObject({ state: 'todo', href: '/settings/channels' });
    expect(step.body).toMatch(/relay.*webhook/i);
  });

  it('explains a configured order relay and keeps a local relay ID out of the direct count', () => {
    const pausedStore = { ...mapping('skip', 'relay:partner'), online: false };
    const step = platformGoLiveStep('skip', input({
      relay: { channels: ['skip'], webhookReady: true }, stores: [pausedStore],
    }), t);
    expect(step).toMatchObject({ state: 'warn', href: '/settings/channels' });
    expect(step.body).toMatch(/order relay.*test order/i);
  });

  it('requires an active relay mapping and ignores empty relay placeholders and direct IDs', () => {
    const step = platformGoLiveStep('skip', input({
      readiness: { ...configured(), configured: false, missing: ['SKIP_JET_API_KEY'] },
      relay: { channels: ['skip'], webhookReady: true },
      stores: [mapping('skip', 'relay: '), mapping('skip', 'relay:inactive', 'INACTIVE'), mapping('skip', 'direct-store')],
    }), t);
    expect(step).toMatchObject({ state: 'todo', href: '/stores/mapping' });
    expect(step.body).toMatch(/map a relay store to an active kitchen/i);
    expect(goLiveProgress([step])).toMatchObject({ complete: false, todo: 1 });
  });

  it('keeps a configured direct route available when an unrelated relay setting lacks its secret', () => {
    const pausedStore = { ...mapping('skip', 'direct-store'), online: false };
    const step = platformGoLiveStep('skip', input({
      relay: { channels: ['skip'], webhookReady: false }, stores: [pausedStore],
    }), t);
    expect(step).toMatchObject({ state: 'warn', href: '/stores/mapping' });
    expect(step.body).toMatch(/1 direct store mapping.*test order/i);
  });

  it('identifies full DoorDash sandbox mode without suggesting a kitchen receipt from a sandbox order', () => {
    const step = platformGoLiveStep('doordash', input({
      readiness: { ...configured(), sandbox: true }, stores: [mapping('doordash', 'direct-store')],
    }), t);
    expect(step).toMatchObject({ state: 'todo', href: '/settings/channels' });
    expect(step.body).toMatch(/sandbox mode.*production connection/i);
  });

  it.each([false, undefined])('does not count a Clover mode flag as active import (%s)', (cloverPlatformOrdersEnabled) => {
    const step = platformGoLiveStep('doordash', input({
      readiness: configured(true), relay: { channels: ['doordash'], webhookReady: true }, cloverPlatformOrdersEnabled,
    }), t);
    expect(step).toMatchObject({ state: 'todo', href: '/settings/channels' });
    expect(step.body).toMatch(/Clover.*import/i);
  });

  it('keeps enabled via-Clover read-only imports distinct from proof of Clover and kitchen delivery', () => {
    const step = platformGoLiveStep('doordash', input({
      readiness: configured(true), cloverPlatformOrdersEnabled: true, stores: [mapping('doordash', 'direct-store')],
    }), t);
    expect(step).toMatchObject({ state: 'warn', href: '/settings/channels' });
    expect(step.body).toMatch(/read-only Clover.*test order/i);
  });

  it('preserves saved direct Uber confirmation and requests a kitchen receipt check', () => {
    const step = platformGoLiveStep('uber_eats', input({
      stores: [mapping('uber_eats', 'active-store')], uberDirect: { confirmed: 1, mapped: 1 },
    }), t);
    expect(step).toMatchObject({ state: 'done', href: '/stores/mapping' });
    expect(step.body).toMatch(/last recorded check.*test order/i);
  });

  it('reports the authenticated channel switches without exposing the relay secret or contacting providers', async () => {
    const password = 'test-golive-channel-config';
    const relaySecret = 'synthetic-relay-secret';
    vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
    vi.stubEnv('DASHBOARD_PASSWORD', password);
    vi.stubEnv('SESSION_SECRET', undefined);
    vi.stubEnv('FOODHUB_VIA_CLOVER', 'skip');
    vi.stubEnv('FOODHUB_CLOVER_PLATFORM_ORDERS', 'off');
    vi.stubEnv('DOORDASH_ENV', 'sandbox');
    vi.stubEnv('FOODHUB_RELAY_CHANNELS', 'doordash,skip');
    vi.stubEnv('FOODHUB_RELAY_SECRET', relaySecret);
    vi.stubGlobal('__foodhubMem', undefined);
    const fetch = vi.fn().mockRejectedValue(new Error('Unexpected provider request'));
    vi.stubGlobal('fetch', fetch);
    const url = 'http://hub.local/api/foodhub/channels';
    expect((await getChannels(new Request(url), undefined)).status).toBe(401);
    const authorization = `Basic ${Buffer.from(`owner:${password}`).toString('base64')}`;
    const response = await getChannels(new Request(url, { headers: { authorization } }), undefined);
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain(relaySecret);
    expect(JSON.parse(raw)).toMatchObject({
      clover: { platformOrdersEnabled: false },
      relay: { webhookReady: true, channels: ['doordash'] },
      channels: expect.arrayContaining([
        expect.objectContaining({ channel: 'skip', viaClover: true }),
        expect.objectContaining({ channel: 'doordash', sandbox: true }),
      ]),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
