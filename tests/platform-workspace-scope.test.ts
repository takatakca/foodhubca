import { describe, expect, it } from 'vitest';
import { alarmLocations, filterByScope, parseScope, resolveScope, scopeHref, validScope, WORKSPACE_CHANNELS, type ScopeCatalog } from '@/lib/foodhub/scope';

const catalog: ScopeCatalog = {
  kitchens: ['kitchen-a'], brands: ['Brand A'], brandsByKitchen: { 'kitchen-a': ['Brand A'] },
  channels: ['doordash'], stores: [{ locationCode: 'kitchen-a', brandName: 'Brand A', channel: 'doordash' }],
  workspaceChannels: WORKSPACE_CHANNELS,
};

describe('provider workspaces before API onboarding', () => {
  it.each(WORKSPACE_CHANNELS)('keeps %s selectable without claiming a mapped store', (channel) => {
    const scope = parseScope(`?kitchen=kitchen-a&brand=Brand+A&channel=${channel}`, catalog);
    expect(scope).toEqual({ kitchen: 'kitchen-a', brand: 'Brand A', channel });
    expect(scopeHref('/stores/screens', scope)).toBe(`/stores/screens?kitchen=kitchen-a&brand=Brand+A&channel=${channel}`);
    expect(filterByScope(catalog.stores!, scope)).toHaveLength(channel === 'doordash' ? 1 : 0);
    expect(alarmLocations(scope)).toEqual(['kitchen-a']);
  });

  it('validates location, brand and unknown platform independently of workspace access', () => {
    expect(validScope({ kitchen: 'outside', brand: 'Other tenant', channel: 'skip' }, catalog))
      .toEqual({ kitchen: null, brand: null, channel: 'skip' });
    expect(validScope({ channel: 'https://fake.example' }, { ...catalog, workspaceChannels: ['https://fake.example'] }))
      .toEqual({ kitchen: null, brand: null });
    expect(validScope({ channel: 'tgtg' }, { ...catalog, workspaceChannels: ['tgtg'] }))
      .toEqual({ kitchen: null, brand: null });
  });

  it('preserves the mapped-store requirement for consumers that do not enable workspaces', () => {
    expect(validScope({ channel: 'skip' }, { ...catalog, workspaceChannels: undefined }))
      .toEqual({ kitchen: null, brand: null });
  });

  it('restores a manual-only workspace from its URL and remembered scope', () => {
    const scope = { kitchen: 'kitchen-a', brand: null, channel: 'skip' };
    expect(resolveScope({ url: scope, catalog })).toEqual({ scope, writeUrl: false });
    expect(resolveScope({ url: { kitchen: null, brand: null }, remembered: scope, catalog })).toEqual({ scope, writeUrl: true });
  });

  it('never narrows a dedicated kitchen device to one provider', () => {
    for (const channel of WORKSPACE_CHANNELS) {
      expect(resolveScope({ url: { kitchen: 'kitchen-a', brand: null, channel }, deviceKitchen: 'kitchen-a', catalog }).scope)
        .toEqual({ kitchen: 'kitchen-a', brand: null });
    }
  });
});
