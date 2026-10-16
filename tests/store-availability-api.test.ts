// Store availability center — the APIs: sign-in, permissions, location scope, manager approval; history rows and CSV;
// the throttled heartbeat. Memory store only, no platform call.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { logActivity } from '../lib/foodhub/activity';
import { hashPassword } from '../lib/foodhub/auth';
import { hashPin } from '../lib/foodhub/identity/pin';
import { getRepo } from '../lib/foodhub/repo';
import { statusHistory, toCsv } from '../lib/foodhub/store-availability/history';
import { tickAvailability } from '../lib/foodhub/store-availability/tick';
import type { FoodHubUser } from '../lib/foodhub/types';
import { GET as boardGet } from '../app/api/foodhub/store-availability/route';
import { GET as historyGet } from '../app/api/foodhub/store-availability/history/route';
import { GET as busyGet, PUT as busyPut } from '../app/api/foodhub/store-availability/busy-schedule/route';
import { GET as guardGet, PUT as guardPut } from '../app/api/foodhub/store-availability/guard/route';
import { GET as specialGet, POST as specialPost } from '../app/api/foodhub/store-availability/special-days/route';

const OWNER_PASS = 'owner-pass-availability-1';
let before: string | undefined;
let ip = 0;

function req(path: string, who: string | null, init: { method?: string; json?: unknown; headers?: Record<string, string> } = {}): Request {
  ip += 1;
  return new Request(`https://hub.test${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${ip % 250}`,
      ...(who ? { authorization: `Basic ${Buffer.from(who).toString('base64')}` } : {}),
      ...(init.headers ?? {}),
    },
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  });
}
const OWNER = `owner:${OWNER_PASS}`;
const MANAGER = 'lea:manager-pass-1';
const OPERATOR = 'leo:operator-pass-1';
const ANALYST = 'ana:analyst-pass-1';
const MENU = 'mo:menu-pass-1';

beforeAll(() => { before = process.env.DASHBOARD_PASSWORD; process.env.DASHBOARD_PASSWORD = OWNER_PASS; });
afterAll(() => { if (before === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = before; });

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  const repo = getRepo();
  const user = (username: string, role: FoodHubUser['role'], password: string, locations: string[], pin?: string) =>
    repo.saveUser({ username, name: username, role, locations, passwordHash: hashPassword(password), active: true, lastLoginAt: null, ...(pin ? { pinHash: hashPin(pin) } : {}) } as unknown as FoodHubUser);
  await user('lea', 'manager', 'manager-pass-1', ['NDG_MAIN'], '4827');
  await user('leo', 'operator', 'operator-pass-1', ['NDG_MAIN']);
  await user('ana', 'analyst', 'analyst-pass-1', []);
  await user('mo', 'menu', 'menu-pass-1', ['NDG_MAIN']);
});

describe('board API', () => {
  it('needs a sign-in and follows the location scope', async () => {
    expect((await boardGet(req('/api/foodhub/store-availability', null), {})).status).toBe(401);
    const owner = await (await boardGet(req('/api/foodhub/store-availability', OWNER), {})).json();
    expect(owner.board.kitchens.length).toBeGreaterThan(1);
    const op = await (await boardGet(req('/api/foodhub/store-availability?locations=HOCHELAGA', OPERATOR), {})).json();
    expect(op.board.kitchens).toEqual([]); // asked for a kitchen outside the scope: nothing
    const mine = await (await boardGet(req('/api/foodhub/store-availability', OPERATOR), {})).json();
    expect(mine.board.kitchens.map((k: { code: string }) => k.code)).toEqual(['NDG_MAIN']);
  });
});

describe('busy schedule API', () => {
  const body = (locationCode: string, windows: unknown[] = [{ days: ['friday'], start: '17:00', end: '20:00', extraMin: 10 }]) => ({ method: 'PUT', json: { locationCode, windows } });
  it('permissions, scope, validation', async () => {
    expect((await busyPut(req('/x', ANALYST, body('NDG_MAIN')), {})).status).toBe(403);
    expect((await busyPut(req('/x', OPERATOR, body('HOCHELAGA')), {})).status).toBe(403);
    expect((await busyPut(req('/x', OWNER, body('NOWHERE')), {})).status).toBe(400);
    expect((await busyPut(req('/x', OPERATOR, body('NDG_MAIN', [{ days: ['friday'], start: '17:00', end: '17:00', extraMin: 10 }])), {})).status).toBe(400);
    const ok = await busyPut(req('/x', OPERATOR, body('NDG_MAIN')), {});
    expect(ok.status).toBe(200);
    expect((await ok.json()).windows[0]).toMatchObject({ start: '17:00', end: '20:00', extraMin: 10 });
    await busyPut(req('/x', OWNER, body('HOCHELAGA')), {});
    const seen = await (await busyGet(req('/x', OPERATOR), {})).json();
    expect(Object.keys(seen.schedule)).toEqual(['NDG_MAIN']);
  });
  it('asks for a manager PIN when the busy-mode approval rule says so', async () => {
    await getRepo().setKv('policy', { 'store.busy': 'manager' });
    const ask = await busyPut(req('/x', OPERATOR, body('NDG_MAIN')), {});
    expect(ask.status).toBe(428);
    expect(await ask.json()).toMatchObject({ needsApproval: true, action: 'store.busy' });
    expect((await busyPut(req('/x', OPERATOR, { ...body('NDG_MAIN'), headers: { 'x-approval-pin': '1357' } }), {})).status).toBe(403);
    expect((await busyPut(req('/x', OPERATOR, { ...body('NDG_MAIN'), headers: { 'x-approval-pin': '4827' } }), {})).status).toBe(200);
    expect((await busyPut(req('/x', MANAGER, body('NDG_MAIN')), {})).status).toBe(200); // a manager passes the "manager" rule
  });
});

