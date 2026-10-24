// Where orders meet Takatak MEV (QCMEV). One call per order change, from the few places every change goes through:
//   platform orders  clover-settle.ts settleInClover (every status change: actions, platform statuses, couriers,
//                    auto-complete), pipeline.ts autoAcceptAfterClover, the DoorDash adjustment, the Skip final order,
//                    the Skip tablet route, missing items / price changes, and Clover's own platform orders
//   own orders       delivery/store.ts addDirectEvent (every event of a direct order: paid, picked up, cancelled…)
//
// It never blocks or slows an order: with FOODHUB_MEV=off it returns before reading anything, and otherwise it only
// writes the outbox (outbox.ts) and starts the send in the background. The rule is a reconciliation, so calling it
// twice is harmless:
//   final (accepted / paid)          → one sale (receipt) per order
//   cancelled after the receipt      → a full credit note
//   content changed after receipt    → credit note + a corrected receipt that names the one it replaces
//   cancelled before it was sent     → the sale is dropped (skipped), nothing reaches QCMEV
import { CHANNEL_LABELS, nowIso } from '../config';
import { dryRun } from '../dry-run';
import type { Actor } from '../activity';
import type { DirectOrder } from '../delivery/types';
import { getRepo } from '../repo';
import { tenantId } from '../tenant';
import type { OrderLine, StoredOrder } from '../types';
import { mevGate, mevMode, mevTrigger } from './config';
import {
  changeReason, creditFor, creditKeyFor, directChannel, directIsFinal, isoWithOffset, paidOnline, printFor, printKeyFor, reissueKeyFor, saleKeyFor, storedChannel,
  storedExclusion, storedIsFinal, tenderMode, toMevSaleFromDirect, toMevSaleFromStored, type MapCtx, type MapResult,
} from './map';
import { jobIdFor, jobsFor, kickMevOutbox, putJob, syncOrderMev } from './outbox';
import type { FoodHubSaleV1, MevCreditReason, MevJob, MevMode, MevPayMode, MevTaxCode } from './types';

type Ref = MevJob['order'];

// One plan at a time per order on this server (a webhook and a click can meet).
const chains = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  chains.set(key, next);
  void next.finally(() => { if (chains.get(key) === next) chains.delete(key); }).catch(() => undefined);
  return next;
}

const userMode = (): 'auto' | 'staff' => (String(process.env.FOODHUB_MEV_USER ?? '').trim().toLowerCase() === 'staff' ? 'staff' : 'auto');

/** Line tax codes from the brand's menu (MenuItem.mevTax; FP by default). */
async function taxResolver(brandName?: string | null): Promise<((l: OrderLine) => MevTaxCode | undefined) | undefined> {
  if (!brandName) return undefined;
  const menu = await getRepo().getMenu(brandName).catch(() => null);
  const byRef = new Map<string, MevTaxCode>();
  for (const it of menu?.items ?? []) {
    if (!it.mevTax) continue;
    byRef.set(it.ref, it.mevTax);
    if (it.posItemRef) byRef.set(it.posItemRef, it.mevTax);
  }
  if (!byRef.size) return undefined;
  return (l) => byRef.get(l.posItemRef ?? '') ?? byRef.get(l.externalId ?? '');
}

async function barPermitAt(locationCode: string): Promise<boolean> {
  const { getAlcoholSettings } = await import('../alcohol/rules');
  const s = await getAlcoholSettings().catch(() => null);
  return s?.locations[locationCode]?.permitType === 'bar';
}

interface Plan {
  ref: Ref;
  baseKey: string;
  mode: Exclude<MevMode, 'off'>;
  cancelled: boolean;
  final: boolean;
  cancelReason: MevCreditReason;
  changeReason: MevCreditReason;
  map: (extra: Partial<MapCtx>) => MapResult;
  /** Own orders paid at the counter with an unknown tender: the sale is written, but waits (never sent like that). */
  placeholder?: (extra: Partial<MapCtx>) => MapResult;
}

const neverSent = (j: MevJob) => !j.shadow && j.status === 'pending' && j.attempts === 0;
const isCurrent = (j: MevJob) => j.kind === 'sale' && !j.creditedBy && (j.status !== 'skipped' || Boolean(j.shadow));

function newJob(p: Plan, kind: MevJob['kind'], key: string, payload: MevJob['payload'], extra: Partial<MevJob> = {}): MevJob {
  const at = nowIso();
  const shadow = p.mode === 'shadow';
  return {
    id: jobIdFor(key), key, kind, baseKey: p.baseKey, saleKey: key, order: p.ref, status: shadow ? 'skipped' : 'pending', payload, payloadHash: payload.payloadHash,
    attempts: 0, nextAt: null, ...(shadow ? { shadow: true } : {}), createdAt: at, updatedAt: at, ...extra,
  };
}

