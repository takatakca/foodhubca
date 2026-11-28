import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { IncidentResolutionBadge } from '../app/(console)/alerts/alerts-view';
import { DEVICE_OFFLINE_RESOLUTIONS, INACTIVE_KITCHEN_CLOSURE, type Incident, type IncidentStep } from '../lib/foodhub/watch/types';

const locale = vi.hoisted(() => ({ french: false }));
vi.mock('@/lib/i18n/client', () => ({ useI18n: () => ({ t: (fr: string, en: string) => locale.french ? fr : en }) }));

const closedAt = '2026-11-27T00:00:00.000Z';
const later = '2026-11-27T00:01:00.000Z';
const legacyClosure: IncidentStep = { at: closedAt, kind: 'resolved', by: 'auto', message: INACTIVE_KITCHEN_CLOSURE };
const closed: Incident = {
  id: 'closed-device', key: 'device_offline:synthetic', kind: 'device_offline', severity: 'warning', status: 'resolved',
  title: 'Tablette éteinte', titleEn: 'Tablet off', openedAt: closedAt, updatedAt: closedAt, lastSeenAt: closedAt,
  resolvedAt: closedAt, resolvedBy: 'auto', count: 1, level: 0, steps: [],
};

function render(incident: Incident, french = false) {
  locale.french = french;
  return renderToStaticMarkup(createElement(IncidentResolutionBadge, { incident }));
}

it.each([[true, 'surveillance arrêtée'], [false, 'monitoring stopped']] as const)('renders a neutral badge for the recorded reason in either language', (french, label) => {
  const markup = render({ ...closed, steps: [{ ...legacyClosure, message: undefined, resolutionReason: 'inactive-kitchen' }] }, french);
  expect(markup).toContain(label);
  expect(markup).toContain('bg-sunken text-ink-2');
  expect(markup).not.toContain('bg-go-soft');
});

it('recognizes the exact historic closure even if the accepted call result arrives after it', () => {
  const markup = render({ ...closed, steps: [legacyClosure, { at: later, kind: 'call', ok: true }] });
  expect(markup).toContain('monitoring stopped');
});

it('keeps reopening and subsequent ordinary closure distinct from old monitoring history', () => {
  const prior = { ...closed, steps: [{ ...legacyClosure, resolutionReason: 'inactive-kitchen' as const }, { at: later, kind: 'reopened' as const }] };
  expect(render({ ...prior, status: 'open', resolvedAt: null, resolvedBy: null })).toBe('');
  const closedAgain = { ...prior, resolvedAt: later, steps: [...prior.steps, { at: later, kind: 'resolved' as const, by: 'auto', message: 'Réglé / Fixed' }] };
  expect(render({ ...closedAgain, kind: 'device_muted' })).toMatch(/bg-go-soft.*fixed itself/);
  expect(render(closedAgain)).toContain(DEVICE_OFFLINE_RESOLUTIONS.unconfirmed.label[1]);
  expect(render({ ...closedAgain, resolvedBy: 'Operator' })).toMatch(/bg-go-soft.*fixed by Operator/);
});

it('keeps a fresh same-kitchen heartbeat distinct from a prior inactive kitchen', () => {
  const restored: IncidentStep = { at: later, kind: 'resolved', by: 'auto', deviceOfflineResolution: 'heartbeat-restored' };
  const markup = render({ ...closed, resolvedAt: later, steps: [legacyClosure, restored] });
  expect(markup).toContain(DEVICE_OFFLINE_RESOLUTIONS['heartbeat-restored'].label[1]);
  expect(markup).toContain('bg-go-soft');
  expect(markup).not.toContain('monitoring stopped');
});
