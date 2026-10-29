// Relay kit generator (deploy/screens/generate-lib.mjs): one list of screens → one compose file. Pure functions:
// the list is validated (sign-in secrets refused), ports and profile folders are unique, Android screens sit in their
// own compose profile, and the output is deterministic and parseable YAML.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// js-yaml ships with the toolchain (eslint); only used to read the generated file back.
// @ts-expect-error no bundled types
import yaml from 'js-yaml';
// @ts-expect-error plain ESM module without types
import { buildCompose, envTemplate, envVarFor, generate, serviceName, toYaml, validateScreens } from '../deploy/screens/generate-lib.mjs';

const example = () => JSON.parse(readFileSync(path.join(__dirname, '../deploy/screens/screens.example.json'), 'utf8'));

describe('validateScreens', () => {
  it('accepts the example list and fills the platform defaults', () => {
    const r = validateScreens(example());
    expect('errors' in r).toBe(false);
    expect(r.screens).toHaveLength(4);
    expect(r.screens[3]).toMatchObject({ mode: 'android', package: 'com.dd.ddmerchant', startUrl: null });
    expect(r.screens[0]).toMatchObject({ mode: 'web', startUrl: 'https://merchants.ubereats.com/manager/orders' });
  });

  it('refuses any entry that carries a user name, password, token or code', () => {
    const base = { id: 'uber-1', platform: 'uber', name: 'Uber 1' };
    for (const extra of [
      { password: 'x' }, { pass: 'x' }, { token: 'abc' }, { username: 'a@b.c' }, { email: 'a@b.c' }, { phone: '5145550000' },
      { otp: '123456' }, { smsCode: '123456' }, { apiKey: 'k' }, { name: 'Uber 1 password=abc' },
      { startUrl: 'https://u:p@merchants.ubereats.com/manager/orders' },
      { name: 'x'.repeat(70) },
    ]) {
      const r = validateScreens({ screens: [{ ...base, ...extra }] });
      expect('errors' in r, JSON.stringify(extra)).toBe(true);
    }
  });

  it('refuses duplicates, unknown platforms, bad ids, http addresses and mode mix-ups', () => {
    const errs = (list: unknown[]) => { const r = validateScreens({ screens: list }); return 'errors' in r ? r.errors.join('\n') : ''; };
    expect(errs([{ id: 'a-1', platform: 'uber', name: 'A' }, { id: 'A-1', platform: 'uber', name: 'B' }])).toMatch(/used twice/);
    expect(errs([{ id: 'a-1', platform: 'uber', name: 'A' }, { id: 'a-2', platform: 'uber', name: 'a' }])).toMatch(/name "a" is used twice/);
    expect(errs([{ id: 'a-1', platform: 'grubhub', name: 'A' }])).toMatch(/platform must be one of uber, doordash, skip/);
    expect(errs([{ id: '1bad', platform: 'uber', name: 'A' }])).toMatch(/id must be/);
    expect(errs([{ id: 'a-1', platform: 'uber', name: 'A', startUrl: 'http://merchants.ubereats.com/' }])).toMatch(/https/);
    expect(errs([{ id: 'a-1', platform: 'uber', name: 'A', mode: 'android', startUrl: 'https://x.y/' }])).toMatch(/only for mode web/);
    expect(errs([{ id: 'a-1', platform: 'uber', name: 'A', mode: 'web', package: 'com.x.y' }])).toMatch(/only for mode android/);
    expect(errs([{ id: 'a-1', platform: 'uber', name: 'A', mode: 'android', package: 'not a package' }])).toMatch(/package must be/);
    expect(errs([{ id: 'a-1', platform: 'uber', name: 'A', colour: 'red' }])).toMatch(/unknown field/);
    expect(errs([])).toMatch(/empty/);
    expect('errors' in validateScreens('nope')).toBe(true);
    expect('errors' in validateScreens({ screens: Array.from({ length: 100 }, (_, i) => ({ id: `s-${i}`, platform: 'uber', name: `S ${i}` })) })).toBe(true);
  });
});