/** The reconciliation itself. Returns the jobs it wrote (tests). */
async function reconcile(p: Plan): Promise<MevJob[]> {
  const jobs = await jobsFor(p.baseKey);
  const sales = jobs.filter((j) => j.kind === 'sale');
  const current = [...sales].reverse().find(isCurrent);
  const now = Date.now();
  const writes: MevJob[] = [];

  if (p.cancelled) {
    if (current) {
      if (neverSent(current) || (current.status === 'needs_human' && !current.result)) {
        // Never reached QCMEV: nothing to credit.
        writes.push({ ...current, status: 'skipped', wait: undefined, nextAt: null, lastError: 'Cancelled before the invoice was issued' });
      } else {
        const ck = creditKeyFor(current.key, 1);
        writes.push(newJob(p, 'credit', ck, creditFor(current.payload as FoodHubSaleV1, ck, p.cancelReason, now), { saleKey: current.key, dependsOn: current.key }));
        writes.push({ ...current, creditedBy: ck });
      }
    }
  } else if (p.final) {
    if (!current) {
      const lastCredited = [...sales].reverse().find((j) => j.creditedBy);
      const key = sales.length ? reissueKeyFor(p.baseKey, sales.length) : p.baseKey;
      const extra: Partial<MapCtx> = { saleKey: key, ...(lastCredited ? { replacesSaleKey: lastCredited.key, occurredAt: isoWithOffset(now) } : {}) };
      let m = p.map(extra);
      let wait: MevJob['wait'];
      if (!m.ok && m.reason === 'tender_unknown' && p.placeholder) { m = p.placeholder(extra); wait = 'tender_unknown'; }
      if (m.ok) writes.push(newJob(p, 'sale', key, m.sale, { contentHash: m.contentHash, ...(lastCredited?.creditedBy ? { dependsOn: lastCredited.creditedBy } : {}), ...(wait && p.mode !== 'shadow' ? { wait } : {}) }));
    } else {
      const sale = current.payload as FoodHubSaleV1;
      const m = p.map({ saleKey: current.key, occurredAt: sale.occurredAt, ...(sale.replacesSaleKey ? { replacesSaleKey: sale.replacesSaleKey } : {}) });
      if (m.ok) {
        // The tender is known now: the sale may go at once.
        const clearWait = current.wait === 'tender_unknown' && m.ok ? { wait: undefined, nextAt: null } : {};
        if (m.contentHash === current.contentHash) {
          // Same receipt content: an unsent job may still take the newer details (Clover id, the tender just read).
          if (m.sale.payloadHash !== current.payloadHash && neverSent(current)) writes.push({ ...current, payload: m.sale, payloadHash: m.sale.payloadHash, ...clearWait });
        } else if (neverSent(current)) {
          writes.push({ ...current, payload: m.sale, payloadHash: m.sale.payloadHash, contentHash: m.contentHash, ...clearWait });
        } else if (current.status === 'done' || current.status === 'sending' || current.shadow || (current.status === 'pending' && current.attempts > 0)) {
          // Issued (or maybe issued): full credit note, then the corrected receipt that names the one it replaces.
          const ck = creditKeyFor(current.key, 1);
          const rk = reissueKeyFor(p.baseKey, sales.length);
          const re = p.map({ saleKey: rk, replacesSaleKey: current.key, occurredAt: isoWithOffset(now) });
          if (re.ok) {
            writes.push(newJob(p, 'credit', ck, creditFor(sale, ck, p.changeReason, now), { saleKey: current.key, dependsOn: current.key }));
            writes.push({ ...current, creditedBy: ck });
            writes.push(newJob(p, 'sale', rk, re.sale, { contentHash: re.contentHash, dependsOn: ck }));
          }
        }
        // needs_human: a person decides (Replay); nothing is changed under them.
      }
    }
  }
  for (const w of writes) await putJob(w);
  if (writes.length) {
    await syncOrderMev(p.ref, p.baseKey);
    if (p.mode !== 'shadow') kickMevOutbox(p.baseKey);
  }
  return writes;
}

// ---------- platform orders ----------

export function storedRef(o: StoredOrder): Ref {
  return { model: 'stored', id: o.id, locationCode: o.locationCode ?? '', label: `${CHANNEL_LABELS[o.channel]} #${o.displayId || o.externalOrderId.slice(0, 8)}` };
}

