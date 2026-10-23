import type { T } from '@/lib/i18n';

/**
 * The reason a platform gives for a store's state, in the owner's words (A2 Stores): DoorDash answers
 * "out_of_business — Deactivated by DoorDash", Uber "OFFLINE" or "PAUSED_BY_RESTAURANT". Raw codes never reach the
 * screen; an unknown code is shown as the platform wrote it, without underscores. Returns null when there is nothing
 * worth showing.
 */
const REASONS: Record<string, [string, string]> = {
  out_of_business: ['Fermé pour de bon selon la plateforme', 'Closed for good according to the platform'],
  store_closed: ['Fermé sur la plateforme', 'Closed on the platform'],
  temporarily_deactivated: ['Désactivé pour un temps par la plateforme', 'Temporarily deactivated by the platform'],
  payment_issue: ['Désactivé : paiement à régler avec la plateforme', 'Deactivated: a payment to settle with the platform'],
  banking_issue: ['Désactivé : coordonnées bancaires à vérifier', 'Deactivated: banking details to check'],
  menu_issue: ['Désactivé : menu à corriger', 'Deactivated: the menu needs fixing'],
  tablet_issue: ['Désactivé : tablette à vérifier', 'Deactivated: the tablet needs checking'],
  missed_orders: ['Désactivé : trop de commandes manquées', 'Deactivated: too many missed orders'],
  offline: ['Hors ligne sur la plateforme', 'Offline on the platform'],
  paused_by_restaurant: ['Mis en pause par le restaurant', 'Paused by the restaurant'],
  paused_by_uber: ['Mis en pause par Uber Eats', 'Paused by Uber Eats'],
  invisible: ['Masqué sur la plateforme', 'Hidden on the platform'],
};
const NOTES: Array<[RegExp, [string, string]]> = [
  [/^deactivated by (doordash|uber eats|uber|skip(thedishes)?)$/i, ['désactivé par la plateforme', 'deactivated by the platform']],
  [/^paused from takatak$/i, ['mis en pause d’ici', 'paused from here']],
  [/^changed on uber eats$/i, ['changé chez Uber Eats', 'changed on Uber Eats']],
  [/^holiday closure$/i, ['fermé pour un jour férié', 'closed for a holiday']],
];

const tidy = (s: string) => s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

export function statusDetailText(t: T, detail: string | null | undefined): string | null {
  if (!detail?.trim()) return null;
  const parts = detail.split(/\s+—\s+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const code = REASONS[part.toLowerCase()];
    if (code) { out.push(t(code[0], code[1])); continue; }
    const note = NOTES.find(([re]) => re.test(part));
    if (note) { out.push(t(note[1][0], note[1][1])); continue; }
    out.push(tidy(part));
  }
  // "Désactivé … · désactivé par la plateforme" says the same twice: keep the first.
  const unique = out.filter((x, i) => i === 0 || !/plateforme|platform/i.test(x) || !/plateforme|platform/i.test(out[0]));
  return unique.join(' · ') || null;
}
