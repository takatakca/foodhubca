// The crash-replay check's test-only hooks (lib/foodhub/e2e-hooks.ts): they act only under FOODHUB_E2E=1 with a
// run-time NODE_ENV of test / development, and production ignores them — the inbox keeps its 2-minute stuck rule and
// never waits.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { e2eHookMs, e2eHooksAllowed } from '../lib/foodhub/e2e-hooks';
import { getInboxEntry, receiveWebhook, runInboxEntry, sweepInbox } from '../lib/foodhub/inbox';

const KEYS = ['FOODHUB_E2E', 'NODE_ENV', 'FOODHUB_E2E_PROCESS_DELAY_MS', 'FOODHUB_E2E_INBOX_STUCK_MS', 'FOODHUB_FORCE_MEMORY'] as const;
const saved: Record<string, string | undefined> = {};
const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  for (const k of KEYS) saved[k] = env[k];
  env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete env[k]; else env[k] = saved[k]; }
  vi.restoreAllMocks();
});

// An Uber event type Food Hub does not handle: kept under Unparsed payloads, "done" — no network involved.
const unknownUberEvent = (id: string) => ({ event_type: 'e2e.ping', event_id: id, meta: { resource_id: id } });

describe('test-only hooks guard', () => {
  it('acts only with FOODHUB_E2E=1 and NODE_ENV test or development', () => {
    expect(e2eHooksAllowed({ FOODHUB_E2E: '1', NODE_ENV: 'test' })).toBe(true);
    expect(e2eHooksAllowed({ FOODHUB_E2E: '1', NODE_ENV: 'development' })).toBe(true);
    expect(e2eHooksAllowed({ FOODHUB_E2E: '1', NODE_ENV: 'production' })).toBe(false);
    expect(e2eHooksAllowed({ FOODHUB_E2E: '1' })).toBe(false); // NODE_ENV not set: refused too
    expect(e2eHooksAllowed({ NODE_ENV: 'test' })).toBe(false);
    expect(e2eHooksAllowed({ FOODHUB_E2E: 'true', NODE_ENV: 'test' })).toBe(false);
  });

  it('production refuses the values (one warning per variable), test mode reads and caps them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prod = { FOODHUB_E2E: '1', NODE_ENV: 'production', FOODHUB_E2E_PROCESS_DELAY_MS: '60000' };
    expect(e2eHookMs('FOODHUB_E2E_PROCESS_DELAY_MS', { max: 120_000 }, prod)).toBeNull();
    expect(e2eHookMs('FOODHUB_E2E_PROCESS_DELAY_MS', { max: 120_000 }, prod)).toBeNull();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('FOODHUB_E2E_PROCESS_DELAY_MS ignored')).length).toBeLessThanOrEqual(1);
    const test = { FOODHUB_E2E: '1', NODE_ENV: 'test', FOODHUB_E2E_PROCESS_DELAY_MS: '999999', FOODHUB_E2E_INBOX_STUCK_MS: '200' };
    expect(e2eHookMs('FOODHUB_E2E_PROCESS_DELAY_MS', { max: 120_000 }, test)).toBe(120_000);
    expect(e2eHookMs('FOODHUB_E2E_INBOX_STUCK_MS', { min: 1000, max: 120_000 }, test)).toBeNull(); // below the minimum
    expect(e2eHookMs('FOODHUB_E2E_INBOX_STUCK_MS', { max: 1 }, { FOODHUB_E2E: '1', NODE_ENV: 'test', FOODHUB_E2E_INBOX_STUCK_MS: 'soon' })).toBeNull();
    expect(e2eHookMs('FOODHUB_E2E_PROCESS_DELAY_MS', { max: 1 }, { FOODHUB_E2E: '1', NODE_ENV: 'test' })).toBeNull(); // not set
  });
});

describe('webhook inbox with the hooks set', () => {
  it('production ignores FOODHUB_E2E_INBOX_STUCK_MS: an unprocessed entry still waits the full 2 minutes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    Object.assign(env, { FOODHUB_E2E: '1', NODE_ENV: 'production', FOODHUB_E2E_INBOX_STUCK_MS: '1000' });
    const e = await receiveWebhook({ channel: 'uber_eats', kind: 'uber', body: unknownUberEvent('hook-prod-1'), reference: 'hook-prod-1' });
    expect((await sweepInbox({ now: Date.now() + 5_000 })).processed).toBe(0);
    expect((await getInboxEntry(e.id))?.status).toBe('received');
    expect((await sweepInbox({ now: Date.now() + 121_000 })).processed).toBe(1);
  });

  it('the crash check (FOODHUB_E2E=1, NODE_ENV=test) can shorten the stuck time', async () => {
    Object.assign(env, { FOODHUB_E2E: '1', NODE_ENV: 'test', FOODHUB_E2E_INBOX_STUCK_MS: '1000' });
    const e = await receiveWebhook({ channel: 'uber_eats', kind: 'uber', body: unknownUberEvent('hook-test-1'), reference: 'hook-test-1' });
    expect((await sweepInbox({ now: Date.now() + 500 })).processed).toBe(0);
    expect((await sweepInbox({ now: Date.now() + 1_500 })).processed).toBe(1);
    expect((await getInboxEntry(e.id))?.status).toBe('done');
  });

  it('production never holds an entry for FOODHUB_E2E_PROCESS_DELAY_MS', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    Object.assign(env, { FOODHUB_E2E: '1', NODE_ENV: 'production', FOODHUB_E2E_PROCESS_DELAY_MS: '15000' });
    const e = await receiveWebhook({ channel: 'uber_eats', kind: 'uber', body: unknownUberEvent('hook-prod-2'), reference: 'hook-prod-2' });
    const t0 = Date.now();
    expect((await runInboxEntry(e.id))?.status).toBe('done');
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('the crash check holds a "processing" entry for the delay before processing it', async () => {
    Object.assign(env, { FOODHUB_E2E: '1', NODE_ENV: 'test', FOODHUB_E2E_PROCESS_DELAY_MS: '400' });
    const e = await receiveWebhook({ channel: 'uber_eats', kind: 'uber', body: unknownUberEvent('hook-test-2'), reference: 'hook-test-2' });
    const t0 = Date.now();
    const run = runInboxEntry(e.id);
    await new Promise((r) => setTimeout(r, 150));
    const mid = await getInboxEntry(e.id);
    expect(mid?.status).toBe('processing');
    expect(mid?.attempts).toBe(1);
    expect((await run)?.status).toBe('done');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(390);
  });
});
