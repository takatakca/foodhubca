// Clover App Market launch: listing texts within Clover's limits and in step with the docs, the public-domain check,
// Clover 429 back-off, SESSION_SECRET never generated at runtime, and the welcome wizard's three set-up steps.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  functionalDescription, LISTING_APP_NAME, LISTING_BENEFITS, LISTING_CATEGORIES, LISTING_DESCRIPTION, LISTING_PERMISSIONS, LISTING_TAGLINE,
} from '../lib/foodhub/clover-listing';
import { publicUrlCheck } from '../lib/foodhub/public-url';
import { cloverRetryDelayMs } from '../lib/foodhub/pos/clover-http';
import { ensureGeneratedSecrets, GENERATED_SECRET_KEYS } from '../lib/foodhub/runtime-secrets';

describe('Clover App Market listing texts', () => {
  it('respect Clover’s limits, in French and English', () => {
    expect(LISTING_APP_NAME).not.toMatch(/clover/i);
    for (const lang of ['fr', 'en'] as const) {
      expect(LISTING_TAGLINE[lang].length).toBeLessThanOrEqual(255);
      expect(LISTING_DESCRIPTION[lang]).toMatch(lang === 'fr' ? /Ce qu’il faut/ : /Requirements/); // setup requirements stated
      for (const b of LISTING_BENEFITS) expect(b[lang].length).toBeLessThanOrEqual(100);
      expect(functionalDescription(lang, 'aide@example.ca')).toContain('aide@example.ca');
      expect(functionalDescription(lang, '')).toContain('[FOODHUB_SUPPORT_EMAIL]');
    }
    expect(LISTING_BENEFITS.length).toBeGreaterThanOrEqual(3);
    expect(LISTING_BENEFITS.length).toBeLessThanOrEqual(5);
    expect(LISTING_CATEGORIES.functional.length).toBeLessThanOrEqual(3);
    expect(LISTING_CATEGORIES.vertical.length).toBeGreaterThanOrEqual(1);
    expect(LISTING_PERMISSIONS.map((p) => p.name)).toEqual(['Merchant', 'Inventory', 'Orders', 'Payments']);
    for (const p of LISTING_PERMISSIONS) expect(p.why.fr.length && p.why.en.length).toBeTruthy();
  });

  it('match docs/CLOVER_APP_LISTING.md word for word (one source of truth)', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CLOVER_APP_LISTING.md'), 'utf8');
    for (const s of [LISTING_TAGLINE.fr, LISTING_TAGLINE.en, ...LISTING_BENEFITS.flatMap((b) => [b.fr, b.en])]) expect(doc).toContain(s);
    for (const p of LISTING_PERMISSIONS) expect(doc).toContain(p.why.en);
  });
});

describe('public domain check (FOODHUB_PUBLIC_URL)', () => {
  it('accepts the company domain over HTTPS', () => {
    expect(publicUrlCheck('https://foodhub.takatak.ca/')).toEqual({ url: 'https://foodhub.takatak.ca', host: 'foodhub.takatak.ca', ready: true, problems: [] });
  });
  it('explains what is wrong with temporary, local or unsafe addresses', () => {
    expect(publicUrlCheck(undefined).problems).toEqual(['unset']);
    expect(publicUrlCheck('https://203-0-113-10.sslip.io').problems).toEqual(['wildcard_dns']);
    expect(publicUrlCheck('http://203.0.113.10').problems).toEqual(['not_https', 'ip_address']);
    expect(publicUrlCheck('http://localhost:3000').problems).toEqual(['not_https', 'local']);
    expect(publicUrlCheck('https://takatak.example').problems).toEqual(['example']);
    expect(publicUrlCheck('https://clover-hub.takatak.ca').problems).toEqual(['clover_in_name']);
    expect(publicUrlCheck('https://takatak.ca/foodhub').problems).toEqual(['path']);
  });
});

describe('Clover rate limits (429)', () => {
  it('waits for Retry-After (capped), else 1 s then 2 s', () => {
    expect(cloverRetryDelayMs('2', 0, 1000)).toBe(2000);
    expect(cloverRetryDelayMs('120', 0, 1000)).toBe(5000);
    expect(cloverRetryDelayMs(null, 0, 1000)).toBe(1000);
    expect(cloverRetryDelayMs(null, 1, 1000)).toBe(2000);
    expect(cloverRetryDelayMs('soon', 1, 1000)).toBe(2000);
    expect(cloverRetryDelayMs(new Date(Date.now() + 3000).toUTCString(), 0, 1000)).toBeGreaterThan(1000);
  });
});

