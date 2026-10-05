// Internal secrets are created once, kept in the store, and never override a value set by the host.
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureGeneratedSecrets, GENERATED_SECRET_KEYS } from '../lib/foodhub/runtime-secrets';

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  for (const k of GENERATED_SECRET_KEYS) delete process.env[k];
});

describe('generated internal secrets', () => {
  it('creates the missing ones once and reloads the same values after a restart', async () => {
    process.env.CRON_SECRET = 'set-by-the-host';
    const first = await ensureGeneratedSecrets();
    expect(first.created).not.toContain('CRON_SECRET');
    expect(first.created).toContain('UBER_WEBHOOK_SIGNING_KEY');
    expect(process.env.CRON_SECRET).toBe('set-by-the-host');
    const uber = process.env.UBER_WEBHOOK_SIGNING_KEY;
    expect(uber).toMatch(/^[a-f0-9]{48}$/);
    for (const k of GENERATED_SECRET_KEYS) if (k !== 'CRON_SECRET') delete process.env[k];
    const second = await ensureGeneratedSecrets();
    expect(second.created).toEqual([]);
    expect(second.loaded).toContain('UBER_WEBHOOK_SIGNING_KEY');
    expect(process.env.UBER_WEBHOOK_SIGNING_KEY).toBe(uber);
  });
});
