// Restaurants that install TAKATAK MEV from the Clover App Market and are not Food Hub kitchens: each one sets itself up,
// and nobody at TAKATAK types its fiscal identity anywhere.
//
//  1. Its install is approved (Clover → Food Hub, like every Clover app: clover-oauth.ts).
//  2. The welcome page (/welcome/clover, TAKATAK MEV) gives it its own Food Hub location code, `CLV_` + 16 random
//     characters (80 bits). Only that merchant sees it (signed welcome ticket) and nobody can guess it, so no other
//     Takatak MEV account can claim its sales.
//  3. In its own Takatak MEV account (QCMEV dashboard: sign-up, its Clover register as a device with the Revenu Québec
//     file number and authorization code, the certificate), it links that code to the device.
//  4. Food Hub turns it on once QCMEV's /health says that location is ready (device, certificate, FOODHUB-AUTO user).
//     From then on its register sales are invoiced like a Food Hub kitchen's (clover-register.ts) behind the same gate
//     (FOODHUB_MEV mode, the owner switch, QCMEV URL + secret); this enrollment stands in for the per-kitchen allowlist
//     and system of record. Sales rung up before that are not invoiced by Food Hub (the merchant had no SEV yet).
// Nothing is created before FOODHUB_MEV_CLOVER_REGISTER=on.
import crypto from 'node:crypto';
import { logActivity } from '../activity';
import { nowIso } from '../config';
import { getRepo } from '../repo';
import { tenantId } from '../tenant';

export interface MevMerchantReady { linked: boolean; deviceReady: boolean; certReady: boolean; usersReady: boolean }

export interface MevMerchant {
  merchantId: string;
  /** The Food Hub location id the merchant links in Takatak MEV (CLV_…). */
  locationCode: string;
  name?: string;
  status: 'waiting' | 'active';
  createdAt: string;
  activatedAt?: string;
  checkedAt?: string;
  /** What QCMEV said at the last check. */
  ready?: MevMerchantReady;
}

const KV = (mid: string) => `mev_merchant:${mid}`;
const BY_CODE = (code: string) => `mev_merchant_code:${code}`;
const INDEX = 'mev_merchants_index';
const MERCHANT_ID = /^[A-Z0-9]{8,20}$/;
export const APP_MARKET_CODE = /^CLV_[A-Z2-7]{16}$/;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** CLV_ + 16 base32 characters: 80 random bits, within Food Hub's (2–30) and QCMEV's (1–64) location id rules. */
export function newMerchantLocationCode(): string {
  return `CLV_${[...crypto.randomBytes(16)].map((b) => BASE32[b & 31]).join('')}`;
}

export async function getMevMerchant(mid: string): Promise<MevMerchant | null> {
  if (!MERCHANT_ID.test(mid)) return null;
  return getRepo().getKv<MevMerchant>(KV(mid)).catch(() => null);
}

/** The enrollment behind a location code (null for any other code, a guessed one included). */
export async function mevMerchantByCode(code: string): Promise<MevMerchant | null> {
  if (!APP_MARKET_CODE.test(code)) return null;
  const mid = await getRepo().getKv<string>(BY_CODE(code)).catch(() => null);
  const m = mid ? await getMevMerchant(mid) : null;
  return m?.locationCode === code ? m : null;
}

/** For the MEV gate: an App Market merchant's own location, turned on. */
export async function isActiveMerchantLocation(code: string | null | undefined): Promise<boolean> {
  if (!code || !APP_MARKET_CODE.test(code)) return false;
  return (await mevMerchantByCode(code))?.status === 'active';
}

/** The merchant's enrollment, created on its first visit (once, even with two visits at the same time). */
export async function ensureMevMerchant(mid: string, name?: string | null): Promise<MevMerchant | null> {
  if (!MERCHANT_ID.test(mid)) return null;
  const repo = getRepo();
  const existing = await getMevMerchant(mid);
  if (existing) return existing;
  const m: MevMerchant = { merchantId: mid, locationCode: newMerchantLocationCode(), ...(name ? { name: String(name).slice(0, 80) } : {}), status: 'waiting', createdAt: nowIso() };
  await repo.setKv(BY_CODE(m.locationCode), mid);
  if (!(await repo.claimKv(KV(mid), m))) return getMevMerchant(mid);
  const index = (await repo.getKv<string[]>(INDEX).catch(() => null)) ?? [];
  if (!index.includes(mid)) await repo.setKv(INDEX, [...index, mid].slice(-5000));
  await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'settings', action: 'mev_merchant_enrolled', status: 'info',
    summary: `TAKATAK MEV: Clover merchant ${mid}${m.name ? ` (${m.name})` : ''} started its self-serve set-up (location ${m.locationCode})` });
  return m;
}

/** QCMEV's /health line for this code → the four facts the welcome page shows. */
export function readinessOf(code: string, locations: Array<{ locationId: string; deviceReady?: boolean; certReady?: boolean; usersReady?: boolean }> | undefined): MevMerchantReady {
  const l = (locations ?? []).find((x) => x.locationId === code);
  return { linked: Boolean(l), deviceReady: l?.deviceReady === true, certReady: l?.certReady === true, usersReady: l?.usersReady === true };
}