describe('guard API', () => {
  it('OFF by default; stores:map needed; scope; validation', async () => {
    const g = await (await guardGet(req('/x', OPERATOR), {})).json();
    expect(g.guard).toEqual({ NDG_MAIN: { enabled: false, graceMin: 5, pauseMin: 30, channels: ['uber_eats', 'doordash', 'skip', 'tgtg'] } });
    const put = (who: string, locationCode: string, config: unknown) => guardPut(req('/x', who, { method: 'PUT', json: { locationCode, config } }), {});
    expect((await put(OPERATOR, 'NDG_MAIN', { enabled: true })).status).toBe(403);
    expect((await put(MANAGER, 'HOCHELAGA', { enabled: true })).status).toBe(403);
    expect((await put(MANAGER, 'NDG_MAIN', { enabled: true, graceMin: 1 })).status).toBe(400);
    const ok = await put(MANAGER, 'NDG_MAIN', { enabled: true, graceMin: 10, pauseMin: 60, channels: ['uber_eats'] });
    expect(ok.status).toBe(200);
    expect((await ok.json()).guard).toEqual({ enabled: true, graceMin: 10, pauseMin: 60, channels: ['uber_eats'] });
  });
});

describe('special days API', () => {
  it('lists the presets; adding needs menu:edit and your own kitchens', async () => {
    const g = await (await specialGet(req('/api/foodhub/store-availability/special-days?year=2026', OPERATOR), {})).json();
    expect(g.presets.map((p: { id: string }) => p.id)).toContain('halloween');
    expect(g.presets).toHaveLength(8);
    expect((await specialGet(req('/api/foodhub/store-availability/special-days?year=1900', OPERATOR), {})).status).toBe(400);
    const post = (who: string, json: unknown) => specialPost(req('/x', who, { method: 'POST', json }), {});
    expect((await post(OPERATOR, { ids: ['halloween'], year: 2026, closed: true, locationCodes: ['NDG_MAIN'] })).status).toBe(403);
    expect((await post(MENU, { ids: ['halloween'], year: 2026, closed: true, locationCodes: [] })).status).toBe(403);
    expect((await post(MENU, { ids: ['halloween'], year: 2026, closed: true, locationCodes: ['HOCHELAGA'] })).status).toBe(403);
    expect((await post(OWNER, { ids: ['halloween'], year: 2026, closed: true, locationCodes: ['NOWHERE'] })).status).toBe(400);
    expect((await post(MENU, { ids: ['halloween'], year: 2026, slots: [{ open: '18:00', close: '02:00' }], locationCodes: ['NDG_MAIN'] })).status).toBe(400);
    const ok = await post(MENU, { ids: ['halloween'], year: 2026, slots: [{ open: '11:00', close: '23:00' }], locationCodes: ['NDG_MAIN'] });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ added: [{ date: '2026-10-31', locationCodes: ['NDG_MAIN'] }], skipped: [], publishAt: '/stores/hours' });
    const after = await (await specialGet(req('/api/foodhub/store-availability/special-days?year=2026', OPERATOR), {})).json();
    expect(after.presets.find((p: { id: string }) => p.id === 'halloween').existing).toHaveLength(1);
  });
});

