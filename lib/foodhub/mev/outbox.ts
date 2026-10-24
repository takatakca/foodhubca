// The Food Hub side of "never lose an invoice": every sale, credit note and reprint for Takatak MEV (QCMEV) is first
// written to the outbox (fh_docs collection "mev_outbox"), then sent. A time-out or a QCMEV restart only delays it: the
// same key and the same body are sent again (QCMEV replays its stored answer), so a retry never makes a second invoice.
//
//   statuses   pending → sending → done | needs_human | skipped
//   claim      random claim + re-read, 90 s expiry (same pattern as order-retry.ts): two timers never send one job twice
//   retries    FOODHUB_MEV_RETRY_S (15,60,300; the last repeats). Revenu Québec's limit is 48 h: Food Hub alerts at
//              15 min pending, critical at 24 h; QCMEV alerts on its own side at 6 h.
//   runs from  runOrderRecovery (Watchtower timer, 30 s), /api/foodhub/cron/watch, and right after a job is written.
import crypto from 'node:crypto';
import { logActivity, type Actor } from '../activity';
import { nowIso } from '../config';
import { getRepo } from '../repo';
import { tenantId } from '../tenant';
import { fetchMevHealth, mevRequest, type MevHealth, type MevOutcome } from './client';
import { healthRefusal, mevMode, mevRetryDelaysS } from './config';
import { sha256 } from './map';
import type { FoodHubCreditV1, FoodHubSaleV1, MevJob, MevOrderStatus, MevReceipt, MevRecord } from './types';

export const MEV_OUTBOX = 'mev_outbox';
export const CLAIM_MS = 90_000;
/** Look back this far for open jobs (the 48-hour legal limit, plus margin). */
const OPEN_WINDOW_MS = 4 * 86400_000;
/** How often an offline receipt is read again until MEV-WEB numbered it (FOODHUB_MEV_OFFLINE_POLL_S, default 300). */
const pollOfflineMs = () => Math.max(1, Math.min(3600, Number(process.env.FOODHUB_MEV_OFFLINE_POLL_S) || 300)) * 1000;

export const jobIdFor = (key: string) => `mev_${sha256(key).slice(0, 40)}`;

export async function getJob(id: string): Promise<MevJob | null> {
  return (await getRepo().getDoc<MevJob>(MEV_OUTBOX, id))?.data ?? null;
}

export async function putJob(job: MevJob): Promise<MevJob> {
  const next = { ...job, updatedAt: nowIso() };
  await getRepo().putDocs<MevJob>(MEV_OUTBOX, [{ id: next.id, key: next.baseKey, at: next.createdAt, data: next }]);
  return next;
}

/** Every job of one order (its base sale key), oldest first. */
export async function jobsFor(baseKey: string): Promise<MevJob[]> {
  const docs = await getRepo().listDocs<MevJob>(MEV_OUTBOX, { keys: [baseKey], limit: 200 });
  return docs.map((d) => d.data).filter((j) => j.baseKey === baseKey).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key));
}

export async function listJobs(opts: { since?: string; limit?: number } = {}): Promise<MevJob[]> {
  const docs = await getRepo().listDocs<MevJob>(MEV_OUTBOX, { since: opts.since ?? new Date(Date.now() - OPEN_WINDOW_MS).toISOString(), limit: opts.limit ?? 5000 });
  return docs.map((d) => d.data);
}

// ---------- the order's copy (order.mev) ----------

function receiptStatus(j: MevJob): MevOrderStatus {
  if (j.shadow) return 'shadow';
  if (j.status === 'skipped') return 'skipped';
  if (j.status === 'needs_human') return j.result?.status === 'rejected' ? 'rejected' : 'needs_human';
  if (j.status === 'done') return j.result?.status === 'offline_pending' ? 'offline' : 'accepted';
  return 'pending';
}

/** Only an image data URL QCMEV produced (SVG or PNG): shown in an <img>, where an SVG cannot run anything. */
export function qrImageOf(qr: MevReceipt['qr']): string | undefined {
  if (!qr) return undefined;
  if (qr.pngDataUrl && /^data:image\/png;base64,[A-Za-z0-9+/=]{20,400000}$/.test(qr.pngDataUrl)) return qr.pngDataUrl;
  if (qr.svg && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(qr.svg) && qr.svg.length < 200_000) return `data:image/svg+xml;base64,${Buffer.from(qr.svg, 'utf8').toString('base64')}`;
  return undefined;
}

