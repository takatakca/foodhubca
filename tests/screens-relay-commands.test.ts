// Relay agents and Food Hub meet on contract v2.1 (docs/ORDER_SCREENS_RESCUE.md): the open command, numbered screens.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module without types
import { ALLOWED_HOSTS, ORDER_APPS, allowedUrl, commandsFor, packageForUrl } from '../deploy/screens/agent/commands.mjs';
// @ts-expect-error plain ESM module without types
import { buildCompose, envTemplate, generate, pickRange, PLATFORMS, validateScreens } from '../deploy/screens/generate-lib.mjs';
import { allowedScreenUrl, SCREEN_ALLOWED_HOSTS, screenStartUrl } from '../lib/foodhub/screens';

describe('open command: the agents accept exactly what Food Hub sends', () => {
  it('same allowed sites as Food Hub', () => {
    expect([...ALLOWED_HOSTS]).toEqual([...SCREEN_ALLOWED_HOSTS]);
    for (const url of ['https://order.doordash.com/', 'https://merchants.ubereats.com/manager/orders', 'https://restaurants.skipthedishes.com/',
      'http://order.doordash.com/', 'https://doordash.com.evil.example/', 'https://u:p@order.doordash.com/', 'javascript:alert(1)', '', null]) {
      expect(allowedUrl(url)).toBe(allowedScreenUrl(url as string));
    }
    for (const p of ['doordash', 'ubereats', 'skip'] as const) expect(allowedUrl(screenStartUrl(p, {}))).toBe(true);
  });

  it('keeps only this screen\'s commands, in order; refuses an open to anything else', () => {
    const body = { commands: [
      { id: 's01', kind: 'open', url: 'https://order.doordash.com/' },
      { id: 's02', kind: 'reload' },
      { id: 's01', kind: 'reload' },
      { id: 's01', kind: 'open', url: 'https://evil.example/login' },
      { id: 's01', kind: 'tap', x: 1 },
    ] };
    expect(commandsFor(body, 's01')).toEqual([
      { kind: 'open', url: 'https://order.doordash.com/' },
      { kind: 'reload' },
      { kind: 'refused', reason: 'open refused (not a platform address): https://evil.example/login' },
      { kind: 'refused', reason: 'unknown command: tap' },
    ]);
    expect(commandsFor({}, 's01')).toEqual([]);
    expect(commandsFor(null, 's01')).toEqual([]);
  });

  it('Android: open launches that platform\'s order app (same names as the generator)', () => {
    expect(packageForUrl('https://order.doordash.com/')).toBe(PLATFORMS.doordash.package);
    expect(packageForUrl('https://merchants.ubereats.com/manager/orders')).toBe(PLATFORMS.uber.package);
    expect(packageForUrl('https://restaurants.skipthedishes.com/')).toBe(PLATFORMS.skip.package);
    expect(packageForUrl('https://evil.example/')).toBeNull();
    expect(new Set(Object.values(ORDER_APPS))).toEqual(new Set([PLATFORMS.doordash.package, PLATFORMS.uber.package, PLATFORMS.skip.package]));
  });
});

describe('Food Hub\'s 18 numbered screens on the relay host', () => {
  const list = JSON.parse(readFileSync(path.join(__dirname, '../deploy/screens/screens.18.example.json'), 'utf8'));

  it('s01–s08 DoorDash, s09–s14 Uber Eats, s15–s18 Skip; s01 → 127.0.0.1:3101 … s18 → 3118; SCREEN_ID is the slot id', () => {
    const v = validateScreens(list);
    expect(v.errors).toBeUndefined();
    expect(v.screens.map((s: { id: string }) => s.id)).toEqual(Array.from({ length: 18 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`));
    expect(v.screens.map((s: { platform: string }) => s.platform).join(',')).toBe(`${'doordash,'.repeat(8)}${'uber,'.repeat(6)}${'skip,'.repeat(4)}`.slice(0, -1));
    const doc = buildCompose(v.screens);
    expect(doc.services.s01.ports).toEqual(['127.0.0.1:3101:3001']);
    expect(doc.services.s18.ports).toEqual(['127.0.0.1:3118:3001']);
    expect(doc.services['s01-agent'].environment.SCREEN_ID).toBe('s01');
    expect(doc.services['s15-agent'].environment.SCREEN_START_URL).toBe('https://restaurants.skipthedishes.com/');
    expect(doc.services.s07.environment.SUBFOLDER).toBe('/s07/'); // Food Hub's view address is <relay>/s07/
    expect(doc.counts).toEqual({ web: 18, android: 0 });
  });

  it('the .env template asks for no screen id when every screen is numbered; mixed lists still list the others', () => {
    const env = envTemplate(validateScreens(list).screens);
    expect(env).not.toMatch(/SCREEN_ID_/);
    expect(env).toContain('Numbered screens (s01, s02…) use their own id');
    const r = generate({ screens: [...list.screens.slice(0, 2), { id: 'uber-extra', platform: 'uber', name: 'Uber extra', mode: 'web' }] }, { source: 'mixed.json' });
    expect(r.env).toContain('SCREEN_ID_UBER_EXTRA=\n');
    expect(r.yaml).toContain('s01 = DoorDash "DoorDash 1" (web) → Food Hub screen s01');
    expect(r.yaml).toContain('SCREEN_ID: s01');
    expect(r.yaml).toContain('SCREEN_ID: "${SCREEN_ID_UBER_EXTRA}"');
  });
});

describe('54 screens over one or several relay hosts', () => {
  const list54 = JSON.parse(readFileSync(path.join(__dirname, '../deploy/screens/screens.54.example.json'), 'utf8'));

  it('the 54-screen list is valid: 18 per channel, ids s01–s54, ports keep the screen number', () => {
    const v = validateScreens(list54);
    expect(v.errors).toBeUndefined();
    expect(v.screens).toHaveLength(54);
    for (const p of ['doordash', 'uber', 'skip']) expect(v.screens.filter((s: { platform: string }) => s.platform === p)).toHaveLength(18);
    const doc = buildCompose(v.screens);
    expect(doc.services.s54.ports).toEqual(['127.0.0.1:3154:3001']);
    expect(doc.services.gateway.environment.SCREENS.split(',')).toHaveLength(54);
  });

  it('--only gives one host its share, with the same ports and ids', () => {
    const share = pickRange(list54, 's19-s36');
    const v = validateScreens(share);
    expect(v.screens.map((s: { id: string }) => s.id)).toEqual(Array.from({ length: 18 }, (_, i) => `s${i + 19}`));
    const doc = buildCompose(v.screens);
    expect(doc.services.s19.ports).toEqual(['127.0.0.1:3119:3001']);
    expect(doc.services['s19-agent'].environment.SCREEN_ID).toBe('s19');
    expect(pickRange(list54, '')).toBe(list54);
    expect(pickRange(list54, 's36-s19')).toBeNull();
    expect(pickRange(list54, 'all')).toBeNull();
  });
});
