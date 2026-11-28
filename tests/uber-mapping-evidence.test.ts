import { isValidElement } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MappingView } from '../app/(console)/stores/mapping/mapping-view';
import type { ChannelStore } from '../lib/foodhub/types';

const slots: unknown[] = [];
let cursor = 0;
const effects: Array<() => void> = [];
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  function state<S>(initial: S | (() => S)) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? (initial as () => S)() : initial;
    return [slots[i] as S, (value: S | ((old: S) => S)) => {
      slots[i] = typeof value === 'function' ? (value as (old: S) => S)(slots[i] as S) : value;
    }] as const;
  }
  return {
    ...react, useState: state, useRef: <S,>(current: S) => state(() => ({ current }))[0],
    useEffect: (effect: () => void) => effects.push(effect), useCallback: <F,>(fn: F) => fn,
  };
});
const fixtures = vi.hoisted(() => ({
  api: vi.fn(), params: new URLSearchParams(),
  toast: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => fixtures.params }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => fixtures.toast }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/components/billing/extra-brand-price', () => ({ useExtraBrandPriceConfirm: () => undefined }));
vi.mock('@/components/shell/viewer', () => ({
  useViewer: () => ({ locations: [], brands: [], locName: () => 'Fixture kitchen' }),
  shortLoc: (name: string) => name,
}));
vi.mock('@/lib/i18n/client', () => ({ useI18n: () => ({ t: (_fr: string, en: string) => en }) }));
vi.mock('@/lib/ui/api', () => ({ api: fixtures.api }));

const FIRST = 'fixture-uber-first';
const REPLACEMENT = 'fixture-uber-replacement';
const mapping: ChannelStore = {
  id: 'fixture-link', channel: 'uber_eats', channelStoreId: FIRST, brandName: 'Fixture brand',
  locationCode: 'FIXTURE', cloverMerchantId: null, autoAccept: false, online: true,
  meta: {},
};
const observation = { storeId: mapping.id, channelStoreId: FIRST, ok: true, orderManager: 'foodhub', integrationEnabled: true, message: 'Fixture result' };
let stores: ChannelStore[];
let response: Array<typeof observation>;

function render(mount = false) {
  cursor = 0;
  effects.length = 0;
  const tree = MappingView();
  if (mount) for (const effect of effects) effect();
  return tree;
}

function elements(node: unknown): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Object.values(node.props).flatMap(elements)];
}

function button(label: string) {
  return elements(render()).find(({ props }) => props.children === label && typeof props.onClick === 'function')?.props.onClick as (() => Promise<void>) | undefined;
}

function webhooks() {
  return elements(render()).filter(({ type }) => typeof type === 'function' && type.name === 'WebhooksBadge')
    .map(({ props }) => props.enabled);
}

beforeEach(() => {
  slots.length = 0;
  fixtures.params.delete('uber_connect');
  fixtures.api.mockReset();
  stores = [mapping];
  response = [observation];
  fixtures.api.mockImplementation(async (path: string) => {
    if (path === '/api/foodhub/stores' || path === '/api/foodhub/stores/known') return { stores: path.endsWith('/known') ? [] : stores };
    if (path === '/api/foodhub/uber-connect/check') return { rows: response };
    if (path.startsWith('/api/foodhub/uber-connect/session?')) return { stores: [{ id: FIRST, name: 'Fixture store', orderManager: 'foodhub' }] };
    if (path === '/api/foodhub/uber-connect/disconnect') {
      // The late mapping can still have a saved observation, including the older shape without a provider ID.
      stores = [{ ...mapping, meta: { uberPos: { orderManager: 'foodhub', integrationEnabled: true } } }];
      return { ok: true, mappingConflict: true };
    }
    throw new Error('Unexpected fixture request');
  });
});

it.each([true, false])('ignores the old check and enable action after the same local row maps to another Uber store (was enabled: %s)', async (enabled) => {
  response = [{ ...observation, integrationEnabled: enabled }];
  render(true);
  await Promise.resolve();
  await button('Check with Uber')!();
  expect(webhooks()).toEqual([enabled]);
  expect(Boolean(button('Switch Uber orders on'))).toBe(!enabled);

  // The check began against the old mapping and the refresh returns a replacement at the same local ID.
  stores = [{ ...mapping, channelStoreId: REPLACEMENT }];
  await button('Check with Uber')!();
  expect.soft(webhooks()).toEqual([undefined]);
  expect(button('Switch Uber orders on')).toBeUndefined();
});

it('keeps a mapping first seen after disconnect unconfirmed until another explicit successful check', async () => {
  stores = [];
  fixtures.params.set('uber_connect', 'fixture-session');
  render(true);
  await Promise.resolve();
  await button('Disconnect from Uber')!();
  expect(webhooks()).toEqual([null]);

  response = [];
  await button('Check with Uber')!();
  expect(webhooks()).toEqual([null]);
  response = [{ ...observation, storeId: 'fixture-former-link' }];
  await button('Check with Uber')!();
  expect(webhooks()).toEqual([null]);
  response = [{ ...observation, ok: false }];
  await button('Check with Uber')!();
  expect(webhooks()).toEqual([null]);

  response = [observation];
  await button('Check with Uber')!();
  expect(webhooks()).toEqual([true]);
});
