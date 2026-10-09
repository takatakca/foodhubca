// Menus flow from Clover: the import (inventory, or one of the merchant's Clover menus with its platform prices,
// archived items left out, option groups with min / max / required) and the publish dry run (what each store would
// receive and what changes — nothing sent).
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uberEatsAdapter } from '../lib/foodhub/adapters/uber-eats';
import { buildMenuFromClover, detectMarkupPct, parseCloverMenuItem, platformOfCloverMenu } from '../lib/foodhub/menu/clover-import';
import { previewPublish } from '../lib/foodhub/menu/preview';
import { publishMenu } from '../lib/foodhub/ops';
import { getRepo } from '../lib/foodhub/repo';

const cat = (id: string, name: string, sortOrder = 0) => ({ id, name, sortOrder });
const rawItems = [
  { id: 'I-POUTINE', name: 'POUTINE MOYENNE', onlineName: 'Poutine moyenne', price: 999, categories: { elements: [cat('C-POUT', 'Poutines', 2)] }, modifierGroups: { elements: [{ id: 'G-SAUCE' }, { id: 'G-GONE' }] } },
  { id: 'I-WINGS', name: '10 ailes', price: 1699, categories: { elements: [cat('C-AILES', 'Ailes', 1)] }, modifierGroups: { elements: [{ id: 'G-DRINK' }] } },
  { id: 'I-CHOU', name: 'Salade de chou', price: 271, categories: { elements: [cat('C-AILES', 'Ailes', 1)] }, modifierGroups: { elements: [] } },
  { id: 'I-PITA', name: 'Pita mixte', price: 849, categories: { elements: [cat('C-PITA', 'Pitas', 3)] }, modifierGroups: { elements: [] } },
  { id: 'I-OLD', name: 'Old wings', price: 1599, categories: { elements: [cat('C-ARCH', 'ARCHIVE · Ailes')] } },
  { id: 'I-TRIO', name: 'TRIO', price: 1999, categories: { elements: [cat('C-ARCH', 'ARCHIVE · Ailes'), cat('C-AILES', 'Ailes', 1)] } },
  { id: 'I-EMP', name: '(EM) Lasagne', price: 500, hidden: true, categories: { elements: [cat('C-EMP', 'Menu Employés')] } },
  { id: 'I-VAR', name: 'Poulet au poids', price: 0, priceType: 'PER_UNIT', categories: { elements: [cat('C-AILES', 'Ailes', 1)] } },
];
const rawGroups = [
  { id: 'G-SAUCE', name: 'Sauce', minRequired: 0, maxAllowed: 0, modifiers: { elements: [{ id: 'M-BBQ', name: 'BBQ', price: 50 }, { id: 'M-MIEL', name: 'Miel ail', price: 50 }, { id: 'M-OFF', name: 'Truffe', price: 200, available: false }] } },
  { id: 'G-DRINK', name: 'Boisson incluse', minRequired: 1, maxAllowed: 1, modifiers: { elements: [{ id: 'M-PEPSI', name: 'Pepsi', price: 0 }] } },
  { id: 'G-UNUSED', name: 'ARCHIVE · Choix', minRequired: 1, maxAllowed: 1, modifiers: { elements: [{ id: 'M-X', name: 'X', price: 0 }] } },
];

