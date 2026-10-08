// Certification backlog (task 13): docs/PLATFORM_API_RESEARCH.md §6, each field checked on the official docs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doorDashAdapter, doorDashUserAgent } from '../lib/foodhub/adapters/doordash';
import type { StoredOrder } from '../lib/foodhub/types';

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
const calls: Call[] = [];
function mockFetch(route: (c: Call) => { status: number; body?: unknown }) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* form body */ }
    const c: Call = { url, method: init.method || 'GET', body, headers: { ...(init.headers as Record<string, string> | undefined) } };
    calls.push(c);
    const r = route(c);
    return new Response(r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}

const ENV_KEYS = ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET', 'DOORDASH_PROVIDER_TYPE', 'DOORDASH_WEBHOOK_SECRET', 'DOORDASH_USER_AGENT', 'LIVE_CONNECTORS_GLOBAL_ENABLED'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function doorDashEnv() {
  process.env.DOORDASH_DEVELOPER_ID = 'dev'; process.env.DOORDASH_KEY_ID = 'kid'; process.env.DOORDASH_SIGNING_SECRET = 'c2VjcmV0';
  process.env.DOORDASH_PROVIDER_TYPE = 'takatak_sandbox'; process.env.DOORDASH_WEBHOOK_SECRET = 'dd-secret';
  process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
  delete process.env.DOORDASH_USER_AGENT;
}

describe('DoorDash User-Agent (<ProviderType in CamelCase>/1.0)', () => {
  it('turns the snake_case provider type into the documented CamelCase form', () => {
    expect(doorDashUserAgent('merchant_sandbox', '')).toBe('MerchantSandbox/1.0'); // DoorDash's own example
    expect(doorDashUserAgent('takatak', '')).toBe('Takatak/1.0');
    expect(doorDashUserAgent('', '')).toBeNull();
    expect(doorDashUserAgent('doordash_pizza', 'DoorDashPizza/1.0')).toBe('DoorDashPizza/1.0'); // exact spelling override
  });

  it('is sent on every Marketplace call, with the JWT and auth-version headers', async () => {
    doorDashEnv();
    mockFetch(() => ({ status: 200, body: {} }));
    await doorDashAdapter.markReady({ externalOrderId: 'dd-1', id: 'o1' } as StoredOrder);
    expect(calls[0].headers['User-Agent']).toBe('TakatakSandbox/1.0');
    expect(calls[0].headers['auth-version']).toBe('v2');
    expect(calls[0].headers.Authorization).toMatch(/^Bearer /);
  });
});