describe('buildCompose', () => {
  const screens = (validateScreens(example()) as { screens: any[] }).screens;
  const doc = buildCompose(screens);

  it('creates one browser + one agent per screen, agents sharing the browser network, and one gateway for the web screens', () => {
    expect(Object.keys(doc.services)).toEqual(['uber-1', 'uber-1-agent', 'doordash-1', 'doordash-1-agent', 'skip-1', 'skip-1-agent', 'doordash-2', 'doordash-2-agent', 'gateway']);
    expect(doc.services.gateway.environment).toMatchObject({ SCREENS: 'uber-1,doordash-1,skip-1', FOODHUB_ORIGIN: '${FOODHUB_ORIGIN}' });
    expect(doc.counts).toEqual({ web: 3, android: 1 });
    for (const name of ['uber-1', 'doordash-1', 'skip-1', 'doordash-2']) expect(doc.services[`${name}-agent`].network_mode).toBe(`service:${name}`);
  });

  it('gives every screen a unique host port and a unique profile folder', () => {
    const ports = Object.values(doc.services).flatMap((s: any) => s.ports ?? []);
    expect(ports).toEqual(['127.0.0.1:3101:3001', '127.0.0.1:3102:3001', '127.0.0.1:3103:3001', '127.0.0.1:6081:8554', '127.0.0.1:3100:8080']);
    const volumes = Object.values(doc.services).flatMap((s: any) => s.volumes ?? []);
    expect(new Set(volumes).size).toBe(volumes.length);
    expect(ports.every((p: string) => p.startsWith('127.0.0.1:'))).toBe(true); // never exposed directly
  });

  it('reads secrets and ids from .env only, never from the list', () => {
    const text = JSON.stringify(doc);
    expect(text).toContain('${FOODHUB_SCREENS_AGENT_TOKEN}');
    expect(text).toContain('${SCREENS_VIEW_PASSWORD}');
    expect(doc.services['uber-1-agent'].environment.SCREEN_ID).toBe('${SCREEN_ID_UBER_1}');
    expect(doc.services['doordash-2-agent'].environment.SCREEN_ID).toBe('${SCREEN_ID_DOORDASH_2}');
    expect(doc.services['uber-1'].environment.CHROME_CLI).toBe('--remote-debugging-port=9222 https://merchants.ubereats.com/manager/orders');
  });

  it('puts Android screens in the "android" profile: Play Store image, KVM only (never privileged), named data volume, shared adb key', () => {
    const a = doc.services['doordash-2'];
    expect(a.profiles).toEqual(['android']);
    expect(a.image).toBe('foodhub/android-playstore:33');
    expect(a.devices).toEqual(['/dev/kvm:/dev/kvm']);
    expect(a.privileged).toBeUndefined();
    expect(a.environment).toEqual(['ADBKEY', 'TZ=America/Toronto']); // the private adb key comes from the shell, never from a file in git
    expect(a.volumes).toEqual(['doordash-2-data:/data']);
    expect(doc.volumes).toEqual({ 'doordash-2-data': {} });
    expect(JSON.stringify(a)).not.toMatch(/PASSWORD/);
    const ag = doc.services['doordash-2-agent'];
    expect(ag.profiles).toEqual(['android']);
    expect(ag.environment).toMatchObject({ ANDROID_PACKAGE: 'com.dd.ddmerchant', ADB_HOST: '127.0.0.1' });
    expect(ag.environment.SCREEN_START_URL).toBeUndefined();
    expect(ag.volumes).toEqual(['./adbkey:/home/node/.android/adbkey:ro']);
    expect(doc.services['uber-1'].profiles).toBeUndefined();
    for (const s of Object.values(doc.services) as any[]) expect(s.privileged).toBeUndefined();
  });

  it('takes another Android image name from the options', () => {
    expect(buildCompose(screens, { androidImage: 'foodhub/android-playstore:34' }).services['doordash-2'].image).toBe('foodhub/android-playstore:34');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildCompose(screens))).toBe(JSON.stringify(doc));
  });
});

describe('toYaml / generate', () => {
  it('writes YAML that parses back to the same document and keeps ${…} references literal', () => {
    const r = generate(example(), { source: 'screens.example.json' });
    expect('errors' in r).toBe(false);
    const parsed = yaml.load(r.yaml);
    expect(parsed.services).toEqual(buildCompose(r.screens).services);
    expect(r.yaml).toContain('FOODHUB_SCREENS_AGENT_TOKEN: "${FOODHUB_SCREENS_AGENT_TOKEN}"'); // quoted so compose expands it
    expect(r.yaml.startsWith('# Generated by deploy/screens/generate.mjs from screens.example.json')).toBe(true);
    expect(r.yaml).toContain('doordash-2 = DoorDash "DoorDash 2 (app)" (android) → .env SCREEN_ID_DOORDASH_2');
    expect(parsed.volumes).toEqual({ 'doordash-2-data': null }); // an empty mapping is written as "doordash-2-data:" and reads back as null
  });

  it('matches the committed docker-compose.yml service shape of the hand-written kit', () => {
    const committed = yaml.load(readFileSync(path.join(__dirname, '../deploy/screens/docker-compose.yml'), 'utf8'));
    const r = generate({ screens: [{ id: 'uber-1', platform: 'uber', name: 'Uber Eats 1' }, { id: 'doordash-1', platform: 'doordash', name: 'DoorDash 1' }] });
    const gen = yaml.load((r as any).yaml);
    for (const name of ['uber-1', 'doordash-1']) {
      expect(gen.services[name]).toMatchObject({ image: committed.services[name].image, environment: committed.services[name].environment, volumes: committed.services[name].volumes, ports: committed.services[name].ports });
      expect(gen.services[`${name}-agent`]).toMatchObject({ build: './agent', network_mode: `service:${name}`, environment: committed.services[`${name}-agent`].environment });
    }
  });

  it('returns the refusal reasons instead of a file', () => {
    const r = generate({ screens: [{ id: 'u', platform: 'uber', name: 'U', password: 'x' }] });
    expect(r).toHaveProperty('errors');
    expect((r as any).yaml).toBeUndefined();
  });

  it('names the .env variables for every screen, with no values', () => {
    const env = envTemplate((validateScreens(example()) as any).screens);
    expect(env).toContain('SCREEN_ID_UBER_1=\n');
    expect(env).toContain('SCREEN_ID_DOORDASH_2=\n');
    expect(env).not.toMatch(/SCREEN_ID_[A-Z0-9_]+=\S/); // names only, never a value
    expect(serviceName('SCREEN_ID_UBER_1')).toBe('uber-1');
    expect(envVarFor('doordash-2')).toBe('SCREEN_ID_DOORDASH_2');
    expect(envVarFor('SCREEN_ID_SKIP_1')).toBe('SCREEN_ID_SKIP_1');
  });

  it('serializes the hand-written file without changing it when round-tripped', () => {
    const committed = readFileSync(path.join(__dirname, '../deploy/screens/docker-compose.yml'), 'utf8');
    const doc = yaml.load(committed);
    // Anchors/aliases are resolved by the parser; our writer never needs them: the document still round-trips.
    expect(yaml.load(toYaml({ services: doc.services, counts: { web: 2, android: 0 } })).services).toEqual(doc.services);
    expect(toYaml({ services: doc.services, counts: { web: 2, android: 0 } })).not.toMatch(/^volumes:/m); // no top-level section when there is nothing to declare (services keep their own volumes:)
  });
});
