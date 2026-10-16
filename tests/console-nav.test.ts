// The console's two menus (task 40): the simple view (default, 6 entries) and the full view (today's menu, unchanged).
// The view only hides links: every page stays reachable from search (⌘K) and by its address.
import { describe, expect, it } from 'vitest';
import { allConsolePages, mobileNav, NAV, NAV_SIMPLE, navFor, navVisible, type NavItem } from '../components/shell/nav';
import { SETTINGS_PAGES, settingsPageOf } from '../components/shell/settings-pages';
import { ROLE_PERMISSIONS } from '../lib/foodhub/session';
import { translator } from '../lib/i18n';
import type { Role } from '../lib/foodhub/types';

const fr = translator('fr');
const en = translator('en');
const canOf = (role: Role) => (perm: string) => (ROLE_PERMISSIONS[role] as string[]).includes(perm);
const rail = (role: Role, opts: { full?: boolean; device?: boolean; allLocations?: boolean; features?: string[] } = {}) => {
  const can = canOf(role);
  const visible = (n: Pick<NavItem, 'perm' | 'allLocations' | 'features'>) => navVisible(n, can, opts.allLocations ?? true, opts.features ?? []);
  return navFor(Boolean(opts.full), { role, device: opts.device ? { id: 'd' } : null }).filter(visible);
};
const labels = (items: NavItem[]) => items.map((n) => n.label(fr));

// The e2e screens (scripts/foodhub-e2e.mjs § 35), without the two that need an order id.
const E2E_SCREENS = ['/', '/orders', '/kitchen', '/stores', '/stores/hours', '/stores/mapping', '/menu', '/menu/86', '/alerts',
  '/insights', '/insights/reports', '/insights/activity', '/money', '/money/reconciliation', '/money/disputes', '/money/payouts', '/money/ledger', '/money/statements', '/money/fees', '/money/tgtg',
  '/settings', '/settings/profile', '/settings/team', '/settings/devices', '/settings/security', '/settings/alerts', '/settings/channels', '/settings/business', '/settings/go-live'];

describe('simple view menu', () => {
  it('has at most 6 groups, in plain words', () => {
    expect(NAV_SIMPLE.length).toBeLessThanOrEqual(6);
    expect(labels(rail('owner'))).toEqual(['Accueil', 'Commandes', 'Menus', 'Restaurants', 'Rapports', 'Réglages']);
    expect(rail('owner').map((n) => n.label(en))).toEqual(['Home', 'Orders', 'Menus', 'Restaurants', 'Reports', 'Settings']);
  });

  it('keeps the e2e menu links: Orders and Reports on Home, Money under Reports, the kitchen screen under Orders', () => {
    const items = rail('owner');
    expect(items.map((n) => n.href)).toEqual(expect.arrayContaining(['/orders', '/insights']));
    const reports = items.find((n) => n.href === '/insights')!;
    expect(reports.children!.map((c) => c.href)).toEqual(['/insights', '/money']);
    expect(reports.children![0].label(fr)).toBe('Ventes et tendances');
    const orders = items.find((n) => n.href === '/orders')!;
    expect(orders.children!.map((c) => c.href)).toEqual(['/orders', '/kitchen', '/direct']);
    expect(orders.match).toContain('/kitchen');
  });

  it('operator and kitchen tablet: kitchen screen on top, no Reports or Money', () => {
    expect(labels(rail('operator'))).toEqual(['Accueil', 'Écran cuisine', 'Commandes', 'Menus', 'Restaurants', 'Réglages']);
    expect(labels(rail('owner', { device: true }))).toEqual(['Accueil', 'Écran cuisine', 'Commandes', 'Menus', 'Restaurants', 'Rapports', 'Réglages']);
    const hrefs = rail('operator').flatMap((n) => [n.href, ...(n.children ?? []).map((c) => c.href)]);
    expect(hrefs).not.toContain('/insights');
    expect(hrefs).not.toContain('/money');
    // The kitchen screen is not listed twice.
    expect(hrefs.filter((h) => h === '/kitchen')).toHaveLength(1);
  });

  it('analyst and menu editor', () => {
    expect(labels(rail('analyst'))).toEqual(['Accueil', 'Commandes', 'Restaurants', 'Rapports', 'Réglages']);
    expect(labels(rail('menu'))).toEqual(['Accueil', 'Commandes', 'Menus', 'Restaurants', 'Réglages']);
  });

  it('a manager limited to some locations never gets Money', () => {
    const can = canOf('manager');
    const visible = (n: Pick<NavItem, 'perm' | 'allLocations' | 'features'>) => navVisible(n, can, false, []);
    const reports = navFor(false, { role: 'manager' }).find((n) => n.href === '/insights')!;
    expect(reports.children!.filter(visible).map((c) => c.href)).toEqual(['/insights']);
  });
});