/** The URL behind the QR, when it is a plain https/http link ("Consulter la transaction en ligne"). */
export function qrUrlOf(qr: MevReceipt['qr']): string | undefined {
  const c = String(qr?.content ?? '').trim();
  return /^https?:\/\/[^\s<>"']{3,1900}$/i.test(c) ? c : undefined;
}

/** order.mev from the order's jobs: the current receipt (the last sale not credited), its credit notes and prints. */
export function recordFromJobs(jobs: MevJob[], prev?: MevRecord | null): MevRecord | null {
  const sales = jobs.filter((j) => j.kind === 'sale');
  if (!sales.length) return null;
  const current = [...sales].reverse().find((j) => !j.creditedBy && (j.status !== 'skipped' || j.shadow)) ?? sales[sales.length - 1];
  const rec = current.result?.receipt;
  const anyIssued = sales.some((j) => j.status === 'done');
  const status: MevOrderStatus = current.creditedBy || (current.status === 'skipped' && anyIssued) ? 'credited' : receiptStatus(current);
  const credits = jobs.filter((j) => j.kind === 'credit');
  const prints = jobs.filter((j) => j.kind === 'print');
  return {
    status,
    saleKey: current.key,
    ...(current.wait && current.status === 'pending' ? { reason: current.wait } : current.lastError && current.status !== 'done' ? { reason: current.lastError.slice(0, 200) } : {}),
    ...(rec?.noTrans ? { noTrans: rec.noTrans } : {}),
    ...(rec?.datTrans ? { datTrans: rec.datTrans } : {}),
    ...(rec?.utc ? { utc: rec.utc } : {}),
    ...(rec?.mevTransactionNumber ? { mevNumber: rec.mevTransactionNumber } : {}),
    ...(qrImageOf(rec?.qr) ? { qrImage: qrImageOf(rec?.qr) } : {}),
    ...(qrUrlOf(rec?.qr) ? { qrUrl: qrUrlOf(rec?.qr) } : {}),
    ...(rec?.mentions ? { mentions: rec.mentions } : {}),
    ...(rec?.text80mm ? { text80mm: rec.text80mm } : {}),
    ...(rec?.renderHash ? { renderHash: rec.renderHash } : {}),
    ...(rec?.issuedAt ? { issuedAt: rec.issuedAt } : current.doneAt ? { issuedAt: current.doneAt } : {}),
    ...(prev?.token ? { token: prev.token } : {}),
    ...(prev?.tender ? { tender: prev.tender } : {}),
    ...(credits.length ? { creditNotes: credits.map((c) => ({ creditKey: c.key, reason: (c.payload as FoodHubCreditV1).reason, status: receiptStatus(c), ...(c.result?.receipt?.noTrans ? { noTrans: c.result.receipt.noTrans } : {}), at: c.doneAt ?? c.createdAt })) } : {}),
    ...(prints.length ? { prints: prints.map((p) => ({ printKey: p.key, mode: (p.payload as { mode: 'RPR' | 'DUP' }).mode, status: receiptStatus(p), ...(p.result?.receipt?.text80mm ? { text80mm: p.result.receipt.text80mm } : {}), at: p.doneAt ?? p.createdAt })) } : {}),
    updatedAt: nowIso(),
  };
}

const RECEIPT_KV = (token: string) => `mev_receipt:${token}`;

/** Writes order.mev (platform orders: in the timeline, merged safely; own orders: on the order document). */
export async function syncOrderMev(ref: MevJob['order'], baseKey: string): Promise<MevRecord | null> {
  const jobs = await jobsFor(baseKey);
  const repo = getRepo();
  if (ref.model === 'stored') {
    const o = await repo.getOrder(ref.id);
    if (!o) return null;
    const rec = recordFromJobs(jobs, o.timeline?.mev);
    if (!rec) return null;
    if (!rec.token && ['accepted', 'offline'].includes(rec.status)) rec.token = await newReceiptToken(ref);
    await repo.patchOrder(o.id, { mev: rec });
    await noteCloverInvoice(o.posOrderId && !o.viaPos ? { mid: (await repo.findStore(o.channel, o.channelStoreId))?.cloverMerchantId ?? null, posOrderId: o.posOrderId, notes: o.notes } : null, rec, o.timeline?.mev);
    return rec;
  }
  const { getDirectOrder, saveDirectOrder } = await import('../delivery/store');
  const d = await getDirectOrder(ref.id);
  if (!d) return null;
  const rec = recordFromJobs(jobs, d.mev);
  if (!rec) return null;
  if (!rec.token && ['accepted', 'offline'].includes(rec.status)) rec.token = await newReceiptToken(ref);
  const cur = (await getDirectOrder(ref.id)) ?? d;
  await saveDirectOrder({ ...cur, mev: rec });
  await noteCloverInvoice(d.posOrderId ? { mid: d.posMerchantId ?? d.paylink?.merchantId ?? null, posOrderId: d.posOrderId, notes: d.notes } : null, rec, d.mev);
  if (!d.mev?.noTrans && rec.noTrans) {
    const { sendReceiptLink } = await import('./receipt');
    await sendReceiptLink(cur, rec).catch(() => undefined);
  }
  return rec;
}

async function newReceiptToken(ref: MevJob['order']): Promise<string> {
  const token = crypto.randomBytes(16).toString('base64url');
  await getRepo().setKv(RECEIPT_KV(token), { model: ref.model, id: ref.id });
  return token;
}

/** The order behind a public receipt link (null = unknown token). */
export async function orderRefForToken(token: string): Promise<{ model: 'stored' | 'direct'; id: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  return getRepo().getKv<{ model: 'stored' | 'direct'; id: string }>(RECEIPT_KV(token)).catch(() => null);
}

/** Opt-in (FOODHUB_MEV_CLOVER_NOTE=on): the Clover order note says where the invoice is. Text only — Clover's REST API cannot print a QR. */
async function noteCloverInvoice(target: { mid: string | null; posOrderId: string; notes?: string } | null, rec: MevRecord, prev?: MevRecord | null) {
  const { mevCloverNoteOn } = await import('./config');
  if (!target || !mevCloverNoteOn() || !rec.noTrans || prev?.noTrans === rec.noTrans) return;
  const { updateCloverOrder } = await import('../pos/clover-checkout');
  const { defaultCloverMerchant } = await import('../pos/clover');
  const mid = target.mid ?? (await defaultCloverMerchant());
  if (!mid) return;
  const note = `${target.notes ? `${target.notes.slice(0, 180)} | ` : ''}Facture n° ${rec.noTrans}: voir facture imprimée`;
  await updateCloverOrder(mid, target.posOrderId, { note }).catch(() => false);
}

// ---------- QCMEV health (cached) ----------

const HEALTH_KV = 'mev:health';
export interface HealthState { at: string; health: MevHealth | null; error?: string }

export async function mevHealth(opts: { maxAgeMs?: number; force?: boolean } = {}): Promise<HealthState> {
  const g = globalThis as unknown as { __mevHealth?: HealthState };
  const maxAge = opts.maxAgeMs ?? 60_000;
  if (!opts.force && g.__mevHealth && Date.now() - Date.parse(g.__mevHealth.at) < maxAge) return g.__mevHealth;
  const r = await fetchMevHealth(tenantId());
  const state: HealthState = { at: nowIso(), health: r.health, ...(r.error ? { error: r.error } : {}) };
  g.__mevHealth = state;
  await getRepo().setKv(HEALTH_KV, state).catch(() => undefined);
  return state;
}

export async function lastMevHealth(): Promise<HealthState | null> {
  const g = globalThis as unknown as { __mevHealth?: HealthState };
  return g.__mevHealth ?? (await getRepo().getKv<HealthState>(HEALTH_KV).catch(() => null));
}

// ---------- the runner ----------

function due(j: MevJob, now: number): boolean {
  if (j.status === 'pending') return !j.nextAt || Date.parse(j.nextAt) <= now;
  if (j.status === 'sending') return !j.claimedAt || now - Date.parse(j.claimedAt) > CLAIM_MS;
  // A receipt signed offline by QCMEV: read it again until MEV-WEB numbered it.
  return j.status === 'done' && j.kind === 'sale' && j.result?.status === 'offline_pending' && (!j.nextAt || Date.parse(j.nextAt) <= now);
}

async function claim(j: MevJob, now: number): Promise<MevJob | null> {
  const fresh = await getJob(j.id);
  if (!fresh || !due(fresh, now)) return null;
  const token = crypto.randomUUID();
  await putJob({ ...fresh, ...(fresh.status === 'done' ? {} : { status: 'sending' as const }), claim: token, claimedAt: new Date(now).toISOString() });
  const again = await getJob(j.id);
  return again?.claim === token ? again : null;
}

function nextDelayS(attempts: number): number {
  const d = mevRetryDelaysS();
  return d[Math.min(Math.max(0, attempts - 1), d.length - 1)];
}

function pathFor(j: MevJob): string {
  const sale = encodeURIComponent(j.saleKey);
  if (j.kind === 'credit') return `/sales/${sale}/credit-notes`;
  if (j.kind === 'print') return `/sales/${sale}/prints`;
  return '/sales';
}

/** Applies one answer to the job (pure: unit-tested). */
export function applyOutcome(j: MevJob, http: number, out: MevOutcome, now: number): MevJob {
  const at = new Date(now).toISOString();
  const base: MevJob = { ...j, claim: undefined, claimedAt: undefined, lastHttp: http || undefined, attempts: j.attempts + 1, firstAttemptAt: j.firstAttemptAt ?? at };
  switch (out.kind) {
    case 'accepted':
      return { ...base, status: 'done', wait: undefined, lastError: undefined, nextAt: null, doneAt: j.doneAt ?? at, result: { status: 'accepted', ...(out.receipt ? { receipt: out.receipt } : j.result?.receipt ? { receipt: j.result.receipt } : {}) } };
    case 'offline_pending':
      return { ...base, status: 'done', wait: 'offline_pending', lastError: undefined, nextAt: new Date(now + pollOfflineMs()).toISOString(), doneAt: j.doneAt ?? at, result: { status: 'offline_pending', ...(out.receipt ? { receipt: out.receipt } : {}) } };
    case 'rejected':
      return { ...base, status: 'needs_human', wait: undefined, nextAt: null, lastError: out.errors.map((e) => `${e.codRetour ?? ''} ${e.mess ?? ''}`.trim()).join('; ').slice(0, 300) || 'Rejected by MEV-WEB', result: { status: 'rejected', errors: out.errors } };
    case 'queued':
      return { ...base, status: 'pending', wait: 'queued', nextAt: new Date(now + out.retryAfterS * 1000).toISOString(), lastError: 'QCMEV took it and will sign it shortly' };
    case 'not_ready':
      return { ...base, status: 'pending', wait: 'location_not_ready', nextAt: new Date(now + 300_000).toISOString(), lastError: out.message };
    case 'invalid':
    case 'auth':
    case 'conflict':
      return { ...base, status: 'needs_human', wait: undefined, nextAt: null, lastError: out.message };
    default:
      return { ...base, status: 'pending', wait: 'qcmev_unreachable', nextAt: new Date(now + nextDelayS(base.attempts) * 1000).toISOString(), lastError: out.message };
  }
}

export interface MevRunReport { ran: boolean; due: number; sent: number; done: number; waiting: number; needsHuman: number; skipped: number }

const EMPTY: MevRunReport = { ran: false, due: 0, sent: 0, done: 0, waiting: 0, needsHuman: 0, skipped: 0 };

/** Sends what is due, oldest first. Cheap when FOODHUB_MEV=off (no read at all). */
export async function runMevOutbox(opts: { now?: number; trigger?: string; onlyBaseKey?: string; max?: number } = {}): Promise<MevRunReport> {
  const mode = mevMode();
  if (mode === 'off' || mode === 'shadow') return EMPTY;
  const now = opts.now ?? Date.now();
  const all = opts.onlyBaseKey ? await jobsFor(opts.onlyBaseKey) : await listJobs();
  const list = all.filter((j) => due(j, now)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key)).slice(0, opts.max ?? 50);
  const report: MevRunReport = { ...EMPTY, ran: true, due: list.length };
  let health: HealthState | null = null;
  const touched = new Map<string, MevJob['order']>();
  for (const candidate of list) {
    // A pay-at-pickup order whose tender is not known yet: plan it again (Clover may have the payment now).
    if (candidate.wait === 'tender_unknown') {
      const { replanOrder } = await import('./hooks');
      await replanOrder(candidate.order).catch(() => undefined);
      const after = await getJob(candidate.id);
      if (!after || after.wait === 'tender_unknown') {
        if (after) await putJob({ ...after, nextAt: new Date(now + 60_000).toISOString() });
        report.waiting += 1;
        continue;
      }
    }
    const j = await claim(candidate, now);
    if (!j) continue;
    // A credit note or a corrected receipt waits for the receipt it follows.
    if (j.dependsOn) {
      const dep = await getJob(jobIdFor(j.dependsOn));
      if (dep?.status === 'skipped') {
        await putJob({ ...j, status: 'skipped', claim: undefined, claimedAt: undefined, wait: undefined, lastError: 'The receipt it follows was never issued' });
        report.skipped += 1; touched.set(j.baseKey, j.order); continue;
      }
      if (!dep || dep.status !== 'done') {
        await putJob({ ...j, status: j.status === 'done' ? 'done' : 'pending', claim: undefined, claimedAt: undefined, wait: 'depends', nextAt: new Date(now + 15_000).toISOString() });
        report.waiting += 1; continue;
      }
    }
    // Offline receipt: read it again (GET /sales/{key}) until MEV-WEB numbered it.
    if (j.status === 'done') {
      const r = await mevRequest('GET', `/sales/${encodeURIComponent(j.key)}`, { tenant: j.payload.tenantId });
      const next = r.outcome.kind === 'accepted' ? applyOutcome({ ...j, attempts: j.attempts - 1 }, r.http, r.outcome, now)
        : { ...j, claim: undefined, claimedAt: undefined, nextAt: new Date(now + pollOfflineMs()).toISOString() };
      await putJob(next);
      if (next.result?.status === 'accepted') touched.set(j.baseKey, j.order);
      continue;
    }
    if (!health && (mode === 'on' || mode === 'simulator')) health = await mevHealth().catch(() => null);
    const refusal = healthRefusal(mode, health?.health ?? null);
    if (refusal) {
      await putJob({ ...j, status: 'pending', claim: undefined, claimedAt: undefined, wait: 'not_certified', lastError: refusal, nextAt: new Date(now + 300_000).toISOString() });
      report.waiting += 1; touched.set(j.baseKey, j.order); continue;
    }
    report.sent += 1;
    const r = await mevRequest('POST', pathFor(j), { body: j.payload, key: j.key, eventId: sha256(`${j.key}${j.payloadHash}`), tenant: j.payload.tenantId });
    const next = applyOutcome(j, r.http, r.outcome, now);
    await putJob(next);
    touched.set(j.baseKey, j.order);
    if (next.status === 'done') report.done += 1;
    else if (next.status === 'needs_human') {
      report.needsHuman += 1;
      await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'order', action: 'mev_needs_human', status: 'failed', locationCode: j.order.locationCode, orderId: j.order.model === 'stored' ? j.order.id : null,
        summary: `Invoice (MEV) for ${j.order.label} needs a person: ${next.lastError ?? 'refused'}` });
    } else report.waiting += 1;
  }
  for (const [baseKey, ref] of touched) await syncOrderMev(ref, baseKey).catch((e) => console.error('[foodhub] MEV order sync failed', e instanceof Error ? e.message : e));
  // The next attempt of anything still waiting (jobs not due yet, and the ones just put back to wait).
  const later = await (touched.size ? (opts.onlyBaseKey ? jobsFor(opts.onlyBaseKey) : Promise.all([...touched.keys()].map(jobsFor)).then((x) => [...all, ...x.flat()])) : Promise.resolve(all));
  const soonest = later.filter((j) => j.status === 'pending' && j.nextAt && !j.shadow && Date.parse(j.nextAt) > now).map((j) => Date.parse(j.nextAt!)).sort((a, b) => a - b)[0];
  if (soonest) armMevTimer(soonest - Date.now());
  return report;
}

