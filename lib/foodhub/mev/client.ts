// Signed calls from Food Hub to Takatak MEV (QCMEV), on the internal network only (docs/MEV_INTEGRATION.md § transport).
//
// Headers: Content-Type, X-Integration-Id: foodhub, X-Tenant-Id, X-Event-Id, X-Timestamp (Unix ms), Idempotency-Key
// (saleKey / creditKey / printKey), X-Signature: sha256=hex(HMAC_SHA256(secret, "<ts>.<eventId>.<raw body>")) — the
// HMAC of lib/foodhub/tenant.ts. No staff session ever rides on these calls. The secret is never logged.
import crypto from 'node:crypto';
import { contractMac } from '../tenant';
import { mevSecret, mevTimeoutMs, mevUrl } from './config';
import type { MevReceipt } from './types';

export const MEV_API_PREFIX = '/api/v1/integrations/foodhub';
export const INTEGRATION_ID = 'foodhub';

export function signMev(body: string, eventId: string, idempotencyKey: string, tenant: string, secret: string, now = Date.now()): Record<string, string> {
  const ts = String(Math.floor(now));
  return {
    'Content-Type': 'application/json', 'X-Integration-Id': INTEGRATION_ID, 'X-Tenant-Id': tenant, 'X-Event-Id': eventId, 'X-Timestamp': ts,
    'Idempotency-Key': idempotencyKey, 'X-Signature': `sha256=${contractMac(secret, ts, eventId, body)}`,
  };
}

/** What Food Hub does with an answer (contract § responses). */
export type MevOutcome =
  | { kind: 'accepted' | 'offline_pending'; receipt?: MevReceipt; json: unknown }
  | { kind: 'rejected'; errors: Array<{ id?: string; mess?: string; codRetour?: string }>; json: unknown }
  | { kind: 'queued'; retryAfterS: number }
  | { kind: 'invalid'; message: string }      // 400 / 422: no retry, a person looks
  | { kind: 'auth'; message: string }         // 401 / 403: alert
  | { kind: 'conflict'; message: string }     // 409: same key, other content → credit-note path
  | { kind: 'not_ready'; message: string }    // 423: location not ready (device, certificate, user) → slow retry
  | { kind: 'retry'; message: string; http?: number }; // 429 / 5xx / time-out / network

const short = (v: unknown, n = 300) => String(typeof v === 'string' ? v : JSON.stringify(v ?? '')).slice(0, n);

/** Keeps only the receipt fields Food Hub uses (strings and string arrays), whatever else QCMEV adds. */
export function cleanReceipt(r: unknown): MevReceipt | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const o = r as Record<string, unknown>;
  const s = (v: unknown, n = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, n) : undefined);
  const qr = o.qr && typeof o.qr === 'object' ? o.qr as Record<string, unknown> : null;
  const lines = (v: unknown) => (Array.isArray(v) ? v.slice(0, 200).map((x) => String(x ?? '').slice(0, 64)) : undefined);
  const el = o.electronic && typeof o.electronic === 'object' ? o.electronic as Record<string, unknown> : null;
  const out: MevReceipt = {
    qcmevTransactionId: s(o.qcmevTransactionId, 80), noTrans: s(o.noTrans, 40), datTrans: s(o.datTrans, 20), utc: s(o.utc, 8), deviceId: s(o.deviceId, 40),
    mevProcessedAt: s(o.mevProcessedAt, 40), mevTransactionNumber: s(o.mevTransactionNumber, 60),
    qr: qr ? { content: s(qr.content, 2000), svg: s(qr.svg, 200_000), pngDataUrl: s(qr.pngDataUrl, 400_000) } : undefined,
    mentions: lines(o.mentions), text80mm: lines(o.text80mm), html: s(o.html, 200_000), renderHash: s(o.renderHash, 80), issuedAt: s(o.issuedAt, 40),
    // The electronic document (ELE / PEL): its lines are what the public page shows (QCMEV's html is never injected).
    electronic: el ? { mentions: lines(el.mentions), lines: lines(el.lines) } : undefined,
  };
  for (const k of Object.keys(out) as Array<keyof MevReceipt>) if (out[k] === undefined) delete out[k];
  return out;
}

