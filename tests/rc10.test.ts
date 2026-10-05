// RC10 — passwordless sign-in, staff PINs, manager approvals, kitchen tablets, Watchtower.
import { beforeEach, describe, expect, it } from 'vitest';
import { deadlineFor } from '../lib/foodhub/deadline';
import { maskEmail, maskPhone, normalizeEmail, normalizePhone } from '../lib/foodhub/notify';
import { checkPin, hashPin, pinProblem } from '../lib/foodhub/identity/pin';
import { parseContact, safeNext } from '../lib/foodhub/identity/otp';
import { defaultPolicy, needsApproval } from '../lib/foodhub/policy';
import { customerContact, lateMessage } from '../lib/foodhub/watch/customer';
import { signDevice, signSession, verifyDevice, verifySession } from '../lib/foodhub/session';
import type { FoodHubUser } from '../lib/foodhub/types';

const fresh = () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  (globalThis as any).__takatakWatchRunning = undefined;
};

describe('signed sessions and device cookies', () => {
  beforeEach(() => { process.env.SESSION_SECRET = 'rc10-test-secret-0123456789-abcdefghijklmnop'; });
  it('round-trips, rejects tampering, expiry and a device token used as a session', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60; // epoch seconds
    const s = await signSession({ u: 'sara', n: 'Sara', r: 'manager', l: ['NDG_MAIN'], exp });
    expect((await verifySession(s))?.u).toBe('sara');
    expect(await verifySession(`${s.slice(0, -2)}xx`)).toBeNull();
    expect(await verifySession(await signSession({ u: 'sara', n: 'Sara', r: 'manager', l: [], exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull();
    const d = await signDevice({ d: 'dev-1', l: 'NDG_MAIN', exp });
    expect((await verifyDevice(d))?.d).toBe('dev-1');
    expect(await verifySession(d)).toBeNull();
    expect(await verifyDevice(s)).toBeNull();
  });
});

describe('PINs and the manager-approval policy', () => {
  it('refuses trivial PINs and hashes the others', () => {
    for (const bad of ['', '12', '1234', '0000', '1111', '9876', 'abcd', '1234567']) expect(pinProblem(bad)).not.toBeNull();
    expect(pinProblem('4827')).toBeNull();
    const h = hashPin('4827');
    expect(h).not.toContain('4827');
    expect(checkPin('4827', h)).toBe(true);
    expect(checkPin('4828', h)).toBe(false);
    expect(checkPin('4827', null)).toBe(false);
  });
  it('staff need a manager for money actions; managers pass unless the rule is "always"', () => {
    const p = defaultPolicy();
    expect(p['order.reject']).toBe('manager');
    expect(p['order.cancel']).toBe('manager');
    expect(p['store.pause']).toBe('manager');
    expect(needsApproval(p['order.reject'], 'operator')).toBe(true);
    expect(needsApproval(p['order.reject'], 'manager')).toBe(false);
    expect(needsApproval('always', 'manager')).toBe(true);
    expect(needsApproval('off', 'operator')).toBe(false);
  });
});

describe('approval gate (memory store)', () => {
  beforeEach(fresh);
  it('428 without a PIN, 403 with a wrong one or a manager from another kitchen, OK with the right manager', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { approvalGate } = await import('../lib/foodhub/auth');
    const repo = getRepo();
    const mk = (u: Partial<FoodHubUser> & { username: string; role: FoodHubUser['role'] }): FoodHubUser => ({ name: u.username, locations: [], active: true, lastLoginAt: null, ...u } as unknown as FoodHubUser);
    await repo.saveUser(mk({ username: 'mona', name: 'Mona', role: 'manager', locations: ['NDG_MAIN'], pinHash: hashPin('4827') }));
    await repo.saveUser(mk({ username: 'hugo', name: 'Hugo', role: 'manager', locations: ['HOCHELAGA'], pinHash: hashPin('5931') }));
    await repo.saveUser(mk({ username: 'leo', name: 'Leo', role: 'operator', locations: ['NDG_MAIN'], pinHash: hashPin('7342') }));
    const actor = { username: 'leo', name: 'Leo', role: 'operator' as const, locations: ['NDG_MAIN'], source: 'dashboard' as const };
    const req = (pin?: string) => new Request('http://local/x', { headers: { 'x-forwarded-for': `10.0.0.${pin ?? 'none'}`, ...(pin ? { 'x-approval-pin': pin } : {}) } });

    const none = await approvalGate(req(), { ...actor }, 'order.reject', 'NDG_MAIN');
    expect(none?.status).toBe(428);
    const wrong = await approvalGate(req('1357'), { ...actor }, 'order.reject', 'NDG_MAIN');
    expect(wrong?.status).toBe(403);
    expect(await wrong?.json()).toMatchObject({ wrongPin: true });
    const otherKitchen = await approvalGate(req('5931'), { ...actor }, 'order.reject', 'NDG_MAIN');
    expect(otherKitchen?.status).toBe(403);
    const ownPin = await approvalGate(req('7342'), { ...actor }, 'order.reject', 'NDG_MAIN');
    expect(ownPin?.status).toBe(403); // staff cannot approve themselves
    const a = { ...actor } as typeof actor & { approvedBy?: string };
    expect(await approvalGate(req('4827'), a, 'order.reject', 'NDG_MAIN')).toBeNull();
    expect(a.approvedBy).toBe('Mona');
    expect(await approvalGate(req(), { ...actor }, 'order.delay', 'NDG_MAIN')).toBeNull(); // "off" by default
    expect(await approvalGate(req(), { ...actor, role: 'manager' as const }, 'order.reject', 'NDG_MAIN')).toBeNull();
    expect(await approvalGate(req(), { ...actor, builtin: true } as any, 'order.reject', 'NDG_MAIN')).toBeNull();
  });
});

describe('passwordless sign-in (memory store, dev codes)', () => {
  beforeEach(fresh);
  it('parses contacts and keeps redirects on this site', () => {
    expect(parseContact(' Sara@Example.COM ')).toEqual({ kind: 'email', value: 'sara@example.com' });
    expect(parseContact('(514) 555-0123')).toEqual({ kind: 'phone', value: '+15145550123' });
    expect(parseContact('hello')).toBeNull();
    expect(safeNext('/orders?open=1')).toBe('/orders?open=1');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
  });
  it('code by email: wrong code refused, right code signs in once, unknown contacts look the same, rate limited', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { startChallenge, verifyCode } = await import('../lib/foodhub/identity/otp');
    await getRepo().saveUser({ username: 'sara', name: 'Sara T', role: 'manager', locations: [], email: 'sara@example.com', active: true, lastLoginAt: null } as unknown as FoodHubUser);
    const s = await startChallenge('sara@example.com');
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.sentTo).not.toContain('sara@');
    expect(s.devCode).toMatch(/^\d{6}$/); // no email provider in tests → shown on screen in dev only
    const wrongCode = s.devCode === '000000' ? '111111' : '000000';
    expect((await verifyCode(s.challengeId, wrongCode)).ok).toBe(false);
    const ok = await verifyCode(s.challengeId, s.devCode!);
    expect(ok.ok && ok.user.username).toBe('sara');
    expect((await verifyCode(s.challengeId, s.devCode!)).ok).toBe(false); // single use

    const ghost = await startChallenge('nobody@example.com');
    expect(ghost.ok && ghost.devCode).toBeFalsy();
    for (let i = 0; i < 4; i++) await startChallenge('nobody@example.com');
    const limited = await startChallenge('nobody@example.com');
    expect(!limited.ok && limited.status).toBe(429);
  });
});

