import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cancellationRate, HOME_QUICK_ACTIONS, homeAttention, homeAttentionHref } from '../lib/ui/home-operations';
import { OperationsOverview } from '../components/home/operations-overview';
import type { Alert } from '../lib/foodhub/command';
import { translator } from '../lib/i18n';
import { scopeHref } from '../lib/foodhub/scope';

const alerts: Alert[] = [
  { id: 'cancelled', severity: 'info', title: 'One recorded cancellation' },
  { id: 'sync-stale', severity: 'warning', title: 'Store sync needs checking', href: '/settings/channels' },
  { id: 'pos:synthetic', severity: 'critical', title: 'Synthetic order did not reach Clover', orderId: 'synthetic/order' },
];
const scope = { kitchen: 'SYNTHETIC', brand: 'Demo', channel: 'skip' };
const scoped = (path: string) => scopeHref(path, scope);
const markup = (list: Alert[] | null = alerts, can = (_permission: string) => true, lang: 'fr' | 'en' = 'en') => renderToStaticMarkup(createElement(OperationsOverview, { alerts: list, can, href: scoped, t: translator(lang) }));

describe('recorded cancellation rate', () => {
  it('adds cancelled orders back to the denominator used by the existing scoped KPI', () => {
    expect(cancellationRate(9, 1)).toBe(10);
    expect(cancellationRate(2, 1)).toBe(33.3);
    expect(cancellationRate(0, 3)).toBe(100);
    expect(cancellationRate(3, 0)).toBe(0);
  });
  it('shows unknown, not a zero-success rate, when no orders exist or counts are invalid', () => {
    expect(cancellationRate(0, 0)).toBeNull();
    expect(cancellationRate(-1, 1)).toBeNull();
    expect(cancellationRate(Number.NaN, 1)).toBeNull();
    expect(cancellationRate(1, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('observed home priorities', () => {
  it('ranks existing critical/warning observations without inventing opportunities or mutating the source', () => {
    expect(homeAttention(alerts).map((item) => item.id)).toEqual(['pos:synthetic', 'sync-stale']);
    expect(alerts.map((item) => item.id)).toEqual(['cancelled', 'sync-stale', 'pos:synthetic']);
    expect(homeAttention([])).toEqual([]);
  });
  it('links to the exact observed order and rejects external or malformed alert actions', () => {
    expect(homeAttentionHref(alerts[2])).toBe('/orders?open=synthetic%2Forder');
    expect(homeAttentionHref(alerts[1])).toBe('/settings/channels');
    for (const href of ['https://example.test/', '//example.test/', '/\\example.test/', '/orders\nmalformed']) {
      expect(homeAttentionHref({ ...alerts[1], href })).toBe('/alerts');
    }
  });
  it('keeps quick actions and observed-order links inside the selected workspace', () => {
    const html = markup();
    expect(html).toContain('Needs attention');
    expect(html).toContain('Quick actions');
    expect(html).toContain('/orders?open=synthetic%2Forder&amp;kitchen=SYNTHETIC&amp;brand=Demo&amp;channel=skip');
    for (const action of HOME_QUICK_ACTIONS) expect(html).toContain(action.en);
    expect(html).not.toContain('One recorded cancellation');
    expect(html).not.toMatch(/guaranteed|AI recommendation|revenue opportunity|everything connected/i);
  });
  it('limits quick-action links by role and routes setup issues to alerts for non-admin users', () => {
    const html = markup(alerts, (permission) => permission === 'view');
    expect(html).toContain('Open orders');
    expect(html).toContain('Virtual tablets');
    expect(html).not.toContain('Edit menu');
    expect(html).not.toContain('Sales reports');
    expect(html).not.toContain('/settings/channels');
    expect(html).toContain('/alerts?kitchen=SYNTHETIC');
  });
  it('keeps loading, no-priority and ongoing monitoring states distinct in both languages', () => {
    expect(markup(null)).toContain('Loading priorities');
    expect(markup(null)).not.toContain('No priority issue');
    expect(markup([])).toContain('Monitoring alerts remain below.');
    const fr = markup(alerts, () => true, 'fr');
    expect(fr).toContain('À régler d’abord');
    expect(fr).toContain('Raccourcis');
    expect(fr).toContain('Commande non reçue par Clover');
  });
});
