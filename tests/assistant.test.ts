// Food Hub Assistant — tools, proposals, approval and the locked rules (memory repo, no network, no Claude call):
//   - tool routing: each tool name reaches its function, inputs are validated, unknown tools are errors;
//   - a proposal NEVER executes by itself: nothing changes until the author taps Approve;
//   - Approve calls the existing gated route as the signed-in person (role, manager-PIN policy) and logs
//     "Assistant (approved by <person>)";
//   - Po Poulet NDG (DoorDash 27982486) is refused, before the card and again at Approve time;
//   - built-in page summaries / next steps when there is no API key.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, type AuthUser } from '../lib/foodhub/auth';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelStore, FoodHubUser, MasterMenu } from '../lib/foodhub/types';

process.env.FOODHUB_FORCE_MEMORY = 'true';
process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
process.env.FOODHUB_TRUST_PROXY = 'true';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED;

const PASS = 'Assistant-test-42';
const BRAND = 'Assist Burger';
const basic = (u: string) => ({ authorization: `Basic ${Buffer.from(`${u}:${PASS}`).toString('base64')}`, 'x-forwarded-for': `10.9.0.${u.length}` });
const post = (path: string, user: string, body: unknown) => new Request(`http://hub.local${path}`, { method: 'POST', headers: { ...basic(user), 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const MGR: AuthUser = { username: 'as_mgr', name: 'Mgr Assist', role: 'manager', locations: [], source: 'dashboard' };
const OP: AuthUser = { username: 'as_op', name: 'Op Assist', role: 'operator', locations: [], source: 'dashboard' };
const ANALYST: AuthUser = { username: 'as_analyst', name: 'Ana Assist', role: 'analyst', locations: [], source: 'dashboard' };

const menu = (brandName: string): MasterMenu => ({
  brandName, updatedAt: new Date().toISOString(), categories: [{ ref: 'c', name: 'Mains', sortOrder: 0 }], modifierGroups: [],
  items: [
    { ref: 'it-burger', name: 'Classic burger', nameFr: 'Burger classique', price: 12, categoryRef: 'c', available: true, modifierGroupRefs: [], channelPrices: { uber_eats: 14.5 } },
    { ref: 'it-fries', name: 'Fries', nameFr: 'Frites', price: 4, categoryRef: 'c', available: true, modifierGroupRefs: [] },
  ],
  channelMarkupPct: { doordash: 20 },
});

let uberNdg: ChannelStore; let ddNdg: ChannelStore; let poPouletDd: ChannelStore; let poPouletUberHoch: ChannelStore;
const fetchSpy = vi.fn(async () => new Response('{}', { status: 599 }));

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchSpy); // any outbound call would show up here
  const repo = getRepo();
  const mk = (u: AuthUser) => repo.saveUser({ username: u.username, name: u.name, role: u.role, locations: u.locations, active: true, lastLoginAt: null, passwordHash: hashPassword(PASS) } as unknown as FoodHubUser);
  await Promise.all([mk(MGR), mk(OP), mk(ANALYST)]);
  await repo.saveMenu(menu(BRAND));
  await repo.saveMenu(menu('Po Poulet'));
  uberNdg = await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'uber-assist-ndg', brandName: BRAND, locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
  ddNdg = await repo.upsertStore({ channel: 'doordash', channelStoreId: 'dd-assist-ndg', brandName: BRAND, locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
  // Po Poulet NDG on DoorDash: the protected store (built-in lock on its DoorDash number).
  poPouletDd = await repo.upsertStore({ channel: 'doordash', channelStoreId: '27982486', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
  poPouletUberHoch = await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'uber-pp-hoch', brandName: 'Po Poulet', locationCode: 'HOCHELAGA', autoAccept: true, online: true, meta: {} });
});

beforeEach(() => fetchSpy.mockClear());

async function activity() { return getRepo().listActivity({ limit: 500 }); }

describe('tool routing', () => {
  it('every tool has a JSON schema Claude can read, and no tool can change anything directly', async () => {
    const { toolDefinitions, PROPOSE_TOOLS } = await import('../lib/foodhub/assistant/tools');
    const defs = toolDefinitions();
    const names = defs.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(['get_sales', 'get_top_items', 'get_order_issues', 'get_missed_orders', 'get_store_status', 'get_reviews', 'get_payouts', 'get_incidents', 'get_autopilot', 'find_menu_items', 'propose_price_change', 'propose_item_availability', 'propose_store_pause', 'propose_prep_time', 'propose_campaign']));
    for (const d of defs) {
      expect(d.input_schema.type).toBe('object');
      expect(d.input_schema).not.toHaveProperty('$schema');
      expect(d.eager_input_streaming).toBe(true);
    }
    // Only read and propose tools exist: nothing named set_/update_/pause_/approve_.
    expect(names.every((n) => n.startsWith('get_') || n.startsWith('find_') || n.startsWith('propose_'))).toBe(true);
    expect([...PROPOSE_TOOLS].every((n) => n.startsWith('propose_'))).toBe(true);
    // The sales sources cover every channel at once.
    const sales = defs.find((d) => d.name === 'get_sales')!;
    expect(JSON.stringify(sales.input_schema)).toContain('website');
    expect(JSON.stringify(sales.input_schema)).toContain('clover');
    expect(JSON.stringify(sales.input_schema)).toContain('tgtg');
  });

  it('routes a read tool to its data function, validates input, and refuses unknown tools', async () => {
    const { runTool } = await import('../lib/foodhub/assistant/tools');
    const status = await runTool('get_store_status', { location: 'NDG_MAIN' }, { actor: MGR, chatId: null });
    expect(status.isError).toBeFalsy();
    const body = JSON.parse(status.content);
    expect(body.stores.map((s: { storeId: string }) => s.storeId)).toEqual(expect.arrayContaining([uberNdg.id, ddNdg.id]));
    expect(body.prepTimes.NDG_MAIN.normal).toBeGreaterThan(0);

    const items = JSON.parse((await runTool('find_menu_items', { query: 'burger', brand: BRAND }, { actor: MGR, chatId: null })).content);
    expect(items.items[0]).toMatchObject({ ref: 'it-burger', prices: { in_store: 12, uber_eats: 14.5, doordash: 14.4, skip: 12 } });

    const bad = await runTool('get_sales', { period: 'forever' }, { actor: MGR, chatId: null });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content).error).toBe('INVALID_INPUT');
    const unknown = await runTool('pause_everything', {}, { actor: MGR, chatId: null });
    expect(unknown.isError).toBe(true);
  });

  it('read tools follow the role: an operator sees today only, payouts need every kitchen', async () => {
    const { runTool } = await import('../lib/foodhub/assistant/tools');
    expect(JSON.parse((await runTool('get_sales', { period: 'last_7_days' }, { actor: OP, chatId: null })).content).error).toMatch(/today only/);
    expect(JSON.parse((await runTool('get_sales', { period: 'today' }, { actor: OP, chatId: null })).content).totals).toBeDefined();
    const scoped: AuthUser = { ...ANALYST, locations: ['NDG_MAIN'] };
    expect(JSON.parse((await runTool('get_payouts', {}, { actor: scoped, chatId: null })).content).error).toMatch(/company-wide/);
  });
});

