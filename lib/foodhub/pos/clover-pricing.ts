// TAKATAK Food Hub price on the Clover App Market (owner's decision of 2026-10-16, set in the Clover developer dashboard):
//  - subscription tier "Standard": CAD $50 per month, Canada only, 14-day free trial (Clover runs the trial);
//  - metered event "Extra brand, per platform, per month": CAD $15 per unit. The first brand is included in the $50;
//    each ADDITIONAL brand costs $15 for each delivery platform it is connected to (Uber Eats, DoorDash, SkipTheDishes).
//    A second brand on all three platforms = 3 units = $45 per month.
// Clover bills the merchant (never Food Hub). This file has no server imports: the console pages use it too.

export type Lang = 'fr' | 'en';
export type Bilingual = { fr: string; en: string };

export const STANDARD_MONTHLY_CAD = 50;
export const EXTRA_BRAND_PLATFORM_CAD = 15;
export const TRIAL_DAYS = 14;

/** The delivery platforms an extra brand is billed for (Too Good To Go is a sales channel, never billed). */
export const BILLED_PLATFORMS = ['uber_eats', 'doordash', 'skip'] as const;
export type BilledPlatform = (typeof BILLED_PLATFORMS)[number];
export const BILLED_PLATFORM_LABELS: Record<BilledPlatform, string> = { uber_eats: 'Uber Eats', doordash: 'DoorDash', skip: 'SkipTheDishes' };

export function isBilledPlatform(v: unknown): v is BilledPlatform {
  return typeof v === 'string' && (BILLED_PLATFORMS as readonly string[]).includes(v);
}

/** The one pricing sentence, everywhere a price is stated (listing, settings, notices). */
export const PRICING_STATEMENT: Bilingual = {
  fr: 'Essai gratuit de 14 jours, puis 50 $/mois par app, + 15 $ par marque supplémentaire par plateforme, facturé par Clover.',
  en: '14-day free trial, then $50/month per app, + $15 per extra brand per platform, billed by Clover.',
};

/** "50 $" (French, Canada) / "$50" (English). Whole dollars when the amount has no cents. */
export function formatCad(amount: number, lang: Lang): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  const whole = Number.isInteger(n);
  const text = whole ? String(n) : n.toFixed(2);
  return lang === 'fr' ? `${text.replace('.', ',')} $` : `$${text}`;
}

/** Monthly amount of N extra-brand units. */
export function extraBrandsMonthlyCad(units: number): number {
  return Math.max(0, Math.floor(Number(units) || 0)) * EXTRA_BRAND_PLATFORM_CAD;
}

/** What the console needs from Clover's billing_info to describe the subscription. */
export interface BillingView {
  status: string | null;
  inTrial: boolean;
  plan: string | null;
  daysLapsed?: number | null;
  /** Days left in the free trial (null = unknown). */
  trialDaysLeft?: number | null;
  /** The trial end is estimated from the install date (Clover did not say). */
  trialEstimated?: boolean;
  /** Monthly price Clover reported for the tier, in cents (null = not reported: the owner's $50 is shown). */
  amountCents?: number | null;
}

/** Plain-language subscription line, e.g. "Essai gratuit : 9 jours restants" or "Forfait Standard 50 $/mois". */
export function billingStatusText(b: BillingView | null | undefined, lang: Lang): string {
  const fr = lang === 'fr';
  if (!b) return fr ? 'Abonnement Clover inconnu (Clover n’a pas encore répondu).' : 'Clover subscription unknown (Clover has not answered yet).';
  const status = String(b.status || '').toUpperCase();
  if (b.inTrial && (status === 'ACTIVE' || status === '')) {
    const d = typeof b.trialDaysLeft === 'number' ? Math.max(0, Math.ceil(b.trialDaysLeft)) : null;
    if (d === null) return fr ? 'Essai gratuit en cours' : 'Free trial in progress';
    const about = b.trialEstimated ? (fr ? 'environ ' : 'about ') : '';
    if (d === 0) return fr ? 'Essai gratuit : dernier jour' : 'Free trial: last day';
    return fr ? `Essai gratuit : ${about}${d} jour${d > 1 ? 's' : ''} restant${d > 1 ? 's' : ''}` : `Free trial: ${about}${d} day${d > 1 ? 's' : ''} left`;
  }
  const plan = (b.plan || 'Standard').trim();
  const price = typeof b.amountCents === 'number' && b.amountCents > 0 ? b.amountCents / 100 : STANDARD_MONTHLY_CAD;
  if (status === 'ACTIVE') return fr ? `Forfait ${plan} ${formatCad(price, 'fr')}/mois` : `${plan} plan ${formatCad(price, 'en')}/month`;
  if (status === 'LAPSED') {
    const d = typeof b.daysLapsed === 'number' && b.daysLapsed > 0 ? b.daysLapsed : null;
    return fr ? `Paiement Clover en retard${d ? ` (${d} jour${d > 1 ? 's' : ''})` : ''}` : `Clover payment overdue${d ? ` (${d} day${d > 1 ? 's' : ''})` : ''}`;
  }
  if (status === 'SUPPRESSED') return fr ? 'Abonnement suspendu par Clover' : 'Subscription suspended by Clover';
  if (status === 'INACTIVE') return fr ? 'Abonnement inactif' : 'Subscription inactive';
  return fr ? `Abonnement Clover : ${status || 'statut inconnu'}` : `Clover subscription: ${status || 'unknown status'}`;
}

/** Active = the subscription is paid (ACTIVE, not in trial); lapsed = overdue / suspended / inactive. */
export function billingTone(b: BillingView | null | undefined): 'trial' | 'active' | 'lapsed' | 'unknown' {
  if (!b) return 'unknown';
  const status = String(b.status || '').toUpperCase();
  if (b.inTrial && (status === 'ACTIVE' || status === '')) return 'trial';
  if (status === 'ACTIVE') return 'active';
  if (status === 'LAPSED' || status === 'SUPPRESSED' || status === 'INACTIVE') return 'lapsed';
  return 'unknown';
}

/** Price notice before a store of an extra brand is connected: "+15 $/mois pour cette plateforme". */
export function extraPlatformNotice(lang: Lang, addedUnits = 1): string {
  const n = Math.max(1, Math.floor(addedUnits));
  const amount = formatCad(extraBrandsMonthlyCad(n), lang);
  if (lang === 'fr') return n === 1 ? `+${amount}/mois pour cette plateforme` : `+${amount}/mois pour ces ${n} plateformes`;
  return n === 1 ? `+${amount}/month for this platform` : `+${amount}/month for these ${n} platforms`;
}

/** Price notice before a new brand is added: it is an extra brand once the first brand is connected. */
export function extraBrandNotice(lang: Lang): string {
  const amount = formatCad(EXTRA_BRAND_PLATFORM_CAD, lang);
  return lang === 'fr'
    ? `Marque supplémentaire : +${amount}/mois pour chaque plateforme où elle sera branchée (Uber Eats, DoorDash, SkipTheDishes), facturé par Clover. Votre première marque est incluse dans le forfait de ${formatCad(STANDARD_MONTHLY_CAD, 'fr')}/mois.`
    : `Extra brand: +${amount}/month for each platform it is connected to (Uber Eats, DoorDash, SkipTheDishes), billed by Clover. Your first brand is included in the ${formatCad(STANDARD_MONTHLY_CAD, 'en')}/month plan.`;
}