describe('Clover → master menu', () => {
  it('inventory: hidden and archive-only items left out, option groups with min / max / required, variable prices unavailable', () => {
    const { menu, report } = buildMenuFromClover('Po Poulet', rawItems, rawGroups);
    expect(menu.items.map((i) => i.ref).sort()).toEqual(['I-CHOU', 'I-PITA', 'I-POUTINE', 'I-TRIO', 'I-VAR', 'I-WINGS']);
    expect(report.skipped).toMatchObject({ hidden: 1, archived: 1, variablePrice: 1 });
    expect(menu.items.find((i) => i.ref === 'I-TRIO')?.categoryRef).toBe('C-AILES');
    expect(menu.items.find((i) => i.ref === 'I-POUTINE')).toMatchObject({ name: 'Poutine moyenne', posItemRef: 'I-POUTINE', price: 9.99, modifierGroupRefs: ['G-SAUCE'] });
    expect(menu.items.find((i) => i.ref === 'I-VAR')).toMatchObject({ available: false, price: 0 });
    const sauce = menu.modifierGroups.find((g) => g.ref === 'G-SAUCE')!;
    expect(sauce).toMatchObject({ min: 0, max: 3 }); // no maximum in Clover = any of the 3
    expect(sauce.modifiers.find((m) => m.ref === 'M-OFF')?.available).toBe(false);
    expect(menu.modifierGroups.find((g) => g.ref === 'G-DRINK')).toMatchObject({ min: 1, max: 1 });
    expect(menu.modifierGroups.some((g) => g.ref === 'G-UNUSED')).toBe(false);
    expect(report).toMatchObject({ items: 6, modifierGroups: 2, requiredGroups: 1 });
    expect(menu.categories.map((c) => c.name)).toEqual(['Ailes', 'Poutines', 'Pitas']);
  });

  it('a Clover menu (DoorDash +20 %): only its items, its photos; prices become a +20 % markup with own prices only where they differ', () => {
    const menuItems = [
      { item: { id: 'I-POUTINE' }, price: 1199, image_filename: 'I-POUTINE.jpeg' },
      { itemId: 'I-WINGS', menuPrice: 2039 },
      { item: { id: 'I-CHOU' }, price: 325 },
      { item: { id: 'I-PITA' }, price: 1919 }, // the Uber/DoorDash typo: $19.19 instead of $10.19
      { item: { id: 'I-NOT-IN-INVENTORY' }, price: 100 },
    ].map(parseCloverMenuItem).filter((x) => x !== null);
    const { menu, report } = buildMenuFromClover('Po Poulet', rawItems, rawGroups, { menuItems, menuInfo: { id: 'MENU-DOORDASH', name: 'DoorDash (Po Poulet +20%)' }, platformPrices: ['doordash', 'uber_eats'] });
    expect(menu.items.map((i) => i.ref).sort()).toEqual(['I-CHOU', 'I-PITA', 'I-POUTINE', 'I-WINGS']);
    expect(report.skipped.notInMenu).toBe(2); // TRIO and the variable-price item
    expect(report.menu).toMatchObject({ name: 'DoorDash (Po Poulet +20%)', items: 5, missingFromInventory: 1 });
    expect(menu.channelMarkupPct).toEqual({ doordash: 20, uber_eats: 20 });
    expect(menu.items.find((i) => i.ref === 'I-PITA')?.channelPrices).toEqual({ doordash: 19.19, uber_eats: 19.19 });
    expect(menu.items.find((i) => i.ref === 'I-CHOU')?.channelPrices).toBeUndefined(); // 2.71 × 1.2 = 3.25
    expect(menu.items.find((i) => i.ref === 'I-POUTINE')?.imageUrl).toBe('https://cloverstatic.com/menu-assets/items/I-POUTINE.jpeg');
    expect(report.platformPrices?.doordash).toEqual({ markupPct: 20, overrides: 1, items: 4 });
  });

  it('markup detection needs most prices to agree; otherwise every item keeps its own price', () => {
    expect(detectMarkupPct([{ base: 10, platform: 12 }, { base: 2.71, platform: 3.25 }, { base: 13.99, platform: 16.79 }, { base: 8.49, platform: 19.19 }])).toBe(20);
    expect(detectMarkupPct([{ base: 10, platform: 13 }, { base: 5, platform: 5.5 }, { base: 8, platform: 11 }])).toBeNull();
    expect(platformOfCloverMenu({ name: 'DoorDash (Po Poulet +20%)' })).toBe('doordash');
    expect(platformOfCloverMenu({ name: 'Online menu', channel: 'Clover Online Ordering' })).toBeNull();
  });
});

// The owner's real Clover export (git-ignored, on the owner's computer only): skipped when it is not there.
const FIXTURE_DIRS = [path.resolve(__dirname, '../private/menu'), path.resolve(__dirname, '../../../../private/menu')];
const fixtureDir = FIXTURE_DIRS.find((d) => fs.existsSync(path.join(d, 'clover-items.json')) && fs.existsSync(path.join(d, 'clover-modifiers.json')));