export function storedBaseKey(o: Pick<StoredOrder, 'channel' | 'viaHub' | 'externalOrderId'>, tenant = tenantId()): string {
  return saleKeyFor(tenant, 'stored', storedChannel(o), o.externalOrderId);
}

async function planStored(id: string): Promise<MevJob[]> {
  const repo = getRepo();
  const o = await repo.getOrder(id);
  if (!o) return [];
  const gate = await mevGate(o.locationCode);
  if (!gate.active) return [];
  const tenant = tenantId();
  const trigger = mevTrigger();
  const baseKey = storedBaseKey(o, tenant);
  const ex = storedExclusion(o, { dryRun: Boolean(dryRun()) && gate.mode !== 'simulator' });
  if (ex) {
    if (!o.timeline?.mev) await repo.patchOrder(o.id, { mev: { status: 'skipped', reason: ex, saleKey: baseKey, updatedAt: nowIso() } });
    return [];
  }
  const ctx: MapCtx = { tenantId: tenant, testMode: gate.mode !== 'on', trigger, taxCodeOf: await taxResolver(o.brandName), userMode: userMode() };
  return reconcile({
    ref: storedRef(o), baseKey, mode: gate.mode, cancelled: o.status === 'cancelled', final: storedIsFinal(o, trigger), cancelReason: 'cancelled', changeReason: changeReason(o),
    map: (extra) => toMevSaleFromStored(o, { ...ctx, ...extra }),
  });
}

/** After any change to a platform order. Never throws, never slows the order: off = returns at once. */
export async function mevOnOrderChange(order: Pick<StoredOrder, 'id'> | null | undefined): Promise<void> {
  if (!order || mevMode() === 'off') return;
  try {
    await serialize(`stored:${order.id}`, () => planStored(order.id));
  } catch (e) {
    console.error('[foodhub] MEV plan failed', e instanceof Error ? e.message : e);
  }
}

// ---------- own orders ----------

export function directRef(o: DirectOrder): Ref {
  return { model: 'direct', id: o.id, locationCode: o.locationCode, label: `${o.number} (${o.brandName})` };
}

export function directBaseKey(o: Pick<DirectOrder, 'source' | 'sourceRef' | 'id'>, tenant = tenantId()): string {
  return saleKeyFor(tenant, 'direct', directChannel(o), o.id);
}

const tenderMiss = new Map<string, number>();
/** The tender a person chose, kept apart from the order document (a writer holding an older copy cannot erase it). */
const TENDER_KV = (id: string) => `mev_tender:${id}`;

/** How a pay-at-pickup order was paid: the person's choice, else Clover's payment on the order (cached misses 60 s). */
async function tenderFor(o: DirectOrder): Promise<MevPayMode | null> {
  if (o.mev?.tender) return o.mev.tender;
  const chosen = await getRepo().getKv<MevPayMode>(TENDER_KV(o.id)).catch(() => null);
  if (chosen) return chosen;
  if (!o.posOrderId) return null;
  const miss = tenderMiss.get(o.id);
  if (miss && Date.now() - miss < 60_000) return null;
  const { cloverOrderTenders } = await import('../pos/clover-payments');
  const { explicitMerchantFor } = await import('../delivery/clover-direct');
  const { defaultCloverMerchant } = await import('../pos/clover');
  const mid = o.posMerchantId ?? o.paylink?.merchantId ?? (await explicitMerchantFor(o.brandName, o.locationCode).catch(() => null)) ?? (await defaultCloverMerchant().catch(() => null));
  const labels = await cloverOrderTenders(mid, o.posOrderId).catch(() => null);
  const mode = labels ? tenderMode(labels) : null;
  if (!mode) tenderMiss.set(o.id, Date.now());
  return mode;
}

async function planDirect(id: string): Promise<MevJob[]> {
  const { getDirectOrder } = await import('../delivery/store');
  const d = await getDirectOrder(id);
  if (!d) return [];
  const gate = await mevGate(d.locationCode);
  if (!gate.active) return [];
  if (dryRun() && gate.mode !== 'simulator') return [];
  const tenant = tenantId();
  const final = directIsFinal(d);
  const tender = final && !paidOnline(d) ? await tenderFor(d) : null;
  const ctx: MapCtx = { tenantId: tenant, testMode: gate.mode !== 'on', trigger: 'accept', taxCodeOf: await taxResolver(d.brandName), barPermit: await barPermitAt(d.locationCode), userMode: userMode() };
  return reconcile({
    ref: directRef(d), baseKey: directBaseKey(d, tenant), mode: gate.mode, cancelled: d.status === 'cancelled', final, cancelReason: d.payment === 'paid' ? 'refund' : 'cancelled', changeReason: 'adjusted',
    map: (extra) => toMevSaleFromDirect(d, { ...ctx, tender, ...extra }),
    placeholder: (extra) => toMevSaleFromDirect(d, { ...ctx, tender: 'AUC', ...extra }),
  });
}