describe('proposals never execute without Approve', () => {
  it('a pause proposal is only a card: the store stays online and nothing is logged as done', async () => {
    const { proposeStoreStatus, getProposal } = await import('../lib/foodhub/assistant/proposals');
    const before = (await activity()).length;
    const out = await proposeStoreStatus({ store_ids: [uberNdg.id], online: false, minutes: 30, reason: 'rush' }, { actor: MGR, chatId: null });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.proposal).toMatchObject({ kind: 'store_status', status: 'pending', perm: 'stores:toggle' });
    expect(out.proposal.changes[0]).toMatchObject({ fromEn: 'Online', toEn: 'Paused for 30 min' });
    expect(out.proposal).not.toHaveProperty('action'); // the card never carries the request
    expect((await getRepo().listStores()).find((s) => s.id === uberNdg.id)?.online).toBe(true);
    expect((await activity()).length).toBe(before);
    expect((await getProposal(out.proposal.id))?.status).toBe('pending');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a price proposal shows old → new per platform and leaves the menu as it is', async () => {
    const { proposePriceChange } = await import('../lib/foodhub/assistant/proposals');
    const out = await proposePriceChange({ brand: 'assist burger', item: 'Classic burger', platforms: ['uber_eats', 'in_store'], new_price: 15.25 }, { actor: MGR, chatId: null });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.proposal.changes.map((c) => [c.whereEn.split(' · ')[0], c.fromEn, c.toEn])).toEqual([['Uber Eats', '$14.50', '$15.25'], ['In store, website and Clover', '$12.00', '$15.25']]);
    expect((await getRepo().getMenu(BRAND))?.items.find((i) => i.ref === 'it-burger')?.price).toBe(12);
  });

  it('a person without the permission gets no card', async () => {
    const { proposePriceChange } = await import('../lib/foodhub/assistant/proposals');
    const out = await proposePriceChange({ brand: BRAND, item: 'it-burger', platforms: ['uber_eats'], new_price: 13 }, { actor: OP, chatId: null });
    expect(out).toMatchObject({ ok: false, refused: 'role' });
  });

  it('ambiguous or unknown items are questions, not guesses', async () => {
    const { proposeItemAvailability } = await import('../lib/foodhub/assistant/proposals');
    const out = await proposeItemAvailability({ brand: BRAND, items: ['pizza'], available: false, location: 'NDG_MAIN' }, { actor: MGR, chatId: null });
    expect(out).toMatchObject({ ok: false, refused: 'invalid' });
  });
});