describe('contacts, deadlines and customer messages', () => {
  it('normalises and masks contacts', () => {
    expect(normalizePhone('514-555-0123')).toBe('+15145550123');
    expect(normalizePhone('12')).toBeNull();
    expect(normalizeEmail(' A@B.CA ')).toBe('a@b.ca');
    expect(maskPhone('+15145550123')).toBe('+1••••••0123');
    expect(maskEmail('sara@example.com')).toBe('s•••@example.com');
  });
  it('Uber gives 11.5 min to accept, Skip 5, DoorDash has no hard deadline here', () => {
    const at = '2026-10-04T18:00:00.000Z';
    expect(deadlineFor({ channel: 'uber_eats', createdAt: at })).toBe('2026-10-04T18:11:30.000Z');
    expect(deadlineFor({ channel: 'skip', createdAt: at })).toBe('2026-10-04T18:05:00.000Z');
    expect(deadlineFor({ channel: 'doordash', createdAt: at })).toBeNull();
  });
  it('relay numbers can be called (with the access code) but not texted', () => {
    const uber = customerContact({ channel: 'uber_eats', customerName: 'Ana B', raw: { eater: { phone: '+1 514 555 0199', phone_code: '123 45' } } } as any);
    expect(uber).toMatchObject({ phone: '+15145550199', code: '12345', tel: 'tel:+15145550199,,12345', canSms: false });
    const dd = customerContact({ channel: 'doordash', customerName: null, raw: { consumer: { phone_number: '5145550188' } } } as any);
    expect(dd.canSms).toBe(true);
    const m = lateMessage({ brandName: 'Po Poulet', customerName: 'Ana B' }, 10);
    expect(m.fr).toContain('Bonjour Ana');
    expect(m.en).toContain('10 more minutes');
  });
});

