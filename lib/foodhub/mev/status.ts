// What the owner sees about Takatak MEV (Settings → Expansion → MEV): plain words, French first, never a secret value.
import { getCatalog } from '../catalog';
import type { FeatureCheck } from '../expansion/summary';
import { getMevSettings, mevGate, mevReadiness, sevOfRecord } from './config';
import { lastMevHealth, mevOutboxSummary } from './outbox';
import type { SevOfRecord } from './types';

const MODE_WORDS = {
  off: ['éteint (FOODHUB_MEV=off)', 'off (FOODHUB_MEV=off)'],
  shadow: ['essai à blanc : rien n’est envoyé', 'shadow: nothing is sent'],
  simulator: ['simulateur (ventes d’essai)', 'simulator (training sales)'],
  on: ['production (factures réelles)', 'production (real invoices)'],
} as const;

/** The checklist under the MEV switch on the Expansion page. Reads Food Hub's own data and the last /health only. */
export async function mevChecks(): Promise<FeatureCheck[]> {
  const r = mevReadiness();
  const [settings, health, catalog] = await Promise.all([getMevSettings(), lastMevHealth(), getCatalog().catch(() => null)]);
  const kitchens = (catalog?.locations ?? []).filter((l) => l.active);
  const viaQcmev = kitchens.filter((l) => r.allowlist.includes(l.code) && sevOfRecord(settings, l.code) === 'qcmev');
  const h = health?.health;
  const href = '/settings/expansion/mev';
  return [
    { ok: r.mode !== 'off', fr: `Mode : ${MODE_WORDS[r.mode][0]}`, en: `Mode: ${MODE_WORDS[r.mode][1]}`, href },
    { ok: r.urlSet && r.secretSet, fr: r.urlSet && r.secretSet ? 'Adresse et clé de Takatak MEV en place' : `À fournir sur le serveur : ${r.missing.filter((k) => k !== 'FOODHUB_MEV' && k !== 'FOODHUB_MEV_LOCATIONS').join(', ') || '—'}${r.secretWeak ? ' (clé trop courte : 32 caractères minimum)' : ''}`, en: r.urlSet && r.secretSet ? 'Takatak MEV address and key set' : `Set on the server: ${r.missing.filter((k) => k !== 'FOODHUB_MEV' && k !== 'FOODHUB_MEV_LOCATIONS').join(', ') || '—'}${r.secretWeak ? ' (key too short: 32 characters minimum)' : ''}`, href },
    { ok: viaQcmev.length > 0, fr: viaQcmev.length ? `Cuisines facturées par Takatak MEV : ${viaQcmev.map((l) => l.name).join(', ')}` : 'Aucune cuisine ne passe encore par Takatak MEV', en: viaQcmev.length ? `Kitchens invoiced by Takatak MEV: ${viaQcmev.map((l) => l.name).join(', ')}` : 'No kitchen goes through Takatak MEV yet', href },
    { ok: Boolean(h), fr: h ? `Takatak MEV répond : ${h.environment || '?'}${h.certified ? ', certifié' : ', pas certifié'}` : `Takatak MEV pas encore joint${health?.error ? ` (${health.error})` : ''}`, en: h ? `Takatak MEV answers: ${h.environment || '?'}${h.certified ? ', certified' : ', not certified'}` : `Takatak MEV not reached yet${health?.error ? ` (${health.error})` : ''}`, href },
  ];
}

export interface MevLocationRow { code: string; name: string; allowlisted: boolean; sevOfRecord: SevOfRecord; active: boolean; why?: string; qcmev?: { deviceReady?: boolean; certReady?: boolean; usersReady?: boolean } }

const WHY: Record<string, [string, string]> = {
  mode_off: ['MEV éteint sur le serveur', 'MEV off on the server'],
  switch_off: ['interrupteur du propriétaire éteint', 'owner switch off'],
  not_allowlisted: ['pas dans FOODHUB_MEV_LOCATIONS', 'not in FOODHUB_MEV_LOCATIONS'],
  sev_none: ['aucun système de facturation choisi', 'no invoicing system chosen'],
  sev_clover_app: ['facturée par l’app MEV de Clover', 'invoiced by the Clover MEV app'],
  not_configured: ['adresse ou clé de Takatak MEV manquante', 'Takatak MEV address or key missing'],
  no_location: ['cuisine inconnue', 'unknown kitchen'],
  not_quebec: ['cuisine hors Québec (MEV est pour le Québec seulement)', 'kitchen outside Québec (MEV is for Québec only)'],
};

export async function mevStatus() {
  const r = mevReadiness();
  const [settings, health, catalog, outbox] = await Promise.all([getMevSettings(), lastMevHealth(), getCatalog().catch(() => null), mevOutboxSummary().catch(() => null)]);
  const kitchens = (catalog?.locations ?? []).filter((l) => l.active);
  const codes = [...new Set([...kitchens.map((l) => l.code), ...r.allowlist])];
  const locations: MevLocationRow[] = [];
  for (const code of codes) {
    const gate = await mevGate(code, { settings });
    const q = health?.health?.locations?.find((l) => l.locationId === code);
    locations.push({
      code, name: kitchens.find((l) => l.code === code)?.name ?? code, allowlisted: r.allowlist.includes(code), sevOfRecord: sevOfRecord(settings, code), active: gate.active,
      ...(gate.active ? {} : { why: gate.reason }), ...(q ? { qcmev: { deviceReady: q.deviceReady, certReady: q.certReady, usersReady: q.usersReady } } : {}),
    });
  }
  return { readiness: r, locations, why: WHY, health, outbox };
}

export type MevStatus = Awaited<ReturnType<typeof mevStatus>>;