/** Best effort on a long-running server: the next attempt runs when it is due (the Watchtower timer and the cron also run it). */
export function armMevTimer(ms: number) {
  if (process.env.VERCEL || process.env.FOODHUB_RETRY_TIMER === 'off') return;
  const g = globalThis as unknown as { __mevTimerAt?: number };
  const at = Date.now() + Math.max(1000, ms + 250);
  if (g.__mevTimerAt && g.__mevTimerAt > Date.now() && g.__mevTimerAt <= at) return;
  g.__mevTimerAt = at;
  const t = setTimeout(() => {
    g.__mevTimerAt = 0;
    runMevOutbox({ trigger: 'timer' }).catch((e) => console.error('[foodhub] MEV outbox timer failed', e instanceof Error ? e.message : e));
  }, at - Date.now());
  t.unref?.();
}

/** Starts the send right away (the job was just written); the order call never waits for QCMEV. */
export function kickMevOutbox(baseKey: string) {
  const p: Promise<unknown> = runMevOutbox({ trigger: 'kick', onlyBaseKey: baseKey }).catch((e) => console.error('[foodhub] MEV outbox failed', e instanceof Error ? e.message : e));
  kicks.add(p);
  void p.finally(() => kicks.delete(p));
}

const kicks = new Set<Promise<unknown>>();

