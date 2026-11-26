import { expect, it } from 'vitest';
import { goLiveKitchenCoverage, goLiveProgress, relayGoLiveSteps, type RelayGoLiveInput } from '../app/(console)/settings/go-live/steps';

const en = (_fr: string, english: string) => english;
const locName = (code: string) => code;
const active = { enabled: true, escalate: true };
const watch = { enabled: true, sharedPhoneConfigured: false, callConfigured: true, rules: { screen_down: active, screen_waiting: active } };
const ndg = { code: 'NDG', name: 'Notre-Dame-de-Grâce', active: true };
const screen = (locationCode: string): NonNullable<RelayGoLiveInput['relay']>['screens'][number] => ({ platform: 'doordash', locationCode, status: 'online' });

it('offers a phone setup action when there is no relay screen or usable destination', () => {
  const [screens, calls] = relayGoLiveSteps({ relay: { agentConfigured: true, screens: [] }, watch, kitchenPhoneLocations: [] }, en, locName);
  expect(screens).toMatchObject({ state: 'warn', optional: true, href: '/stores/screens' });
  expect(calls).toMatchObject({ state: 'warn', optional: true, href: '/settings/business', cta: 'Phones' });
  expect(calls.body).toContain('No usable kitchen phone');
  expect(calls.body).toContain('shared number in Alerts');
  expect(goLiveProgress([{ state: 'done' }, screens, calls])).toMatchObject({ percent: 100, todo: 0 });
});

it('excludes inactive and out-of-scope kitchens and flags an unusable legacy phone for an enrolled screen', () => {
  const inactive = { code: 'OLD', name: 'Inactive', active: false, phone: '+15145550124' };
  const foreign = { code: 'OTHER', name: 'Other', active: true, phone: '+15145550125' };
  const legacy = { ...ndg, phone: 'broken legacy value' };
  const coverage = goLiveKitchenCoverage(
    { agentConfigured: true, screens: [screen(ndg.code), screen(inactive.code), screen(foreign.code)] },
    [legacy, inactive, foreign],
    [ndg, inactive],
  );
  expect(coverage).toEqual({
    relay: { agentConfigured: true, screens: [screen(ndg.code)] },
    activeLocations: new Set([ndg.code]),
    kitchenCount: 1,
    kitchenPhoneLocations: [],
    missingPhoneLocations: [{ code: ndg.code, name: ndg.name }],
  });
  const [screens, calls] = relayGoLiveSteps({ ...coverage, watch }, en, locName);
  expect(screens).toMatchObject({ state: 'done', body: '1 of 1 online. DoorDash 1/1' });
  expect(calls).toMatchObject({ state: 'warn', optional: true, href: '/settings/business', body: 'Add a kitchen phone for NDG.' });
});

it('counts a phone that can be normalized and keeps an unused relay optional', () => {
  const kitchen = { ...ndg, phone: '(514) 555-0123' };
  const coverage = goLiveKitchenCoverage({ agentConfigured: true, screens: [screen(ndg.code)] }, [kitchen], [ndg]);
  expect(coverage.kitchenPhoneLocations).toEqual([ndg.code]);
  expect(coverage.missingPhoneLocations).toEqual([]);
  expect(relayGoLiveSteps({ ...coverage, watch }, en, locName)[1]).toMatchObject({ state: 'done', optional: true });

  const relay = { agentConfigured: true, screens: [] };
  const [screens, calls] = relayGoLiveSteps({ ...coverage, relay, watch }, en, locName);
  expect(calls).toMatchObject({ state: 'warn', optional: true, href: '/stores/screens' });
  expect(calls.body).toContain('The planned destination is each kitchen’s phone.');
  expect(goLiveProgress([{ state: 'done' }, screens, calls])).toMatchObject({ percent: 100, todo: 0 });
});