describe('status history', () => {
  async function seed() {
    const base = { source: 'dashboard' as const, kind: 'store_status' as const, brandName: 'Alpha', locationCode: 'NDG_MAIN', storeId: 's1' };
    await logActivity({ ...base, actor: 'Mona', action: 'pause', status: 'success', channel: 'uber_eats', summary: 'Store paused until 15:30 (Kitchen too busy) — Alpha · NDG_MAIN on Uber Eats', detail: { untilMs: Date.parse('2026-10-16T19:30:00Z'), result: { status: 'done' } } });
    await logActivity({ ...base, actor: 'Garde tablette', source: 'automation', action: 'pause', status: 'failed', channel: 'doordash', summary: 'Store paused until 15:30 (Tablette de cuisine éteinte) — Alpha · NDG_MAIN on DoorDash (Live connector off)', detail: { result: { status: 'blocked', message: 'off' } } });
    await logActivity({ ...base, actor: 'Garde tablette', source: 'automation', action: 'resume', status: 'failed', channel: 'skip', summary: 'Store resumed — Alpha · NDG_MAIN on Skip (HTTP 500)', detail: { result: { status: 'error' } } });
    await logActivity({ ...base, actor: 'Uber Eats', source: 'platform', action: 'platform_paused', status: 'info', channel: 'uber_eats', summary: 'Uber Eats says paused' });
    await logActivity({ actor: 'Scheduled task', source: 'schedule', kind: 'store_status', action: 'busy_on', status: 'success', locationCode: 'NDG_MAIN', summary: 'NDG_MAIN switched to BUSY — prep 25 min' });
    await logActivity({ actor: 'Mona', source: 'dashboard', kind: 'hours', action: 'hours_saved', status: 'success', summary: 'Store hours saved' });
    await logActivity({ ...base, locationCode: 'HOCHELAGA', actor: 'Hugo', action: 'pause', status: 'success', channel: 'uber_eats', summary: 'Store paused — Alpha · HOCHELAGA on Uber Eats' });
    await logActivity({ actor: 'Mona', source: 'dashboard', kind: 'store_status', action: 'pause', status: 'failed', summary: 'Store pause not applied on any platform', detail: { notSent: true } });
    await logActivity({ ...base, actor: 'Mona', kind: 'menu_publish', action: 'publish', status: 'success', summary: 'Menu published' });
  }
  it('events, reasons, results (blocked shown as blocked), filters', async () => {
    await seed();
    const rows = await statusHistory({ locationCode: 'NDG_MAIN' });
    const ev = rows.map((r) => r.event).sort();
    expect(ev).toEqual(['busy_on', 'guard_pause', 'guard_resume', 'hours', 'pause', 'platform_paused'].sort());
    const pause = rows.find((r) => r.event === 'pause')!;
    expect(pause).toMatchObject({ reason: 'Kitchen too busy', until: '2026-10-16T19:30:00.000Z', by: 'Mona', result: 'ok', channel: 'uber_eats', kitchen: 'NDG_MAIN', brand: 'Alpha' });
    expect(rows.find((r) => r.event === 'guard_pause')).toMatchObject({ result: 'blocked', reason: 'Tablette de cuisine éteinte' });
    expect(rows.find((r) => r.event === 'guard_resume')).toMatchObject({ result: 'failed' });
    expect((await statusHistory({ locationCode: 'NDG_MAIN', channel: 'uber_eats' })).map((r) => r.event).sort()).toEqual(['pause', 'platform_paused']);
    expect((await statusHistory({})).filter((r) => r.kitchen === 'HOCHELAGA')).toHaveLength(1);
    expect((await statusHistory({ brandName: 'Nobody' }))).toEqual([]);
  });
  it('CSV: BOM, header, quoting, formula-safe cells', () => {
    const csv = toCsv([{ at: '2026-10-16T19:00:00.000Z', brand: 'Alpha, "Le Vrai"', kitchen: 'NDG_MAIN', channel: 'uber_eats', event: 'pause', until: null, reason: '=HYPERLINK("x")', by: 'Mona', result: 'blocked', summary: 'a\nb' }]);
    expect(csv.startsWith('﻿at,kitchen,brand,channel,event,until,reason,by,result,summary\r\n')).toBe(true);
    expect(csv).toContain('"Alpha, ""Le Vrai"""');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"a\nb"');
    expect(csv).not.toMatch(/%/);
  });
  it('API: scope, channel check, CSV download', async () => {
    await seed();
    expect((await historyGet(req('/api/foodhub/store-availability/history?location=HOCHELAGA', OPERATOR), {})).status).toBe(403);
    expect((await historyGet(req('/api/foodhub/store-availability/history?channel=fax', OPERATOR), {})).status).toBe(400);
    expect((await historyGet(req('/api/foodhub/store-availability/history?days=200', OPERATOR), {})).status).toBe(400);
    const mine = await (await historyGet(req('/api/foodhub/store-availability/history', OPERATOR), {})).json();
    expect(mine.rows.every((r: { kitchen: string | null }) => r.kitchen === 'NDG_MAIN' || r.kitchen === null)).toBe(true);
    const csv = await historyGet(req('/api/foodhub/store-availability/history?format=csv&days=7', OWNER), {});
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toMatch(/attachment; filename="historique-statuts-/);
    const text = await csv.text();
    expect(text.split('\r\n').filter(Boolean).length).toBe(1 + 7);
  });
});

describe('availability heartbeat', () => {
  it('runs at most every 30 s and never throws', async () => {
    const now = Date.now();
    expect((await tickAvailability(now)).ran).toBe(true);
    expect((await tickAvailability(now + 10_000)).ran).toBe(false);
    const r = await tickAvailability(now + 31_000);
    expect(r).toMatchObject({ ran: true, busy: { started: [], ended: [], kept: [] }, guard: { paused: [], extended: [], resumed: [], blocked: 0 } });
  });
});