describe('Approve calls the existing gated route as the signed-in person', () => {
  it('manager approves a pause: the stores route runs as the manager, logged "Assistant (approved by …)"', async () => {
    const { proposeStoreStatus, getProposal } = await import('../lib/foodhub/assistant/proposals');
    const out = await proposeStoreStatus({ store_ids: [ddNdg.id], online: false, minutes: 20 }, { actor: MGR, chatId: null });
    if (!out.ok) throw new Error(out.error);
    const { POST } = await import('../app/api/foodhub/assistant/proposals/[id]/route');
    const res = await POST(post(`/api/foodhub/assistant/proposals/${out.proposal.id}`, 'as_mgr', { decision: 'approve' }), ctx(out.proposal.id));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.proposal.status).toBe('approved');
    // Live connectors are off: honest result, nothing claimed as sent.
    expect(body.proposal.resultEn).toMatch(/not sent/);
    const log = await activity();
    expect(log.some((a) => a.kind === 'store_status' && a.actor === 'Mgr Assist' && a.action === 'pause')).toBe(true);
    expect(log.some((a) => a.kind === 'approval' && a.actor === 'Assistant (approved by Mgr Assist)' && a.action === 'assistant_approve')).toBe(true);
    expect((await getProposal(out.proposal.id))?.status).toBe('approved');
    // Once decided, it cannot be approved again.
    const again = await POST(post(`/api/foodhub/assistant/proposals/${out.proposal.id}`, 'as_mgr', { decision: 'approve' }), ctx(out.proposal.id));
    expect(again.status).toBe(409);
  });

  it('an operator approving a pause hits the manager-PIN policy (428) and the card stays pending', async () => {
    const { proposeStoreStatus, getProposal } = await import('../lib/foodhub/assistant/proposals');
    const out = await proposeStoreStatus({ store_ids: [uberNdg.id], online: false }, { actor: OP, chatId: null });
    if (!out.ok) throw new Error(out.error);
    const { POST } = await import('../app/api/foodhub/assistant/proposals/[id]/route');
    const res = await POST(post(`/api/foodhub/assistant/proposals/${out.proposal.id}`, 'as_op', { decision: 'approve' }), ctx(out.proposal.id));
    expect(res.status).toBe(428);
    expect((await res.json()).needsApproval).toBe(true);
    expect((await getProposal(out.proposal.id))?.status).toBe('pending');
    expect((await getRepo().listStores()).find((s) => s.id === uberNdg.id)?.online).toBe(true);
  });

  it('forwards the caller’s own credentials and manager PIN to the gated route (path, method, body from the stored card)', async () => {
    const { proposeItemAvailability } = await import('../lib/foodhub/assistant/proposals');
    const { decideProposal } = await import('../lib/foodhub/assistant/approve');
    const out = await proposeItemAvailability({ brand: BRAND, items: ['Fries'], available: false, location: 'NDG_MAIN', minutes: 60 }, { actor: MGR, chatId: null });
    if (!out.ok) throw new Error(out.error);
    const seen: Array<{ path: string; method: string; body: unknown; auth: string | null; pin: string | null }> = [];
    const req = new Request('http://hub.local/x', { method: 'POST', headers: { ...basic('as_mgr'), 'x-approval-pin': '2468' } });
    const res = await decideProposal(req, MGR, out.proposal.id, 'approve', async (orig, spec) => {
      seen.push({ path: spec.path, method: spec.method, body: spec.body, auth: orig.headers.get('authorization'), pin: orig.headers.get('x-approval-pin') });
      return Response.json({ ok: true, results: [] });
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ path: '/api/foodhub/availability', method: 'POST', body: { brand: BRAND, itemRefs: ['it-fries'], available: false, locationCode: 'NDG_MAIN', minutes: 60 }, auth: basic('as_mgr').authorization, pin: '2468' }]);
  });

  it('manager approves a price change: the menu route saves it (and only then)', async () => {
    const { proposePriceChange } = await import('../lib/foodhub/assistant/proposals');
    const out = await proposePriceChange({ brand: BRAND, item: 'it-fries', platforms: ['skip'], new_price: 4.75 }, { actor: MGR, chatId: null });
    if (!out.ok) throw new Error(out.error);
    expect((await getRepo().getMenu(BRAND))?.items.find((i) => i.ref === 'it-fries')?.channelPrices?.skip).toBeUndefined();
    const { POST } = await import('../app/api/foodhub/assistant/proposals/[id]/route');
    const res = await POST(post(`/api/foodhub/assistant/proposals/${out.proposal.id}`, 'as_mgr', { decision: 'approve' }), ctx(out.proposal.id));
    expect(res.status).toBe(200);
    const saved = (await getRepo().getMenu(BRAND))?.items.find((i) => i.ref === 'it-fries');
    expect(saved?.channelPrices?.skip).toBe(4.75);
    expect(saved?.price).toBe(4);
  });

  it('only the author decides; Dismiss changes nothing', async () => {
    const { proposePrepTime } = await import('../lib/foodhub/assistant/proposals');
    const { decideProposal } = await import('../lib/foodhub/assistant/approve');
    const out = await proposePrepTime({ location: 'HOCHELAGA', normal: 22 }, { actor: MGR, chatId: null });
    if (!out.ok) throw new Error(out.error);
    const req = new Request('http://hub.local/x', { method: 'POST', headers: basic('as_op') });
    expect((await decideProposal(req, OP, out.proposal.id, 'approve')).status).toBe(404);
    const dismissed = await decideProposal(new Request('http://hub.local/x', { method: 'POST', headers: basic('as_mgr') }), MGR, out.proposal.id, 'dismiss');
    expect((await dismissed.json()).proposal.status).toBe('dismissed');
    const { getPrepSettings } = await import('../lib/foodhub/prep');
    expect((await getPrepSettings()).HOCHELAGA?.normal).not.toBe(22);
  });

  it('a campaign card saves a draft only: nothing sent, no money', async () => {
    const { proposeCampaign } = await import('../lib/foodhub/assistant/proposals');
    const { decideProposal } = await import('../lib/foodhub/assistant/approve');
    const { listCampaignDrafts } = await import('../lib/foodhub/assistant/campaign-drafts');
    const out = await proposeCampaign({ brand: BRAND, platform: 'uber_eats', title: 'Midi', offer: '15 % sur 30 $+', message: 'Le midi, 15 % de rabais.', daily_budget: 1 }, { actor: MGR, chatId: null });
    if (!out.ok) throw new Error(out.error);
    const res = await decideProposal(new Request('http://hub.local/x', { method: 'POST', headers: basic('as_mgr') }), MGR, out.proposal.id, 'approve');
    expect(res.status).toBe(200);
    expect((await listCampaignDrafts())[0]).toMatchObject({ brand: BRAND, platform: 'uber_eats', status: 'draft', via: 'assistant' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Po Poulet NDG (DoorDash 27982486) is never touched', () => {
  it('a pause of the protected store is refused before any card', async () => {
    const { proposeStoreStatus } = await import('../lib/foodhub/assistant/proposals');
    expect(await proposeStoreStatus({ store_ids: [poPouletDd.id], online: false }, { actor: MGR, chatId: null })).toMatchObject({ ok: false, refused: 'protected' });
    expect(await proposeStoreStatus({ brand: 'Po Poulet', location: 'NDG_MAIN', platforms: ['doordash'], online: false }, { actor: MGR, chatId: null })).toMatchObject({ ok: false, refused: 'protected' });
    // The DoorDash number itself, anywhere in the request.
    expect(await proposeStoreStatus({ store_ids: ['27982486'], online: true }, { actor: MGR, chatId: null })).toMatchObject({ ok: false, refused: 'protected' });
  });

  it('pausing a whole kitchen leaves the protected store out and says so', async () => {
    const { proposeStoreStatus } = await import('../lib/foodhub/assistant/proposals');
    const out = await proposeStoreStatus({ location: 'NDG_MAIN', online: false, minutes: 15 }, { actor: MGR, chatId: null });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.proposal.changes.some((c) => c.fr === 'Po Poulet')).toBe(false);
    expect(out.proposal.notesEn.join(' ')).toMatch(/Po Poulet NDG \(DoorDash\) is protected/);
  });

  it('an 86 or a DoorDash price for Po Poulet that reaches NDG is refused; Uber Eats elsewhere still works', async () => {
    const { proposeItemAvailability, proposePriceChange, proposeCampaign } = await import('../lib/foodhub/assistant/proposals');
    expect(await proposeItemAvailability({ brand: 'Po Poulet', items: ['Fries'], available: false }, { actor: MGR, chatId: null })).toMatchObject({ ok: false, refused: 'protected' });
    expect(await proposeItemAvailability({ brand: 'Po Poulet', items: ['Fries'], available: false, location: 'NDG_MAIN' }, { actor: MGR, chatId: null })).toMatchObject({ ok: false, refused: 'protected' });
    expect((await proposeItemAvailability({ brand: 'Po Poulet', items: ['Fries'], available: false, location: 'HOCHELAGA' }, { actor: MGR, chatId: null })).ok).toBe(true);
    expect(await proposePriceChange({ brand: 'Po Poulet', item: 'Fries', platforms: ['doordash'], new_price: 5 }, { actor: MGR, chatId: null })).toMatchObject({ ok: false, refused: 'protected' });
    const mixed = await proposePriceChange({ brand: 'Po Poulet', item: 'Fries', platforms: ['uber_eats', 'doordash'], new_price: 5 }, { actor: MGR, chatId: null });
    expect(mixed.ok).toBe(true);
    if (mixed.ok) {
      expect(mixed.proposal.changes.map((c) => c.whereEn)).toEqual(['Uber Eats · Po Poulet']);
      expect(mixed.proposal.notesEn[0]).toMatch(/DoorDash left out/);
    }
    expect(await proposeCampaign({ brand: 'Po Poulet', platform: 'doordash', title: 'x', offer: 'y', message: 'z' }, { actor: MGR, chatId: null })).toMatchObject({ ok: false, refused: 'protected' });
    expect(poPouletUberHoch.channel).toBe('uber_eats');
  });

  it('checked again at Approve time: a store that became the protected one is refused (403), nothing runs', async () => {
    const repo = getRepo();
    const s = await repo.upsertStore({ channel: 'doordash', channelStoreId: 'dd-assist-later', brandName: BRAND, locationCode: 'HOCHELAGA', autoAccept: true, online: true, meta: {} });
    const { proposeStoreStatus } = await import('../lib/foodhub/assistant/proposals');
    const { decideProposal } = await import('../lib/foodhub/assistant/approve');
    const out = await proposeStoreStatus({ store_ids: [s.id], online: false }, { actor: MGR, chatId: null });
    if (!out.ok) throw new Error(out.error);
    await repo.updateStore(s.id, { meta: { platformStoreId: '27982486' } });
    const call = vi.fn();
    const res = await decideProposal(new Request('http://hub.local/x', { method: 'POST', headers: basic('as_mgr') }), MGR, out.proposal.id, 'approve', call);
    expect(res.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });
});

describe('page snapshot and built-in suggestions (no API key)', () => {
  it('maps routes to pages and keeps only console paths', async () => {
    const { pageOf, cleanRoute } = await import('../lib/foodhub/assistant/snapshot');
    expect(pageOf('/')).toBe('home');
    expect(pageOf('/menu/86')).toBe('menu86');
    expect(pageOf('/insights/reviews?x=1')).toBe('reviews');
    expect(pageOf('/settings/autopilot')).toBe('autopilot');
    expect(pageOf('/kitchen')).toBe('kitchen');
    expect(cleanRoute('https://evil.example/x')).toBe('/');
    expect(cleanRoute('/orders/')).toBe('/orders');
  });

  it('a paused store shows up as a signal with an « Examiner » question, and the brief has 3–4 steps', async () => {
    const { buildPageSnapshot } = await import('../lib/foodhub/assistant/snapshot');
    const { ruleBrief } = await import('../lib/foodhub/assistant/suggest');
    const repo = getRepo();
    const paused = await repo.upsertStore({ channel: 'skip', channelStoreId: 'skip-assist-paused', brandName: BRAND, locationCode: 'SAINT_LEONARD', autoAccept: true, online: false, meta: {} });
    const snap = await buildPageSnapshot('/stores', MGR);
    expect(snap.page).toBe('stores');
    expect(snap.numbers.storesPaused).toBeGreaterThan(0);
    expect(snap.lists.storesNotOnline?.some((s) => s.storeId === paused.id)).toBe(true);
    const brief = ruleBrief(snap);
    expect(brief.source).toBe('rules');
    expect(brief.signals.some((s) => s.id === 'store_paused' || s.id === 'store_deactivated')).toBe(true);
    expect(brief.steps.length).toBeGreaterThanOrEqual(3);
    expect(brief.steps.length).toBeLessThanOrEqual(4);
    expect(brief.summaryFr).toMatch(/Magasins :/);
    expect(brief.summaryEn).toMatch(/Stores:/);
  });

  it('the kitchen screen gets no summary steps and no nudges', async () => {
    const { buildPageSnapshot } = await import('../lib/foodhub/assistant/snapshot');
    const { ruleBrief } = await import('../lib/foodhub/assistant/suggest');
    const snap = await buildPageSnapshot('/kitchen', MGR);
    expect(snap.signals).toEqual([]);
    expect(ruleBrief(snap).steps).toEqual([]);
  });

  it('page extras from the browser are cleaned (short scalars only)', async () => {
    const { cleanExtra } = await import('../lib/foodhub/assistant/snapshot');
    expect(cleanExtra({ brand: 'Pi Pita', days: 7, ok: true, nested: { a: 1 }, 'bad key': 1, long: 'x'.repeat(500) })).toEqual({ brand: 'Pi Pita', days: 7, ok: true, long: 'x'.repeat(120) });
    expect(cleanExtra(['a'])).toBeUndefined();
  });
});