describe('full view menu', () => {
  it('is exactly the menu from before task 40', () => {
    expect(navFor(true, { role: 'owner' })).toBe(NAV);
    expect(NAV.map((n) => n.href)).toEqual(['/', '/orders', '/kitchen', '/menu', '/stores', '/insights', '/settings']);
    expect(labels(NAV)).toEqual(['Aujourd’hui', 'Commandes', 'Écran cuisine', 'Menus', 'Restaurants', 'Rapports', 'Réglages']);
    expect(NAV[1].children!.map((c) => [c.href, c.label(fr)])).toEqual([['/orders', 'Toutes les commandes'], ['/direct', 'Nos commandes']]);
    expect(NAV[5].children!.map((c) => [c.href, c.label(fr)])).toEqual([['/insights', 'Analyses'], ['/money', 'Argent']]);
  });
});

describe('phone bottom bar', () => {
  const bar = (role: Role, full = false, device = false) => {
    const can = canOf(role);
    return mobileNav(full, { role, device: device ? {} : null }, (n) => navVisible(n, can, true, [])).map((n) => n.href);
  };
  it('4 slots picked by permission', () => {
    expect(bar('owner')).toEqual(['/', '/orders', '/menu/86', '/stores']);
    expect(bar('analyst')).toEqual(['/', '/orders', '/stores', '/insights']);
    expect(bar('operator')).toEqual(['/orders', '/kitchen', '/menu/86', '/stores']);
    expect(bar('owner', false, true)).toEqual(['/orders', '/kitchen', '/menu/86', '/stores']);
    expect(bar('owner', true)).toEqual(['/', '/orders', '/kitchen', '/alerts']);
  });
});

describe('search reaches every page in both views', () => {
  it('every e2e screen and the new store list are in the owner’s page list, once each', () => {
    const pages = allConsolePages(fr, canOf('owner'), true, []);
    const hrefs = pages.map((p) => p.href);
    for (const s of [...E2E_SCREENS, '/stores/list']) expect(hrefs, s).toContain(s);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const p of SETTINGS_PAGES) expect(hrefs).toContain(p.href);
  });

  it('own orders and grocery appear only with their features; Money only with every location', () => {
    const off = allConsolePages(fr, canOf('owner'), true, []).map((p) => p.href);
    expect(off).not.toContain('/direct');
    expect(off).not.toContain('/menu/retail');
    const on = allConsolePages(fr, canOf('owner'), true, ['delivery', 'retail']).map((p) => p.href);
    expect(on).toEqual(expect.arrayContaining(['/direct', '/menu/retail']));
    const limited = allConsolePages(fr, canOf('manager'), false, []).map((p) => p.href);
    expect(limited.some((h) => h.startsWith('/money'))).toBe(false);
    const op = allConsolePages(fr, canOf('operator'), false, []).map((p) => p.href);
    expect(op.some((h) => h.startsWith('/insights') || h.startsWith('/money') || h === '/settings/go-live')).toBe(false);
  });

  it('no menu or page label names the company, round-the-clock service, or calls brands anything but real restaurants', () => {
    // Built from pieces so a search of the source for the forbidden words only finds real uses.
    const notReal = new RegExp(['virtu(el|al)', 'gh' + 'ost', 'fant' + 'ôme'].join('|'), 'i');
    const texts = [
      ...[...NAV, ...NAV_SIMPLE].flatMap((n) => [n.label(fr), n.label(en), ...(n.children ?? []).flatMap((c) => [c.label(fr), c.label(en)])]),
      ...allConsolePages(fr, () => true, true, ['delivery', 'phone', 'retail', 'alcohol']).map((p) => p.label),
      ...allConsolePages(en, () => true, true, ['delivery', 'phone', 'retail', 'alcohol']).map((p) => p.label),
      ...SETTINGS_PAGES.flatMap((p) => [p.fr, p.en, p.dfr, p.den]),
    ];
    for (const s of texts) {
      expect(s, s).not.toMatch(/TAKATAK/);
      expect(s, s).not.toMatch(/24 ?(h|heures|\/ ?7)/i);
      expect(s, s).not.toMatch(notReal);
    }
  });
});

describe('settings groups', () => {
  it('every Settings page has a group; the advanced ones are the technician tools', () => {
    expect(SETTINGS_PAGES.filter((p) => p.group === 'advanced').map((p) => p.href)).toEqual(['/settings/channels', '/settings/doordash', '/settings/clover-app', '/settings/go-live']);
    for (const g of ['business', 'you', 'addons', 'advanced']) expect(SETTINGS_PAGES.filter((p) => p.group === g).length).toBeLessThanOrEqual(4);
    expect(settingsPageOf('/settings/expansion/delivery')?.href).toBe('/settings/expansion');
    expect(settingsPageOf('/settings')).toBeNull();
  });
});
