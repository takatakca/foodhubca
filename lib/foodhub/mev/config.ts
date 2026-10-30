// Takatak MEV (QCMEV) switches. Everything is OFF by default, on both sides (docs/MEV_INTEGRATION.md § switches).
//
//   FOODHUB_MEV            off (default) | shadow (map + check, no call) | simulator | on
//   features.mev           the owner's switch (Settings → Expansion), FOODHUB_FEATURE_MEV=on|off overrides it
//   FOODHUB_MEV_LOCATIONS  allowlist of kitchens (location codes); empty = none
//   sevOfRecord            per kitchen in fh_kv: none (default) | qcmev | clover_app
//   FOODHUB_MEV_TRIGGER    accept (default) | ready
//   FOODHUB_MEV_URL, FOODHUB_MEV_SECRET, FOODHUB_MEV_TIMEOUT_MS (8000), FOODHUB_MEV_RETRY_S (15,60,300)
//
// A sale is sent for a kitchen only when ALL of these say yes. "on" is refused unless QCMEV's /health says PROD and
// certified; "simulator" is refused when QCMEV says PROD (test sales never reach a production SEV).
import { logActivity, type Actor } from '../activity';
import { getCatalog } from '../catalog';
import { featureOn } from '../expansion/features';
import { getRepo } from '../repo';
import { locationProvince } from '../taxes';
import { isActiveMerchantLocation } from './clover-merchants';
import type { MevMode, MevTrigger, SevOfRecord } from './types';

const MODES: readonly MevMode[] = ['off', 'shadow', 'simulator', 'on'];

/** FOODHUB_MEV. Anything unknown is "off": a typo never starts sending invoices. */
export function mevMode(env: NodeJS.ProcessEnv = process.env): MevMode {
  const v = String(env.FOODHUB_MEV ?? '').trim().toLowerCase() as MevMode;
  return MODES.includes(v) ? v : 'off';
}

export function mevTrigger(env: NodeJS.ProcessEnv = process.env): MevTrigger {
  return String(env.FOODHUB_MEV_TRIGGER ?? '').trim().toLowerCase() === 'ready' ? 'ready' : 'accept';
}

/** QCMEV base URL (internal network, e.g. http://qcmev-backend:3001). The integration API is under /api/v1/integrations/foodhub. */
export function mevUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = String(env.FOODHUB_MEV_URL ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(raw) ? raw : null;
}

/** The signing secret: at least 32 characters (32+ random bytes, hex or base64). Its value is never shown or logged. */
export function mevSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = String(env.FOODHUB_MEV_SECRET ?? '').trim();
  return s.length >= 32 ? s : null;
}

export function mevTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.FOODHUB_MEV_TIMEOUT_MS ?? 8000);
  return Number.isFinite(n) && n >= 500 ? Math.min(Math.round(n), 60_000) : 8000;
}

/**
 * Seconds between attempts; the last value repeats until the job is done (never given up). A sale still waiting has no
 * invoice yet (it is due at payment): the Watchtower calls a person after 1 minute (outbox.ts mevAlerts).
 */
export function mevRetryDelaysS(env: NodeJS.ProcessEnv = process.env): number[] {
  const list = String(env.FOODHUB_MEV_RETRY_S ?? '15,60,300').split(/[\s,;]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.min(Math.round(n), 3600));
  return list.length ? list.slice(0, 6) : [15, 60, 300];
}

export function mevLocations(env: NodeJS.ProcessEnv = process.env): string[] {
  return String(env.FOODHUB_MEV_LOCATIONS ?? '').split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z0-9_]{2,30}$/.test(c));
}

/** The Clover order note ("Facture n° …") is opt-in: it replaces the order note in Clover. */
export function mevCloverNoteOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(on|true|1|yes)$/i.test(String(env.FOODHUB_MEV_CLOVER_NOTE ?? '').trim());
}

// ---------- per-kitchen system of record (fh_kv) ----------

const KV = 'mev_settings_v1';
export interface MevSettings { locations: Record<string, { sevOfRecord: SevOfRecord; by?: string; at?: string }>; updatedAt?: string }
const SEVS: readonly SevOfRecord[] = ['none', 'qcmev', 'clover_app'];

export function cleanMevSettings(raw: Partial<MevSettings> | null | undefined): MevSettings {
  const locations: MevSettings['locations'] = {};
  for (const [code, v] of Object.entries(raw?.locations ?? {})) {
    if (!/^[A-Z0-9_]{2,30}$/.test(code)) continue;
    const sev = SEVS.includes(v?.sevOfRecord as SevOfRecord) ? (v!.sevOfRecord as SevOfRecord) : 'none';
    locations[code] = { sevOfRecord: sev, ...(v?.by ? { by: String(v.by).slice(0, 80) } : {}), ...(v?.at ? { at: String(v.at) } : {}) };
  }
  return { locations, ...(raw?.updatedAt ? { updatedAt: raw.updatedAt } : {}) };
}

export async function getMevSettings(): Promise<MevSettings> {
  return cleanMevSettings(await getRepo().getKv<MevSettings>(KV).catch(() => null));
}

export function sevOfRecord(settings: MevSettings, locationCode?: string | null): SevOfRecord {
  return (locationCode && settings.locations[locationCode]?.sevOfRecord) || 'none';
}