/** Waits for the sends started by kickMevOutbox (tests, and a clean shutdown). */
export async function settleMevKicks(): Promise<void> {
  while (kicks.size) await Promise.all([...kicks]);
}

/** "Replay": a person checked a job that needed one; it is sent again with the same key and body. */
export async function replayJob(id: string, actor: Actor): Promise<MevJob | null> {
  const j = await getJob(id);
  if (!j || j.status !== 'needs_human') return j;
  const next = await putJob({ ...j, status: 'pending', wait: undefined, nextAt: null, lastError: `Replayed by ${actor.name}` });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'mev_replay', status: 'info', locationCode: j.order.locationCode, orderId: j.order.model === 'stored' ? j.order.id : null, summary: `Invoice (MEV) for ${j.order.label} sent again` });
  kickMevOutbox(j.baseKey);
  return next;
}

// ---------- alerts (Watchtower) ----------

export interface MevAlert { key: string; severity: 'critical' | 'warning'; job: MevJob; ageMin: number }

/** Jobs a person must know about: pending 15+ min (critical at 24 h; the legal limit is 48 h), or waiting for a person. */
export async function mevAlerts(now = Date.now()): Promise<MevAlert[]> {
  if (mevMode() === 'off') return [];
  const jobs = await listJobs({ since: new Date(now - OPEN_WINDOW_MS).toISOString() });
  const out: MevAlert[] = [];
  for (const j of jobs) {
    if (j.shadow) continue;
    const ageMin = (now - Date.parse(j.createdAt)) / 60_000;
    if (j.status === 'needs_human') out.push({ key: `mev:${j.id}`, severity: j.kind === 'sale' ? 'critical' : 'warning', job: j, ageMin });
    else if ((j.status === 'pending' || j.status === 'sending') && ageMin >= 15) out.push({ key: `mev:${j.id}`, severity: ageMin >= 24 * 60 ? 'critical' : 'warning', job: j, ageMin });
  }
  return out;
}

/** Counts for Settings and /api/health: nothing personal. */
export async function mevOutboxSummary(now = Date.now()) {
  const jobs = mevMode() === 'off' ? [] : await listJobs({ since: new Date(now - 86400_000).toISOString() });
  const count = (s: MevJob['status']) => jobs.filter((j) => j.status === s && !j.shadow).length;
  const pending = jobs.filter((j) => j.status === 'pending' || j.status === 'sending');
  return {
    pending: pending.length, done: count('done'), needsHuman: count('needs_human'), skipped: count('skipped'), shadow: jobs.filter((j) => j.shadow).length,
    oldestPendingAt: pending.map((j) => j.createdAt).sort()[0] ?? null,
    offline: jobs.filter((j) => j.status === 'done' && j.result?.status === 'offline_pending').length,
  };
}

export function saleOf(j: MevJob): FoodHubSaleV1 | null {
  return j.kind === 'sale' ? (j.payload as FoodHubSaleV1) : null;
}