const isReady = (r: MevMerchantReady) => r.linked && r.deviceReady && r.certReady && r.usersReady;

/**
 * Asks QCMEV (its cached /health, at most every `maxAgeMs`) whether the merchant's location is ready, and turns the
 * merchant on when it is. Once on, it stays on: a later problem in QCMEV (certificate expired, location unlinked)
 * shows on the sales themselves (423, the Watchtower), never by silently dropping invoices.
 */
export async function checkMevMerchant(mid: string, opts: { maxAgeMs?: number } = {}): Promise<{ merchant: MevMerchant | null; error?: string }> {
  const m = await getMevMerchant(mid);
  if (!m) return { merchant: null };
  const { mevHealth } = await import('./outbox');
  const h = await mevHealth({ maxAgeMs: opts.maxAgeMs ?? 30_000 });
  if (!h.health) return { merchant: m, error: h.error ?? 'QCMEV unreachable' };
  const ready = readinessOf(m.locationCode, h.health.locations);
  const at = nowIso();
  const next: MevMerchant = { ...m, ready, checkedAt: at, ...(m.status === 'waiting' && isReady(ready) ? { status: 'active' as const, activatedAt: at } : {}) };
  await getRepo().setKv(KV(mid), next);
  if (next.status === 'active' && m.status === 'waiting') {
    await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'settings', action: 'mev_merchant_active', status: 'success',
      summary: `TAKATAK MEV: Clover merchant ${mid}${m.name ? ` (${m.name})` : ''} is set up in Takatak MEV; its register sales are invoiced from now on (location ${m.locationCode})` });
  }
  return { merchant: next };
}

/** Heartbeat (clover-register.ts tick): the merchants still waiting are checked against QCMEV's cached /health. */
export async function activateWaitingMevMerchants(): Promise<number> {
  const index = (await getRepo().getKv<string[]>(INDEX).catch(() => null)) ?? [];
  let activated = 0;
  for (const mid of index) {
    const m = await getMevMerchant(mid);
    if (m?.status !== 'waiting') continue;
    const r = await checkMevMerchant(mid, { maxAgeMs: 60_000 });
    if (r.error) break; // QCMEV unreachable: the others would answer the same
    if (r.merchant?.status === 'active') activated++;
  }
  return activated;
}

/** What the TAKATAK MEV welcome page shows a merchant about its own set-up (no secret, no other merchant). */
export interface MevMerchantSetup {
  /** FOODHUB_MEV_CLOVER_REGISTER is on: self-serve set-up is open. */
  open: boolean;
  /** Already invoiced through a Food Hub kitchen: no set-up to do. */
  kitchen?: boolean;
  tenantId: string;
  locationCode?: string;
  status?: MevMerchant['status'];
  ready?: MevMerchantReady;
  checkedAt?: string;
  /** Sign-up page of the Takatak MEV dashboard (FOODHUB_MEV_DASHBOARD_URL), with the code filled in. */
  signUpUrl?: string;
  dashboardUrl?: string;
  /** FOODHUB_MEV is not "on": every invoice is a test (Takatak MEV is waiting for its Revenu Québec certification). */
  testMode: boolean;
  error?: string;
}

/** FOODHUB_MEV_DASHBOARD_URL: the public https address of the Takatak MEV dashboard. */
export function mevDashboardUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = String(env.FOODHUB_MEV_DASHBOARD_URL ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(raw) ? raw : null;
}

export async function mevMerchantSetup(mid: string, name?: string | null, opts: { check?: boolean } = {}): Promise<MevMerchantSetup> {
  const { cloverRegisterEnabled, kitchenPlace } = await import('./clover-register');
  const { mevMode } = await import('./config');
  const base = { tenantId: tenantId(), testMode: mevMode() !== 'on' };
  if (!cloverRegisterEnabled() || mevMode() === 'off') return { ...base, open: false };
  if (await kitchenPlace(mid).catch(() => null)) return { ...base, open: true, kitchen: true };
  let m = await ensureMevMerchant(mid, name);
  if (!m) return { ...base, open: false };
  let error: string | undefined;
  if (opts.check && m.status === 'waiting') {
    const r = await checkMevMerchant(mid, { maxAgeMs: 10_000 });
    m = r.merchant ?? m;
    error = r.error;
  }
  const dash = mevDashboardUrl();
  return {
    ...base, open: true, locationCode: m.locationCode, status: m.status, ...(m.ready ? { ready: m.ready } : {}), ...(m.checkedAt ? { checkedAt: m.checkedAt } : {}),
    ...(dash ? { dashboardUrl: dash, signUpUrl: `${dash}/register?tenant=${encodeURIComponent(base.tenantId)}&fh=${encodeURIComponent(m.locationCode)}` } : {}),
    ...(error ? { error } : {}),
  };
}