/** After any event of a direct order. Never throws; off = returns at once. */
export async function mevOnDirectChange(order: Pick<DirectOrder, 'id'> | null | undefined): Promise<void> {
  if (!order || mevMode() === 'off') return;
  try {
    await serialize(`direct:${order.id}`, () => planDirect(order.id));
  } catch (e) {
    console.error('[foodhub] MEV plan failed', e instanceof Error ? e.message : e);
  }
}

/** The outbox asks again for an order (a tender that may be readable now). */
export async function replanOrder(ref: Pick<Ref, 'model' | 'id'>): Promise<void> {
  if (ref.model === 'stored') await mevOnOrderChange({ id: ref.id });
  else await mevOnDirectChange({ id: ref.id });
}

// ---------- staff actions ----------

async function refFor(model: 'stored' | 'direct', id: string): Promise<{ ref: Ref; baseKey: string } | null> {
  if (model === 'stored') {
    const o = await getRepo().getOrder(id);
    return o ? { ref: storedRef(o), baseKey: storedBaseKey(o) } : null;
  }
  const { getDirectOrder } = await import('../delivery/store');
  const d = await getDirectOrder(id);
  return d ? { ref: directRef(d), baseKey: directBaseKey(d) } : null;
}

/** Reprint (RPR) or merchant copy (DUP) of the current receipt: transmitted by QCMEV, printed as it answers. */
export async function requestMevPrint(model: 'stored' | 'direct', id: string, mode: 'RPR' | 'DUP', actor: Actor): Promise<{ ok: boolean; message: string; key?: string }> {
  const m = mevMode();
  if (m === 'off') return { ok: false, message: 'MEV is off (FOODHUB_MEV).' };
  const found = await refFor(model, id);
  if (!found) return { ok: false, message: 'Order not found.' };
  const gate = await mevGate(found.ref.locationCode);
  if (!gate.active) return { ok: false, message: 'This kitchen does not issue its invoices through Takatak MEV.' };
  const jobs = await jobsFor(found.baseKey);
  const current = [...jobs].reverse().find((j) => isCurrent(j) && (j.status === 'done' || j.shadow));
  if (!current) return { ok: false, message: 'No invoice issued for this order yet.' };
  const seq = jobs.filter((j) => j.kind === 'print' && (j.payload as { mode?: string }).mode === mode && j.saleKey === current.key).length + 1;
  const key = printKeyFor(current.key, mode, seq);
  const user = userMode() === 'staff' ? { id: actor.username, name: actor.name } : { id: 'FOODHUB-AUTO', name: 'FOODHUB-AUTO' };
  const p: Plan = { ref: found.ref, baseKey: found.baseKey, mode: gate.mode, cancelled: false, final: false, cancelReason: 'cancelled', changeReason: 'adjusted', map: () => ({ ok: false, reason: 'not_final' }) };
  await putJob(newJob(p, 'print', key, printFor(current.payload as FoodHubSaleV1, key, mode, user), { saleKey: current.key, dependsOn: current.key }));
  await syncOrderMev(found.ref, found.baseKey);
  if (gate.mode !== 'shadow') kickMevOutbox(found.baseKey);
  return { ok: true, message: mode === 'DUP' ? 'Merchant copy requested.' : 'Reprint requested.', key };
}

/** A person says how a pay-at-pickup order was paid (Clover's payment could not be read). */
export async function setDirectTender(id: string, tender: MevPayMode, actor: Actor): Promise<DirectOrder | null> {
  const { getDirectOrder, saveDirectOrder } = await import('../delivery/store');
  const d = await getDirectOrder(id);
  if (!d) return null;
  if (!(['ARG', 'CRE', 'DEB', 'CPR', 'MIX'] as MevPayMode[]).includes(tender)) throw new Error('tender must be ARG, CRE, DEB, CPR or MIX.');
  await getRepo().setKv(TENDER_KV(id), tender);
  tenderMiss.delete(id);
  const saved = await saveDirectOrder({ ...d, mev: { ...(d.mev ?? { status: 'pending', saleKey: directBaseKey(d), updatedAt: nowIso() }), tender, updatedAt: nowIso() } });
  const { logActivity } = await import('../activity');
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'mev_tender', status: 'info', brandName: d.brandName, locationCode: d.locationCode, summary: `${d.number}: paid by ${tender} (for the invoice)` });
  await mevOnDirectChange(saved);
  return (await getDirectOrder(id)) ?? saved;
}