export function classify(http: number, json: unknown, headers?: Headers): MevOutcome {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, any>;
  if (http === 200 || http === 201) {
    const st = String(j.status ?? '');
    if (st === 'accepted' || st === 'offline_pending') return { kind: st, receipt: cleanReceipt(j.receipt), json };
    if (st === 'rejected') return { kind: 'rejected', errors: (Array.isArray(j.errors) ? j.errors : []).slice(0, 20).map((e: any) => ({ id: short(e?.id, 40), mess: short(e?.mess, 300), codRetour: short(e?.codRetour, 10) })), json };
    if (st === 'queued') return { kind: 'queued', retryAfterS: Math.max(5, Math.min(3600, Number(j.retryAfterS) || 60)) };
    return { kind: 'invalid', message: `QCMEV answered ${http} without a known status (${short(st, 40)})` };
  }
  if (http === 202) return { kind: 'queued', retryAfterS: Math.max(5, Math.min(3600, Number(j.retryAfterS ?? headers?.get('retry-after')) || 60)) };
  if (http === 400 || http === 422) return { kind: 'invalid', message: `QCMEV refused the data (${http}): ${short(j.message ?? j.error ?? j.fields ?? json)}` };
  if (http === 401 || http === 403) return { kind: 'auth', message: `QCMEV refused the signature (${http}) — check FOODHUB_MEV_SECRET on both sides` };
  if (http === 409) return { kind: 'conflict', message: `QCMEV: same key, different content (409 ${short(j.error ?? 'idempotency_conflict', 60)})` };
  if (http === 423) return { kind: 'not_ready', message: `QCMEV: this kitchen is not ready (${short(j.error ?? j.message ?? 'location_not_ready', 120)})` };
  return { kind: 'retry', message: `QCMEV HTTP ${http}`, http };
}

export interface MevCall { http: number; outcome: MevOutcome }

/** One signed request. Never throws: a network failure or time-out is a "retry" outcome (safe: same key, same body). */
export async function mevRequest(method: 'GET' | 'POST', path: string, opts: { body?: unknown; key?: string; eventId?: string; tenant: string }): Promise<MevCall> {
  const base = mevUrl();
  const secret = mevSecret();
  if (!base || !secret) return { http: 0, outcome: { kind: 'retry', message: 'FOODHUB_MEV_URL / FOODHUB_MEV_SECRET not set' } };
  const raw = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const eventId = opts.eventId ?? crypto.randomUUID();
  const headers = signMev(raw, eventId, opts.key ?? eventId, opts.tenant, secret);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), mevTimeoutMs());
  try {
    const res = await fetch(`${base}${MEV_API_PREFIX}${path}`, { method, headers, body: method === 'GET' ? undefined : raw, signal: controller.signal, cache: 'no-store' });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text.slice(0, 300); }
    return { http: res.status, outcome: classify(res.status, json, res.headers) };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return { http: 0, outcome: { kind: 'retry', message: name === 'AbortError' ? `QCMEV did not answer within ${mevTimeoutMs()} ms` : `QCMEV unreachable (${short((e as Error)?.message ?? e, 120)})` } };
  } finally {
    clearTimeout(timer);
  }
}

export interface MevHealth {
  environment?: string;
  certified?: boolean;
  certificateValidUntil?: string | null;
  mevReachable?: boolean;
  queueDepth?: number;
  oldestQueuedAt?: string | null;
  locations?: Array<{ locationId: string; deviceReady?: boolean; certReady?: boolean; usersReady?: boolean }>;
}

/** GET /health (environment, certified, queue…). Null when QCMEV cannot be read. */
export async function fetchMevHealth(tenant: string): Promise<{ health: MevHealth | null; error?: string }> {
  const base = mevUrl();
  const secret = mevSecret();
  if (!base || !secret) return { health: null, error: 'FOODHUB_MEV_URL / FOODHUB_MEV_SECRET not set' };
  const eventId = crypto.randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), mevTimeoutMs());
  try {
    const res = await fetch(`${base}${MEV_API_PREFIX}/health`, { headers: signMev('', eventId, eventId, tenant, secret), signal: controller.signal, cache: 'no-store' });
    const j = await res.json().catch(() => null) as Record<string, any> | null;
    if (!res.ok || !j) return { health: null, error: `QCMEV /health HTTP ${res.status}` };
    // One line per linked location: every Food Hub kitchen and every App Market merchant (clover-merchants.ts).
    const locs = Array.isArray(j.locations) ? j.locations.slice(0, 5000).map((l: any) => ({ locationId: String(l?.locationId ?? '').slice(0, 30), deviceReady: l?.deviceReady === true, certReady: l?.certReady === true, usersReady: l?.usersReady === true })) : [];
    return { health: { environment: String(j.environment ?? '').slice(0, 12), certified: j.certified === true, certificateValidUntil: j.certificateValidUntil ? String(j.certificateValidUntil).slice(0, 40) : null, mevReachable: j.mevReachable === true, queueDepth: Number(j.queueDepth) || 0, oldestQueuedAt: j.oldestQueuedAt ? String(j.oldestQueuedAt).slice(0, 40) : null, locations: locs } };
  } catch (e) {
    return { health: null, error: (e as { name?: string })?.name === 'AbortError' ? 'QCMEV /health timed out' : 'QCMEV unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