/** Owner: which system issues the invoice for one kitchen. Logged. */
export async function setSevOfRecord(locationCode: string, sev: SevOfRecord, actor: Actor): Promise<MevSettings> {
  const code = String(locationCode).toUpperCase();
  if (!/^[A-Z0-9_]{2,30}$/.test(code)) throw new Error('Unknown location.');
  if (!SEVS.includes(sev)) throw new Error('sevOfRecord must be none, qcmev or clover_app.');
  const cur = await getMevSettings();
  const at = new Date().toISOString();
  const next = cleanMevSettings({ locations: { ...cur.locations, [code]: { sevOfRecord: sev, by: actor.name, at } }, updatedAt: at });
  await getRepo().setKv(KV, next);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'mev_sev_of_record', status: 'success', locationCode: code,
    summary: `Invoices (MEV) for ${code}: ${sev === 'qcmev' ? 'Takatak MEV (QCMEV)' : sev === 'clover_app' ? 'the Clover MEV app' : 'none from Food Hub'}` });
  return next;
}

// ---------- the one decision: is a sale sent for this kitchen? ----------

export type MevGate =
  | { active: true; mode: Exclude<MevMode, 'off'> }
  | { active: false; reason: 'mode_off' | 'switch_off' | 'not_allowlisted' | 'sev_none' | 'sev_clover_app' | 'no_location' | 'not_quebec' | 'not_configured' };

/** Cheap when off: FOODHUB_MEV=off answers without any read. */
export async function mevGate(locationCode: string | null | undefined, opts: { settings?: MevSettings } = {}): Promise<MevGate> {
  const mode = mevMode();
  if (mode === 'off') return { active: false, reason: 'mode_off' };
  if (!locationCode) return { active: false, reason: 'no_location' };
  // A TAKATAK MEV App Market merchant set up in Takatak MEV (clover-merchants.ts) stands in for the allowlist and the
  // system of record: its own location exists only for its Takatak MEV invoices.
  const appMarket = !mevLocations().includes(locationCode) && (await isActiveMerchantLocation(locationCode).catch(() => false));
  if (!appMarket && !mevLocations().includes(locationCode)) return { active: false, reason: 'not_allowlisted' };
  if (!(await featureOn('mev').catch(() => false))) return { active: false, reason: 'switch_off' };
  const sev = appMarket ? 'qcmev' : sevOfRecord(opts.settings ?? (await getMevSettings()), locationCode);
  if (sev === 'clover_app') return { active: false, reason: 'sev_clover_app' };
  if (sev !== 'qcmev') return { active: false, reason: 'sev_none' };
  // MEV-WEB is Revenu Québec's: a kitchen in another province never sends it a sale, even when listed by mistake.
  const kitchen = (await getCatalog().catch(() => null))?.locations.find((l) => l.code === locationCode);
  if (kitchen && locationProvince(kitchen) !== 'QC') return { active: false, reason: 'not_quebec' };
  if (mode !== 'shadow' && (!mevUrl() || !mevSecret())) return { active: false, reason: 'not_configured' };
  return { active: true, mode };
}

/** What QCMEV must say before Food Hub sends anything in this mode (null = fine). */
export function healthRefusal(mode: MevMode, health: { environment?: string; certified?: boolean } | null): string | null {
  if (mode === 'on') {
    if (!health) return 'QCMEV /health not readable';
    if (String(health.environment).toUpperCase() !== 'PROD' || health.certified !== true) return 'FOODHUB_MEV=on needs QCMEV in PROD and certified';
  }
  if (mode === 'simulator' && health && String(health.environment).toUpperCase() === 'PROD') return 'FOODHUB_MEV=simulator never sends test sales to a PROD QCMEV';
  return null;
}

export interface MevReadiness {
  mode: MevMode;
  trigger: MevTrigger;
  urlSet: boolean;
  secretSet: boolean;
  /** Secret present but shorter than 32 characters. */
  secretWeak: boolean;
  timeoutMs: number;
  retryS: number[];
  allowlist: string[];
  cloverNote: boolean;
  missing: string[];
}

/** For Settings: env key names and states only, never a value. */
export function mevReadiness(env: NodeJS.ProcessEnv = process.env): MevReadiness {
  const mode = mevMode(env);
  const rawSecret = String(env.FOODHUB_MEV_SECRET ?? '').trim();
  const missing: string[] = [];
  if (mode === 'off') missing.push('FOODHUB_MEV');
  if (!mevUrl(env)) missing.push('FOODHUB_MEV_URL');
  if (!mevSecret(env)) missing.push('FOODHUB_MEV_SECRET');
  if (!mevLocations(env).length) missing.push('FOODHUB_MEV_LOCATIONS');
  return {
    mode, trigger: mevTrigger(env), urlSet: Boolean(mevUrl(env)), secretSet: Boolean(mevSecret(env)), secretWeak: Boolean(rawSecret) && !mevSecret(env),
    timeoutMs: mevTimeoutMs(env), retryS: mevRetryDelaysS(env), allowlist: mevLocations(env), cloverNote: mevCloverNoteOn(env), missing,
  };
}