describe.skipIf(!fixtureDir)('the real On2GO Clover menu (private fixture)', () => {
  it('imports the DoorDash +20 % menu: 175 items, +20 % detected, no archived item, every option group resolved', () => {
    const items = JSON.parse(fs.readFileSync(path.join(fixtureDir!, 'clover-items.json'), 'utf8'));
    const mods = JSON.parse(fs.readFileSync(path.join(fixtureDir!, 'clover-modifiers.json'), 'utf8'));
    const catId = (name: string) => `CAT-${name}`;
    const raw = items.items.map((it: any) => ({
      id: it.id, name: it.name, onlineName: it.onlineName, description: it.description, price: Math.round(Number(it.price) * 100), priceType: it.priceType, hidden: it.hidden, available: it.available,
      categories: { elements: (it.categories ?? []).map((c: string) => ({ id: catId(c), name: c })) },
      modifierGroups: { elements: (it.modifierGroups ?? []).map((g: { id: string }) => ({ id: g.id })) },
    }));
    const groups = mods.modifierGroups.map((g: any) => ({ id: g.id, name: g.name, minRequired: g.minRequired, maxAllowed: g.maxAllowed, modifiers: { elements: g.modifiers.map((m: any, i: number) => ({ id: `${g.id}-${i}`, name: m.name, price: Math.round(Number(m.price) * 100) })) } }));
    const ddMenu = items.items.filter((it: any) => it.menus?.doordashMenu).map((it: any) => ({ itemId: it.id, priceCents: Math.round(Number(it.menus.doordashMenuPrice) * 100) }));
    const { menu, report } = buildMenuFromClover('Po Poulet', raw, groups, { menuItems: ddMenu, menuInfo: { id: 'MENU-DOORDASH', name: 'DoorDash (Po Poulet +20%)' }, platformPrices: ['doordash'] });
    expect(menu.items.length).toBe(175);
    expect(menu.channelMarkupPct?.doordash).toBe(20);
    expect(report.platformPrices?.doordash?.overrides).toBeLessThan(10);
    expect(menu.categories.some((c) => /^archive/i.test(c.name))).toBe(false);
    const groupRefs = new Set(menu.modifierGroups.map((g) => g.ref));
    expect(menu.items.every((i) => i.modifierGroupRefs.every((r) => groupRefs.has(r)))).toBe(true);
    expect(menu.modifierGroups.every((g) => g.min <= g.max && g.modifiers.length > 0)).toBe(true);
    // The whole visible inventory (no Clover menu chosen): about 200 items — employee meals included, archive left out.
    const all = buildMenuFromClover('Po Poulet', raw, groups);
    expect(all.menu.items.length).toBeGreaterThan(195);
    expect(all.menu.items.length).toBeLessThan(215);
  });
});

describe('publish dry run', () => {
  beforeEach(async () => {
    process.env.FOODHUB_FORCE_MEMORY = 'true';
    (globalThis as any).__foodhubMem = undefined;
    vi.restoreAllMocks();
    const { menu } = buildMenuFromClover('Po Poulet', rawItems, rawGroups);
    await getRepo().saveMenu({ ...menu, channelMarkupPct: { uber_eats: 20 } });
  });

  it('shows what each store receives and what changes since the last publish — and sends nothing', async () => {
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
    process.env.UBER_CLIENT_ID = 'id'; process.env.UBER_CLIENT_SECRET = 'secret';
    try {
      const repo = getRepo();
      const ue = await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-1', brandName: 'Po Poulet', locationCode: 'NDG_6284', autoAccept: true, online: true, meta: {} });
      const locked = await repo.upsertStore({ channel: 'doordash', channelStoreId: 'NDG-PP', brandName: 'Po Poulet', locationCode: 'NDG_6284', autoAccept: true, online: true, meta: { platformStoreId: '27982486' } });
      const spy = vi.spyOn(uberEatsAdapter, 'publishMenu').mockResolvedValue({ channel: 'uber_eats', ok: true, status: 'done', message: 'OK' });

      let rows = await previewPublish(['Po Poulet']);
      expect(spy).not.toHaveBeenCalled();
      const first = rows.find((r) => r.storeId === ue.id)!;
      expect(first).toMatchObject({ send: 'yes', diff: null, counts: { items: 6, available: 5, unavailable: 1 } });
      expect(first.sample.find((s) => s.name === 'Poutine moyenne')?.price).toBe(11.99); // 9.99 + 20 %
      expect(rows.find((r) => r.storeId === locked.id)).toMatchObject({ send: 'locked' });

      await publishMenu('Po Poulet');
      rows = await previewPublish(['Po Poulet']);
      expect(rows.find((r) => r.storeId === ue.id)!.diff?.same).toBe(true);

      const m = (await repo.getMenu('Po Poulet'))!;
      await repo.saveMenu({ ...m, items: m.items.map((i) => (i.ref === 'I-WINGS' ? { ...i, price: 17.99 } : i.ref === 'I-CHOU' ? { ...i, available: false } : i)).filter((i) => i.ref !== 'I-PITA') });
      const d = (await previewPublish(['Po Poulet'])).find((r) => r.storeId === ue.id)!.diff!;
      expect(d.same).toBe(false);
      expect(d.repriced).toEqual([{ ref: 'I-WINGS', name: '10 ailes', from: 20.39, to: 21.59 }]);
      expect(d.turnedOff.map((x) => x.ref)).toEqual(['I-CHOU']);
      expect(d.removed.map((x) => x.ref)).toEqual(['I-PITA']);
      expect(spy).toHaveBeenCalledTimes(1); // only the real publish
    } finally {
      delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED; delete process.env.UBER_CLIENT_ID; delete process.env.UBER_CLIENT_SECRET;
    }
  });
});
