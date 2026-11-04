import { Children, createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceControls, WORKSPACES } from '../components/shell/platform-workspace';
import { mobileNav, navActive, navFor, navVisible, platformNav } from '../components/shell/nav';
import { translator } from '../lib/i18n';
import { ROLE_PERMISSIONS } from '../lib/foodhub/session';
import type { Role } from '../lib/foodhub/types';

const en = translator('en');
const fr = translator('fr');
const owner = { role: 'owner' };
const stores = [{ channel: 'doordash', locationCode: 'DEMO', brandName: 'Demo' }];

function visible(role: Role, allLocations = true) {
  return (n: Parameters<typeof navVisible>[0]) => navVisible(n, (p) => (ROLE_PERMISSIONS[role] as string[]).includes(p), allLocations, []);
}

describe('platform workspace navigation', () => {
  it('uses existing routes with familiar provider workflow labels and retains the full unified menu', () => {
    expect(navFor(false, owner).map((n) => n.label(en))).toEqual(['Home', 'Orders', 'Menus', 'Restaurants', 'Reports', 'Settings']);
    expect(navFor(false, owner, 'doordash').map((n) => n.label(en))).toContain('Financials');
    expect(navFor(false, owner, 'uber_eats').map((n) => n.label(en))).toContain('Payments');
    expect(navFor(false, owner, 'skip').map((n) => n.label(en))).toContain('Earnings');
    for (const channel of ['doordash', 'uber_eats', 'skip']) {
      const nav = navFor(false, owner, channel);
      expect(nav.flatMap((n) => n.children ?? []).some((n) => n.href === '/stores/screens')).toBe(true);
      expect(nav.filter((n) => navActive(n, '/money/payouts')).map((n) => n.href)).toEqual(['/money']);
      expect(nav.filter((n) => navActive(n, '/insights/reviews')).map((n) => n.href)).toEqual(['/insights']);
    }
    expect(platformNav('tgtg')).toBeNull();
  });

  it('keeps kitchen workflows and permissions when a provider is selected', () => {
    for (const channel of ['doordash', 'uber_eats', 'skip']) {
      expect(navFor(false, { role: 'operator' }, channel)).toEqual(navFor(false, { role: 'operator' }));
      expect(navFor(false, { ...owner, device: {} }, channel)).toEqual(navFor(false, { ...owner, device: {} }));
      expect(navFor(false, { role: 'analyst' }, channel).filter(visible('analyst')).map((n) => n.href)).not.toContain('/menu');
      expect(navFor(false, { role: 'manager' }, channel).filter(visible('manager', false)).map((n) => n.href)).not.toContain('/money');
      expect(navFor(false, { role: 'menu' }, channel).filter(visible('menu')).map((n) => n.href)).not.toContain('/insights');
      expect(mobileNav(false, owner, visible('owner'), channel).map((n) => n.href)).toEqual(['/', '/orders', '/menu', '/alerts']);
    }
  });
});

describe('workspace controls', () => {
  it('always offers all three providers, including unmapped workspaces, without claiming a live connection', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceControls, {
      site: { kitchen: 'DEMO', brand: 'Demo', channel: 'skip' }, stores, onPick: () => undefined,
      screensHref: '/stores/screens?channel=skip', t: en,
    }));
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Workspace"');
    for (const w of WORKSPACES) expect(html).toContain(w.label);
    expect(html).toContain('0 stores in this view');
    expect(html).toContain('Virtual tablets');
    expect(html).toContain('/stores/screens?channel=skip');
    expect(html).not.toMatch(/connected|password|official partner|disabled=/i);
    expect(html).toContain('grid-cols-2');
  });

  it('each click selects only its platform, and Food Hub clears that platform', () => {
    const onPick = vi.fn();
    const tree = WorkspaceControls({ site: { kitchen: 'DEMO', brand: 'Demo', channel: 'doordash' }, stores, onPick, screensHref: '/stores/screens', t: fr });
    const buttons: Array<{ onClick: () => void }> = [];
    const visit = (node: ReactNode) => Children.forEach(node, (child) => {
      if (!isValidElement<{ children?: ReactNode; onClick: () => void }>(child)) return;
      if (child.type === 'button') buttons.push(child.props);
      visit(child.props.children);
    });
    visit(tree);
    for (const button of buttons) button.onClick();
    expect(onPick.mock.calls).toEqual([[undefined], ['uber_eats'], ['doordash'], ['skip']]);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Tablettes virtuelles');
    expect(html).toContain('1 magasin dans cette vue');
  });
});
