// Sales rung up on the restaurant's own Clover register → Takatak MEV (QCMEV) invoices. Off unless
// FOODHUB_MEV_CLOVER_REGISTER=on, and then only for kitchens that pass the usual MEV gate (FOODHUB_MEV, the owner switch,
// FOODHUB_MEV_LOCATIONS, system of record « qcmev »). See docs/MEV_INTEGRATION.md § Clover register.
//
// Which Clover orders: the ones Food Hub does not already invoice another way — not Food Hub's own (platform orders it
// pushed to Clover, its phone / website orders), not a delivery platform's, not an online order (Clover Online Ordering,
// the brand's website). What is left is what staff rang up at the register.
//
// When: once Clover says the order is paid. A refund of the whole order (or a void, or a deletion) → a full credit note;
// items refunded in Clover → credit note + corrected receipt; a refund by an amount only → the corrected receipt waits
// for a person (the invoice would have to invent which items). All of it through the same outbox and reconciliation as
// every other Food Hub sale (hooks.ts), so a retry never makes a second invoice.
//
// Where the record lives: one small KV document per Clover order (`mev_pos:<id>`), read only by the MEV pipeline. It is
// not a Food Hub order: it never reaches the kitchen screen, the courier dispatch or Food Hub's sales reports (Clover
// already counts these sales).
//
// Sources: Clover's Orders webhook (instant) and a catch-up poller over orders modified since the last run (a missed
// webhook, a restart): every register sale is found again within a few minutes, never twice (one id per Clover order).
import { logActivity } from '../activity';
import { getCatalog } from '../catalog';
import { nowIso } from '../config';
import { getRepo } from '../repo';
import { allCloverMerchants, cloverToken } from '../pos/clover';
import {
  classifyCloverOrder, cloverGet, cloverLines, isSiteWebMarked, knownFoodHubCloverIds, labelMaps, ONLINE_TYPE, perMerchant, readCloverOrderState,
} from '../pos/clover-website-orders';
import type { RegisterSale } from './types';

const on = (v: unknown) => /^(on|true|1|yes)$/i.test(String(v ?? '').trim());

/** On only with FOODHUB_MEV_CLOVER_REGISTER=on (default off: nothing is read, nothing changes). */
export function cloverRegisterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return on(env.FOODHUB_MEV_CLOVER_REGISTER);
}

const KV = (id: string) => `mev_pos:${id}`;
const SINCE_KEY = (mid: string) => `mev_pos_since:${mid}`;
const TICK_KEY = 'mev_pos_tick';
const UNPLACED_KEY = (mid: string) => `mev_pos_unplaced:${mid}`;
const FIRST_LOOKBACK_MS = 6 * 3600_000;
const OVERLAP_MS = 2 * 60_000;
const PAGE = 100;
const MAX_PAGES = 10;
const EXPAND_FULL = 'lineItems,lineItems.modifications,lineItems.discounts,payments,payments.tender,refunds,orderType,discounts,serviceCharge';
const EXPAND_BASIC = 'lineItems,payments,refunds,orderType,discounts';

export function registerSaleId(mid: string, cloverOrderId: string): string {
  return `pos_${String(mid).replace(/[^A-Za-z0-9]/g, '')}_${String(cloverOrderId).replace(/[^A-Za-z0-9]/g, '')}`;
}

export async function getRegisterSale(id: string): Promise<RegisterSale | null> {
  return getRepo().getKv<RegisterSale>(KV(id)).catch(() => null);
}

export async function saveRegisterSale(r: RegisterSale): Promise<RegisterSale> {
  const next = { ...r, updatedAt: nowIso() };
  await getRepo().setKv(KV(r.id), next);
  return next;
}

function pollMs(): number {
  const n = Number(process.env.FOODHUB_MEV_CLOVER_REGISTER_POLL_S ?? 60);
  return (Number.isFinite(n) && n >= 15 ? n : 60) * 1000;
}

