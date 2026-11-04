import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { screenReadiness, type ReadinessScreen } from '../lib/ui/screens-readiness';
import { ScreenReadinessPanel } from '../components/live/screen-readiness';
import { translator } from '../lib/i18n';

const all = { kitchen: null, brand: null };
const screens: ReadinessScreen[] = Array.from({ length: 54 }, (_, i) => ({
  platform: i < 18 ? 'doordash' : i < 36 ? 'ubereats' : 'skip',
  locationCode: i % 2 ? 'NORTH' : 'SOUTH',
  status: i === 0 ? 'login_required' : i === 1 ? 'offline' : i === 2 ? 'error' : i === 3 ? 'never' : 'online',
  lastSeenAt: i === 3 ? null : '2026-10-30T12:00:00.000Z',
  command: i === 3 ? { kind: 'open' } : null,
}));

function panel(overrides: Partial<Parameters<typeof ScreenReadinessPanel>[0]> = {}) {
  return renderToStaticMarkup(createElement(ScreenReadinessPanel, {
    screens, paths: [], site: all, live: null, relayConfigured: true, manage: true, lang: 'en', t: translator('en'), ...overrides,
  }));
}

describe('screen account readiness', () => {
  it('counts the real observed states separately for all 54 independent accounts', () => {
    const summaries = screenReadiness(screens, all);
    expect(summaries).toHaveLength(3);
    expect(summaries[0]).toEqual({ platform: 'doordash', channel: 'doordash', target: 18, registered: 18, online: 14, signIn: 1, unavailable: 2, never: 1, pending: 1, lastReportAt: '2026-10-30T12:00:00.000Z' });
    expect(summaries[1]).toMatchObject({ platform: 'ubereats', registered: 18, online: 18 });
    expect(summaries[2]).toMatchObject({ platform: 'skip', registered: 18, online: 18 });
    expect(summaries.reduce((n, s) => n + s.registered, 0)).toBe(54);
  });

  it('follows the selected provider and location without hiding multi-brand account sessions', () => {
    expect(screenReadiness(screens, { ...all, kitchen: 'NORTH', channel: 'uber_eats' })).toEqual([
      expect.objectContaining({ platform: 'ubereats', registered: 9, online: 9 }),
    ]);
    expect(screenReadiness(screens, { ...all, channel: 'tgtg' })).toEqual([]);
  });

  it('retains more than 18 sessions and treats 18 as a target, not a maximum', () => {
    const extra = Array.from({ length: 30 }, () => ({ platform: 'skip', locationCode: 'NORTH', status: 'online' }));
    expect(screenReadiness(extra, { ...all, channel: 'skip' })[0]).toMatchObject({ registered: 30, online: 30, target: 18 });
    const html = panel({ screens: extra, site: { ...all, channel: 'skip' } });
    expect(html).toContain('30 registered');
    expect(html).toContain('You can have more; existing accounts are kept.');
  });

  it('shows no report for missing or invalid timestamps and keeps never-seen accounts distinct from offline', () => {
    const rows = [{ platform: 'skip', locationCode: 'NORTH', status: 'never', lastSeenAt: 'bad-date' }];
    expect(screenReadiness(rows, { ...all, channel: 'skip' })[0]).toMatchObject({ registered: 1, online: 0, never: 1, unavailable: 0, lastReportAt: null });
    expect(panel({ screens: rows, site: { ...all, channel: 'skip' } })).toContain('No report received for these accounts.');
  });
});

describe('truthful manual session and order-route presentation', () => {
  it('does not equate reported-online screens with live API/printing acceptance', () => {
    const html = panel({ live: false, paths: [{ platform: 'doordash', mode: 'direct', cloverReady: false, lastOrderAt: null }] });
    expect(html).toContain('screen(s) reported online');
    expect(html).toContain('Safe mode · API writes off');
    expect(html).toContain('Configured route: platform → Food Hub');
    expect(html).toContain('Clover connection needs setup.');
    expect(html).toContain('No recent order recorded.');
    expect(html).toContain('An online screen does not confirm API access or order printing');
    expect(html).not.toMatch(/production ready|fully connected|all systems operational/i);
  });

  it('keeps unknown route/history/mode distinct from a configured route with no orders', () => {
    const html = panel();
    expect(html).toContain('API route not reported');
    expect(html).toContain('Order history not reported.');
    expect(html).toContain('API mode not reported');
    expect(html).not.toContain('No recent order recorded.');
  });

  it('provides status-first PC reuse guidance only to managers and never requests platform credentials', () => {
    const html = panel({ relayConfigured: false });
    expect(html).toContain('Already installed on your Windows PC?');
    expect(html).toContain('Status-Screens.ps1');
    expect(html).toContain('Keep your existing installation and browser profiles.');
    expect(html).toContain('Existing sign-ins on your PC are preserved.');
    expect(html).not.toMatch(/<input|Install-Screens\.ps1|FOODHUB_SCREENS_AGENT_TOKEN/);
    expect(panel({ manage: false })).not.toContain('Status-Screens.ps1');
  });

  it('omits provider-switch actions on a fixed kitchen device', () => {
    expect(panel()).not.toContain('Show screens');
    expect(panel({ onShow: () => undefined })).toContain('Show screens');
  });

  it('is bilingual and names configured Clover paths without claiming real order success', () => {
    const html = panel({ site: { ...all, channel: 'skip' }, lang: 'fr', t: translator('fr'), live: true,
      paths: [{ platform: 'skip', mode: 'via_clover', cloverReady: true, lastOrderAt: null }] });
    expect(html).toContain('Écritures API activées');
    expect(html).toContain('Parcours configuré : plateforme → Clover');
    expect(html).toContain('Aucune commande récente enregistrée.');
    expect(html).toContain('Déjà installé sur votre PC Windows');
    expect(html).not.toContain('DoorDash');
  });
});
