import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AlertsView } from '../app/(console)/alerts/alerts-view';
import { GET } from '../app/api/foodhub/incidents/route';
import { hashPassword } from '../lib/foodhub/auth';
import { getRepo } from '../lib/foodhub/repo';
import { INCIDENTS } from '../lib/foodhub/watch/engine';
import type { Incident } from '../lib/foodhub/watch/types';

const page = vi.hoisted(() => ({ query: '', incidents: [] as Incident[] }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(page.query) }));
vi.mock('@/components/live/scoped-incidents', () => ({ useScopedIncidents: () => ({ list: page.incidents, filtered: false, reload: vi.fn() }) }));
vi.mock('@/components/live/pulse', () => ({ usePulse: () => ({ setSite: vi.fn() }), refreshEverything: vi.fn(), useScopeHref: () => (href: string) => href }));
vi.mock('@/components/shell/scope-switcher', () => ({ useScopeLabel: () => ({ words: 'Synthetic kitchen' }) }));
vi.mock('@/components/shell/viewer', () => ({
  useViewer: () => ({ viewer: {}, can: () => false, allLocations: false, full: false, locName: () => 'Synthetic kitchen' }),
  shortLoc: (label: string) => label,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({}) }));
vi.mock('@/lib/i18n/client', () => ({ useI18n: () => ({ t: (_fr: string, en: string) => en, lang: 'en', loc: 'en-CA' }), useProduct: () => ({ name: 'Food Hub' }) }));

const PASSWORD = 'synthetic-incident-proof-password';
const TARGET = '00000000-0000-4000-8000-000000000002';
const START = Date.parse('2026-11-26T22:00:00Z');
const DAY = 24 * 60 * 60_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('DASHBOARD_PASSWORD', PASSWORD);
  vi.stubGlobal('__foodhubMem', undefined);
  page.query = '';
  page.incidents = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function doc(id: string, { age = 1, locationCode = 'TEST_A', status = 'open', title = 'Unrelated open alert' }: {
  age?: number; locationCode?: string; status?: Incident['status']; title?: string;
} = {}) {
  const at = new Date(START - age).toISOString();
  const data: Incident = {
    id, key: `device_offline:${id}`, kind: 'device_offline', severity: 'critical', status,
    title, titleEn: title, locationCode, openedAt: at, updatedAt: at, lastSeenAt: at, level: 1, steps: [], count: 1,
  };
  return { id, key: data.key, at, data };
}

async function get(query: string, username: string | null = 'owner') {
  const headers = username ? { authorization: `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}` } : undefined;
  return GET(new Request(`https://foodhub.example.test/api/foodhub/incidents?${query}`, { headers }), undefined);
}

it('loads a permitted fixed incident by ID beyond the newest 500 without expanding the list', async () => {
  const repo = getRepo();
  const target = doc(TARGET, { age: 4 * DAY, status: 'resolved' });
  await repo.putDocs(INCIDENTS, [target, ...Array.from({ length: 500 }, (_, n) => doc(`newer-${n}`))]);

  const listing = await (await get('days=30')).json();
  expect(listing.incidents).toHaveLength(500);
  expect(listing.incidents).not.toContainEqual(expect.objectContaining({ id: TARGET }));
  const exact = await get(`days=30&id=${TARGET}`);
  expect(exact.status).toBe(200);
  expect(await exact.json()).toMatchObject({ incidents: [{ id: TARGET, status: 'resolved' }] });
});

it('preserves exact lookup authorization, location, status, age and private reservation data', async () => {
  const repo = getRepo();
  const target = doc(TARGET, { age: 4 * DAY, status: 'resolved' });
  const other = doc('00000000-0000-4000-8000-000000000003', { locationCode: 'TEST_B' });
  target.data.successorDetection = {
    locationCode: 'TEST_B', title: 'Private destination', titleEn: 'Private destination', severity: 'critical', lastSeenAt: target.at,
  };
  await repo.putDocs(INCIDENTS, [target, other]);
  await repo.saveUser({ username: 'manager', name: 'Synthetic manager', role: 'manager', locations: ['TEST_A'], active: true, passwordHash: hashPassword(PASSWORD) });

  expect((await get(`days=30&id=${TARGET}`, null)).status).toBe(401);
  const permitted = await (await get(`days=30&status=resolved&id=${TARGET}`, 'manager')).json();
  expect(permitted.incidents).toMatchObject([{ id: TARGET, status: 'resolved' }]);
  expect(permitted.incidents[0]).not.toHaveProperty('successorDetection');
  for (const query of [
    `days=30&id=${other.id}`, `days=30&id=${TARGET}&locations=TEST_B`, `days=30&status=open&id=${TARGET}`, `days=3&id=${TARGET}`,
  ]) {
    expect(await (await get(query, 'manager')).json()).toMatchObject({ incidents: [] });
  }
});

it('opens the fixed tab and expands its timeline when arriving from the incident link', () => {
  const target = doc(TARGET, { status: 'resolved', title: 'Linked tablet returned online' }).data;
  target.steps = [{ at: target.openedAt, kind: 'resolved', message: 'Original kitchen timeline evidence' }];
  page.query = `i=${TARGET}`;
  page.incidents = [target, doc('open').data];

  const html = renderToStaticMarkup(createElement(AlertsView));
  expect(html).toMatch(/aria-selected="true"[^>]*>Fixed \(3 days\)/);
  expect(html).toContain('Linked tablet returned online');
  expect(html).toContain('Original kitchen timeline evidence');
  expect(html).not.toContain('Unrelated open alert');
});
