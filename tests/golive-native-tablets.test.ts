import { expect, it } from 'vitest';
import { goLiveKitchenCoverage, nativeTabletGoLiveStep } from '../app/(console)/settings/go-live/steps';

const en = (_fr: string, english: string) => english;
const locName = (code: string) => code;
const active = { code: 'ACTIVE', name: 'Active kitchen', active: true };
const retired = { code: 'RETIRED', name: 'Retired kitchen', active: false };
const foreign = { code: 'FOREIGN', name: 'Other kitchen', active: true };

it('counts active kitchen coverage once even with a retired or redundant tablet offline', () => {
  const { activeLocations } = goLiveKitchenCoverage(null, [active, retired, foreign], [active, retired]);
  const row = nativeTabletGoLiveStep(activeLocations, [
    { locationCode: active.code, status: 'online' },
    { locationCode: active.code, status: 'offline' },
    { locationCode: retired.code, status: 'offline' },
    { locationCode: foreign.code, status: 'offline' },
  ], en, locName);
  expect(row).toMatchObject({ state: 'done', body: 'Every active kitchen has a tablet online.' });
});

it('shows the empty active scope explicitly even with a previously enrolled tablet', () => {
  const { activeLocations } = goLiveKitchenCoverage(null, [active, retired], [retired]);
  const row = nativeTabletGoLiveStep(activeLocations, [{ locationCode: retired.code, status: 'online' }], en, locName);
  expect(row).toMatchObject({ state: 'warn', body: 'No active kitchens in your scope.', href: '/settings/business' });
});

it('keeps an active kitchen without an online tablet visible despite another kitchen’s online tablet', () => {
  const { activeLocations } = goLiveKitchenCoverage(null, [active, foreign], [active]);
  const row = nativeTabletGoLiveStep(activeLocations, [
    { locationCode: active.code, status: 'offline' },
    { locationCode: active.code, status: 'never' },
    { locationCode: foreign.code, status: 'online' },
  ], en, locName);
  expect(row).toMatchObject({ state: 'warn', body: 'No tablet online for ACTIVE.', href: '/settings/devices' });
});

it('still requires pairing for each active kitchen and ignores a revoked tablet', () => {
  const row = nativeTabletGoLiveStep(new Set([active.code, foreign.code]), [
    { locationCode: active.code, status: 'revoked' },
    { locationCode: foreign.code, status: 'online' },
  ], en, locName);
  expect(row).toMatchObject({ state: 'todo', body: 'Pair a tablet for ACTIVE.', href: '/settings/devices' });
});
