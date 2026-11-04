import { afterEach, describe, expect, it, vi } from 'vitest';
import { missingScreenCounts, nextScreenNumber } from '@/lib/ui/screens-setup';
import { listScreens, setupScreens } from '@/lib/foodhub/screens';

afterEach(() => vi.unstubAllEnvs());

describe('extend an existing PC installation without duplicating accounts', () => {
  it('starts with 18 sessions per provider only on a new installation', () => {
    expect(missingScreenCounts([])).toEqual({ doordash: 18, ubereats: 18, skip: 18 });
    expect(nextScreenNumber([])).toBe(1);
  });
  it('extends the original 8 DoorDash/6 Uber/4 Skip manifest to 54 while preserving its first 18 profiles', () => {
    const screens = ['doordash', 'ubereats', 'skip'].flatMap((platform, i) => Array.from({ length: [8, 6, 4][i] }, () => ({ platform })));
    const existing = screens.map((s, i) => ({ ...s, id: `s${String(i + 1).padStart(2, '0')}` }));
    expect(missingScreenCounts(existing)).toEqual({ doordash: 10, ubereats: 12, skip: 14 });
    expect(nextScreenNumber(existing)).toBe(19);
    expect(existing).toHaveLength(18);
  });
  it('proposes no duplicate sessions when 18 of each are already present', () => {
    const screens = ['doordash', 'ubereats', 'skip'].flatMap((platform) => Array.from({ length: 18 }, () => ({ platform })));
    expect(missingScreenCounts(screens)).toEqual({ doordash: 0, ubereats: 0, skip: 0 });
    expect(missingScreenCounts([...screens, { platform: 'doordash' }, { platform: 'other' }])).toEqual({ doordash: 0, ubereats: 0, skip: 0 });
  });
  it('never recycles an existing slot and reports a full numbered range beyond the allowed maximum', () => {
    expect(nextScreenNumber([{ id: 's01' }, { id: 's03' }, { id: 'custom-screen' }])).toBe(4);
    expect(nextScreenNumber([{ id: 's99' }])).toBe(100);
  });
  it('appends the missing accounts through the real setup service while leaving existing records untouched', async () => {
    vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
    vi.stubEnv('FOODHUB_SCREENS_VIEW_HOSTS', 'screens.example.test');
    (globalThis as typeof globalThis & { __foodhubMem?: unknown }).__foodhubMem = undefined;
    const actor = { username: 'test', name: 'Synthetic owner', source: 'dashboard' as const };
    const input = { baseUrl: 'https://screens.example.test/', locationCode: 'SYNTHETIC' };
    const first = await setupScreens({ ...input, counts: { doordash: 8, ubereats: 6, skip: 4 } }, actor);
    expect(first).toHaveProperty('created.length', 18);
    const before = await listScreens();
    const extended = await setupScreens({ ...input, start: nextScreenNumber(before), counts: missingScreenCounts(before) }, actor);
    expect(extended).toHaveProperty('created.length', 36);
    const all = await listScreens();
    expect(all).toHaveLength(54);
    for (const platform of ['doordash', 'ubereats', 'skip']) expect(all.filter((s) => s.platform === platform)).toHaveLength(18);
    expect(all.filter((s) => before.some((old) => old.id === s.id))).toEqual(before);
  });
});