/** Order types that mean table service (TBL): FOODHUB_MEV_REGISTER_TABLE_TYPES (comma list of labels), else the default. */
export function registerTableTypes(env: NodeJS.ProcessEnv = process.env): RegExp | undefined {
  const list = String(env.FOODHUB_MEV_REGISTER_TABLE_TYPES ?? '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!list.length) return undefined;
  return new RegExp(`^(${list.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'i');
}

/**
 * The kitchen whose SEV device numbers this merchant's register sales. Never guessed (a sale numbered on the wrong
 * device is a wrong fiscal record): FOODHUB_MEV_REGISTER_LOCATION (one code, or JSON per merchant), else the one
 * kitchen whose stores use this Clover merchant. Several kitchens and no setting → null.
 */
export async function registerPlace(mid: string): Promise<{ locationCode: string; brandName?: string } | null> {
  const catalog = await getCatalog();
  const valid = new Set(catalog.locations.map((l) => l.code));
  const stores = await getRepo().listStores();
  const def = process.env.CLOVER_MERCHANT_ID;
  const pinned = perMerchant('FOODHUB_MEV_REGISTER_LOCATION', mid);
  const locs = [...new Set(stores.filter((s) => (s.cloverMerchantId || def) === mid).map((s) => s.locationCode))].filter((c) => valid.has(c));
  const locationCode = pinned && valid.has(pinned) ? pinned : locs.length === 1 ? locs[0] : null;
  if (!locationCode) return null;
  const brands = [...new Set(stores.filter((s) => s.locationCode === locationCode).map((s) => s.brandName))];
  return { locationCode, ...(brands.length === 1 ? { brandName: brands[0] } : {}) };
}

/** True for an order Clover took online (Clover Online Ordering, the brand's website): invoiced as an online sale, never here. */
function isOnlineOrder(co: any, orderTypes: Map<string, string>): boolean {
  const id = String(co?.orderType?.id ?? '');
  const label = String(co?.orderType?.label ?? orderTypes.get(id) ?? '');
  return ONLINE_TYPE.test(label) || isSiteWebMarked(co);
}

/** Is this Clover order a sale rung up at the register (nothing else in Food Hub invoices it)? */
export function isRegisterOrder(co: any, ctx: { orderTypes: Map<string, string>; tenders: Map<string, string>; known?: Set<string> }): boolean {
  if (classifyCloverOrder(co, ctx) !== 'other') return false;
  return !isOnlineOrder(co, ctx.orderTypes);
}

const sumOf = (rows: any[], f: string) => rows.reduce((s, r) => s + (Number(r?.[f]) || 0), 0);

/**
 * Clover order JSON → the register sale's facts (pure: unit-tested). Money from Clover's payments and refunds, in cents:
 * the payment `amount` is taxes included without the tip, `taxAmount` its tax, `tipAmount` the tip; a refund carries
 * the same three.
 */
export function registerFacts(co: any, orderTypes: Map<string, string> = new Map()): Omit<RegisterSale, 'id' | 'merchantId' | 'locationCode' | 'brandName' | 'createdAt' | 'updatedAt' | 'mev'> {
  const state = readCloverOrderState(co);
  const payments: any[] = (co?.payments?.elements ?? []).filter((p: any) => !/VOID|FAIL/i.test(String(p?.result ?? '')));
  const refunds: any[] = co?.refunds?.elements ?? [];
  const items: any[] = co?.lineItems?.elements ?? [];
  const lineRefunded = items.some((li) => li?.refunded === true);
  const paidAt = payments.map((p) => Number(p?.createdTime) || 0).filter(Boolean);
  const typeId = String(co?.orderType?.id ?? '');
  return {
    cloverOrderId: String(co?.id ?? ''),
    ...(co?.title ? { title: String(co.title).slice(0, 60) } : {}),
    lines: cloverLines(co).map((l) => ({
      ...(l.externalId ? { externalId: l.externalId } : {}),
      ...(l.posItemRef ? { posItemRef: l.posItemRef } : {}),
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      total: l.total,
      ...(l.modifiers?.length ? { modifiers: l.modifiers.map((m) => ({ name: m.name, quantity: m.quantity ?? 1, unitPrice: m.unitPrice })) } : {}),
    })),
    totalCents: sumOf(payments, 'amount') - sumOf(refunds, 'amount'),
    taxCents: sumOf(payments, 'taxAmount') - sumOf(refunds, 'taxAmount'),
    tipCents: sumOf(payments, 'tipAmount') - sumOf(refunds, 'tipAmount'),
    hasDiscount: (co?.discounts?.elements?.length ?? 0) > 0 || items.some((li) => (li?.discounts?.elements?.length ?? 0) > 0),
    // Clover gives a service charge as a percentage, not an amount: the sale then waits for a person (amounts differ).
    serviceChargeCents: 0,
    tenders: payments.map((p) => String(p?.tender?.label ?? p?.tender?.labelKey ?? '').trim()).filter(Boolean),
    ...(co?.orderType?.label || orderTypes.get(typeId) ? { orderTypeLabel: String(co?.orderType?.label ?? orderTypes.get(typeId)) } : {}),
    paid: state.paid,
    refunded: state.refunded || state.gone,
    partlyRefundedByAmount: state.partlyRefunded && !lineRefunded,
    paidAtMs: paidAt.length ? Math.max(...paidAt) : null,
  };
}

async function readOrder(mid: string, token: string, id: string): Promise<any | null | undefined> {
  let r = await cloverGet(mid, token, `orders/${encodeURIComponent(id)}`, { expand: EXPAND_FULL }).catch(() => null);
  if (r?.status === 400) r = await cloverGet(mid, token, `orders/${encodeURIComponent(id)}`, { expand: EXPAND_BASIC }).catch(() => null);
  if (!r) return undefined;
  if (r.status === 404) return null;
  return r.status >= 200 && r.status < 300 ? r.json : undefined;
}

async function warnUnplaced(mid: string) {
  const repo = getRepo();
  const last = await repo.getKv<number>(UNPLACED_KEY(mid)).catch(() => null);
  if (last && Date.now() - last < 3600_000) return;
  await repo.setKv(UNPLACED_KEY(mid), Date.now());
  await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'settings', action: 'mev_register_unplaced', status: 'failed',
    summary: `Clover register sales of merchant ${mid} are NOT invoiced: Food Hub cannot tell which kitchen's SEV device numbers them. Set FOODHUB_MEV_REGISTER_LOCATION.` });
}

/**
 * One Clover order seen (webhook or poller): keeps the register sale's record up to date and asks the MEV pipeline to
 * reconcile it. An unpaid order is not a sale yet (an open tab): nothing is kept until it is paid. Returns the record.
 */
export async function ingestRegisterOrder(mid: string, co: any | null, opts: { cloverOrderId?: string; orderTypes?: Map<string, string> } = {}): Promise<RegisterSale | null> {
  const cloverOrderId = String(co?.id ?? opts.cloverOrderId ?? '');
  if (!cloverOrderId) return null;
  const id = registerSaleId(mid, cloverOrderId);
  const existing = await getRegisterSale(id);
  if (co === null) {
    // Deleted in Clover: a recorded sale is credited; an order never paid was never a sale.
    if (!existing || existing.refunded) return existing;
    const saved = await saveRegisterSale({ ...existing, refunded: true });
    await replan(saved.id);
    return saved;
  }
  const facts = registerFacts(co, opts.orderTypes);
  if (!existing && (!facts.paid || facts.refunded)) return null;
  const place = existing ? { locationCode: existing.locationCode, brandName: existing.brandName } : await registerPlace(mid);
  if (!place) {
    await warnUnplaced(mid);
    return null;
  }
  const at = nowIso();
  const next: RegisterSale = {
    ...(existing ?? { createdAt: at }),
    ...facts,
    id, merchantId: mid, locationCode: place.locationCode, ...(place.brandName ? { brandName: place.brandName } : {}),
    // Once paid, a sale stays a sale (Clover never "unpays"; a refund says refunded).
    paid: facts.paid || Boolean(existing?.paid),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    ...(existing?.mev ? { mev: existing.mev } : {}),
  };
  const saved = await saveRegisterSale(next);
  await replan(saved.id);
  return saved;
}

async function replan(id: string) {
  const { mevOnRegisterChange } = await import('./hooks');
  await mevOnRegisterChange({ id });
}

// ---------------------------------------------------------------- webhook

/** Orders already seen that are not register sales (no second Clover read for their updates). */
const NOT_REGISTER = new Map<string, number>();
const NOT_REGISTER_TTL_MS = 30 * 60_000;

/**
 * Clover webhook, Orders events: { merchants: { MID: [{ objectId: "O:<orderId>", type: "CREATE" | "UPDATE" | "DELETE" }] } }.
 * Food Hub's existing Clover webhook calls this too; it does nothing unless FOODHUB_MEV_CLOVER_REGISTER=on.
 */
export async function handleCloverRegisterEvents(body: any, now = Date.now()): Promise<{ events: number; recorded: number }> {
  const out = { events: 0, recorded: 0 };
  if (!cloverRegisterEnabled()) return out;
  const { mevMode } = await import('./config');
  if (mevMode() === 'off') return out;
  for (const [mid, list] of Object.entries((body?.merchants ?? {}) as Record<string, any[]>)) {
    const byId = new Map<string, string>();
    for (const e of Array.isArray(list) ? list : []) {
      const [kind, oid] = String(e?.objectId ?? '').split(':');
      if (kind !== 'O' || !oid) continue;
      const type = String(e?.type ?? '').toUpperCase();
      if (byId.get(oid) === 'DELETE') continue;
      byId.set(oid, type);
    }
    if (!byId.size) continue;
    out.events += byId.size;
    const token = await cloverToken(mid);
    if (!token) continue;
    let maps: Awaited<ReturnType<typeof labelMaps>> | null = null;
    let known: Set<string> | null = null;
    for (const [oid, type] of byId) {
      const id = registerSaleId(mid, oid);
      if (!(await getRegisterSale(id)) && (NOT_REGISTER.get(oid) ?? 0) > now) continue;
      const co = type === 'DELETE' ? null : await readOrder(mid, token, oid);
      if (co === undefined) continue;
      if (co) {
        maps ??= await labelMaps(mid, token);
        known ??= await knownFoodHubCloverIds(now);
        if (!(await getRegisterSale(id)) && !isRegisterOrder(co, { ...maps, known })) {
          if (co?.orderType?.id || readCloverOrderState(co).paid) NOT_REGISTER.set(oid, now + NOT_REGISTER_TTL_MS);
          continue;
        }
      }
      if (await ingestRegisterOrder(mid, co, { cloverOrderId: oid, orderTypes: maps?.orderTypes })) out.recorded++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- catch-up poller

/** Orders of one merchant modified since the last run: every register sale is found again, even after a missed webhook. */
export async function pollCloverRegister(mid: string, now = Date.now()): Promise<{ recorded: number; error?: string }> {
  const out = { recorded: 0 };
  const token = await cloverToken(mid);
  if (!token) return { ...out, error: `No Clover API token for merchant ${mid}` };
  const repo = getRepo();
  const since = Math.max((await repo.getKv<number>(SINCE_KEY(mid))) ?? 0, now - FIRST_LOOKBACK_MS);
  try {
    const maps = await labelMaps(mid, token);
    const known = await knownFoodHubCloverIds(now);
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = (expand: string) => ({ filter: `modifiedTime>=${since}`, expand, limit: String(PAGE), offset: String(page * PAGE) });
      let r = await cloverGet(mid, token, 'orders', qs(EXPAND_FULL));
      if (r.status === 400) r = await cloverGet(mid, token, 'orders', qs(EXPAND_BASIC));
      if (r.status < 200 || r.status >= 300) throw new Error(`Clover orders HTTP ${r.status}`);
      const rows: any[] = Array.isArray(r.json?.elements) ? r.json.elements : [];
      for (const co of rows) {
        if (!co?.id) continue;
        const existing = await getRegisterSale(registerSaleId(mid, String(co.id)));
        if (!existing && !isRegisterOrder(co, { ...maps, known })) continue;
        if (await ingestRegisterOrder(mid, co, { orderTypes: maps.orderTypes })) out.recorded++;
      }
      if (rows.length < PAGE) break;
    }
    await repo.setKv(SINCE_KEY(mid), now - OVERLAP_MS);
    return out;
  } catch (error) {
    return { ...out, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Heartbeat (live pulse, cron): at most every FOODHUB_MEV_CLOVER_REGISTER_POLL_S (60 s), one run at a time. Never throws. */
export async function tickCloverRegister(now = Date.now()): Promise<{ ran: boolean; recorded?: number }> {
  if (!cloverRegisterEnabled()) return { ran: false };
  const g = globalThis as { __foodhubRegisterTick?: boolean };
  if (g.__foodhubRegisterTick) return { ran: false };
  g.__foodhubRegisterTick = true;
  try {
    const { mevMode } = await import('./config');
    if (mevMode() === 'off') return { ran: false };
    const repo = getRepo();
    const last = await repo.getKv<number>(TICK_KEY).catch(() => null);
    if (last && now - last < pollMs()) return { ran: false };
    await repo.setKv(TICK_KEY, now);
    let recorded = 0;
    for (const mid of await allCloverMerchants((await repo.listStores()).map((s) => s.cloverMerchantId))) {
      const r = await pollCloverRegister(mid, now);
      recorded += r.recorded;
      if (r.error) console.error('[foodhub] Clover register poll', mid, r.error);
    }
    return { ran: true, recorded };
  } catch (e) {
    console.error('[foodhub] Clover register tick failed', e instanceof Error ? e.message : e);
    return { ran: false };
  } finally {
    g.__foodhubRegisterTick = false;
  }
}