describe('Watchtower (memory store)', () => {
  beforeEach(fresh);
  it('opens one incident for a waiting order, updates it on the next run, resolves it when accepted', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { runWatch, listIncidents } = await import('../lib/foodhub/watch/engine');
    const repo = getRepo();
    const now = Date.now();
    const at = new Date(now - 4 * 60_000).toISOString();
    const { order } = await repo.insertOrderIfNew({
      channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'wf-watch-1', displayId: 'W1', channelStoreId: 's-1', fulfillment: 'delivery', placedAt: at, createdAt: at,
      currency: 'CAD', subtotal: 20, tax: 3, total: 23, deliveryFee: 0, tip: 0, discount: 0, lines: [], raw: {}, brandName: 'Po Poulet', locationCode: 'NDG_MAIN',
    } as any);
    const first = await runWatch({ force: true, now });
    expect(first.ran).toBe(true);
    const open = (await listIncidents({ status: ['open'] })).filter((i) => i.kind === 'order_unaccepted');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ orderId: order.id, severity: 'critical' });
    expect(open[0].explanation).toBeTruthy(); // rule playbook when no AI key

    await runWatch({ force: true, now: now + 30_000 });
    expect((await listIncidents({ status: ['open'] })).filter((i) => i.kind === 'order_unaccepted')).toHaveLength(1);

    await repo.updateOrder(order.id, { status: 'accepted', timeline: { ...(order.timeline ?? {}), seenAt: new Date(now).toISOString(), readyTarget: new Date(now + 20 * 60_000).toISOString() } } as any);
    await runWatch({ force: true, now: now + 60_000 });
    const after = (await listIncidents({})).filter((i) => i.kind === 'order_unaccepted');
    expect(after[0].status).toBe('resolved');
  });
  it('escalates like Uber: kitchen phone rings first, then the manager on duty is texted', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { saveLocation } = await import('../lib/foodhub/catalog');
    const { runWatch, listIncidents } = await import('../lib/foodhub/watch/engine');
    const repo = getRepo();
    await saveLocation({ code: 'HOCHELAGA', name: 'HOCHELAGA', address: '3583 Rue Sainte-Catherine E', phone: '514 555 0100', active: true });
    await repo.saveUser({ username: 'mona', name: 'Mona', role: 'manager', locations: ['HOCHELAGA'], phone: '+15145550177', active: true, lastLoginAt: null, prefs: { onDuty: true, alertSms: true, alertCall: true } } as unknown as FoodHubUser);
    await repo.saveUser({ username: 'off', name: 'Off Duty', role: 'manager', locations: ['HOCHELAGA'], phone: '+15145550166', active: true, lastLoginAt: null, prefs: { onDuty: false } } as unknown as FoodHubUser);
    const now = Date.parse('2026-10-04T17:00:00.000Z'); // 13:00 in Montréal — not quiet hours
    const at = new Date(now - 90_000).toISOString();
    await repo.insertOrderIfNew({
      channel: 'doordash', marketplace: 'doordash', externalOrderId: 'dd-esc-1', displayId: 'E1', channelStoreId: 'dd-1', fulfillment: 'delivery', placedAt: at, createdAt: at,
      currency: 'CAD', subtotal: 20, tax: 3, total: 23, deliveryFee: 0, tip: 0, discount: 0, lines: [], raw: {}, brandName: 'Po Poulet', locationCode: 'HOCHELAGA',
    } as any);
    await runWatch({ force: true, now });
    const r = await runWatch({ force: true, now: now + 3 * 60_000 });
    expect(r.escalated).toBeGreaterThanOrEqual(1);
    const inc = (await listIncidents({})).find((i) => i.kind === 'order_unaccepted');
    expect(inc?.level).toBe(1);
    const steps = inc?.steps ?? [];
    expect(steps.some((x) => x.kind === 'call' && x.to?.startsWith('HOCHELAGA'))).toBe(true); // the kitchen phone first
    expect(steps.some((x) => x.kind === 'sms' && x.to?.startsWith('Mona'))).toBe(true);
    expect(steps.some((x) => x.to?.startsWith('Off Duty'))).toBe(false); // not on duty → never texted
  });
});

describe('your Uber Eats stores (UUIDs from Uber Eats Manager)', () => {
  it('every Uber store name maps to one of your brands, and the address picks the kitchen', async () => {
    const { suggestMapping } = await import('../lib/foodhub/adapters/uber-provision');
    const raw = (await import('../data/actual/platform-stores-uber.json')).default as { stores: Array<{ store_id: string; uber_name: string }> };
    const brands = Object.fromEntries(raw.stores.map((s) => [s.uber_name, suggestMapping(s.uber_name).suggestedBrand]));
    expect(brands).toEqual({
      'Pi Pita': 'Pi Pita', 'PPP Pizzeria': 'PPP Pizzeria', 'Gateaux Montréal': 'Gateau Montreal', "O'Oeufs Montréal": 'OOeuf',
      'Nutri Shake': 'Nutrition Shake', 'Bolon Café': 'Cafe Bolon', 'BIN MOLLE BIN DURE': 'Bin molle & Bin Dure',
    });
    expect(raw.stores.every((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s.store_id))).toBe(true);
    expect(suggestMapping('Crèmerie Bin Molle Bin Dure').suggestedBrand).toBe('Crèmerie Bin Molle Bin Dure');
    expect(suggestMapping('Pi Pita', '3583 Rue Sainte-Catherine E, Montréal').suggestedLocation).toBe('HOCHELAGA');
    expect(suggestMapping('PPP Pizzeria', '6284 Av Somerled, Montréal').suggestedLocation).toBe('NDG_6284');
  });
});