describe('SESSION_SECRET is never generated at runtime (stable sign-in)', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.FOODHUB_FORCE_MEMORY = 'true';
    (globalThis as any).__foodhubMem = undefined;
    for (const k of [...GENERATED_SECRET_KEYS, 'SESSION_SECRET', 'DASHBOARD_PASSWORD']) delete process.env[k];
  });
  afterEach(() => { process.env = { ...env }; });

  it('is not created, in production or development, and an old stored one is not loaded', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    await getRepo().setKv('generated_secrets_v1', { SESSION_SECRET: 'f'.repeat(64) }); // left by an earlier build
    for (const mode of ['production', 'development']) {
      (process.env as Record<string, string>).NODE_ENV = mode;
      const r = await ensureGeneratedSecrets();
      expect([...r.created, ...r.loaded]).not.toContain('SESSION_SECRET');
      expect(process.env.SESSION_SECRET).toBeUndefined();
    }
  });

  it('stays the same across restarts and instances without a database: derived from DASHBOARD_PASSWORD', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.DASHBOARD_PASSWORD = 'owner-recovery-pass-123';
    const { sessionSecretSource, signSession, verifySession } = await import('../lib/foodhub/session');
    await ensureGeneratedSecrets();
    expect(sessionSecretSource()).toBe('password');
    const cookie = await signSession({ u: 'owner', n: 'Owner', r: 'owner', l: [], exp: Math.floor(Date.now() / 1000) + 600 });
    (globalThis as any).__foodhubMem = undefined; // restart in memory mode (or a second instance): nothing kept
    await ensureGeneratedSecrets();
    expect((await verifySession(cookie))?.u).toBe('owner');
  });

  it('production with neither SESSION_SECRET nor DASHBOARD_PASSWORD has no key (the proxy answers 503)', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    await ensureGeneratedSecrets();
    const { sessionSecretSource } = await import('../lib/foodhub/session');
    expect(sessionSecretSource()).toBeNull();
  });
});

describe('welcome wizard: the three set-up steps', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.FOODHUB_FORCE_MEMORY = 'true';
    (globalThis as any).__foodhubMem = undefined;
    for (const k of ['FOODHUB_VIA_CLOVER', 'FOODHUB_RELAY_CHANNELS', 'UBER_CLIENT_ID', 'UBER_CLIENT_SECRET', 'DOORDASH_DEVELOPER_ID', 'SKIP_JET_API_KEY']) delete process.env[k];
  });
  afterEach(() => { process.env = { ...env }; });

  it('are done only when Food Hub can see them working', async () => {
    const { onboardingSteps } = await import('../lib/foodhub/onboarding');
    const { getRepo } = await import('../lib/foodhub/repo');
    const none = await onboardingSteps({ merchantId: 'TESTMERCH0003' });
    expect(none.map((s) => [s.key, s.done])).toEqual([['platforms', false], ['menu', false], ['kitchen', false]]);

    process.env.FOODHUB_VIA_CLOVER = 'doordash'; // DoorDash linked through Clover: orders arrive, read from Clover
    const repo = getRepo();
    await repo.saveMenu({ brandName: 'Test', categories: [], modifierGroups: [], posMerchantId: 'TESTMERCH0003', updatedAt: new Date().toISOString(),
      items: [{ ref: 'i1', name: 'Poutine', price: 12.5, categoryRef: 'c1', available: true, modifierGroupRefs: [] }] } as any);
    await repo.putDocs('devices', [{ id: 'dev-1', key: 'NDG', at: new Date().toISOString(), data: { id: 'dev-1', name: 'Cuisine', locationCode: 'NDG', enrolledBy: 'Owner', enrolledAt: new Date().toISOString() } }]);
    const half = await onboardingSteps({ merchantId: 'TESTMERCH0003' });
    expect(half.map((s) => [s.key, s.done])).toEqual([['platforms', true], ['menu', true], ['kitchen', false]]); // no PIN yet
    expect(half[0].detail.en).toContain('DoorDash');
    expect(half[1].detail.en).toContain('1 item');
    expect((await onboardingSteps({ merchantId: 'OTHERMERCH01' }))[1].done).toBe(false); // menu from another register

    const done = await onboardingSteps({ merchantId: 'TESTMERCH0003', viewerHasPin: true });
    expect(done.every((s) => s.done)).toBe(true);
  });
});
