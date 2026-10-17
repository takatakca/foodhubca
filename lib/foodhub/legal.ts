// Public legal / support details for the privacy policy, terms of use and support pages
// (/legal/privacy, /legal/terms, /legal/support) — also the URLs given to the Clover App Market.
// Everything comes from environment variables so the owner can change it without code.
// The pages show a "draft" banner until FOODHUB_LEGAL_APPROVED=true (owner / lawyer review done).
import { SUPPORT_HOURS_DEFAULT } from './clover-listing';
import { publicBaseUrl } from './config';

export interface LegalInfo {
  company: string;
  address: string;
  supportEmail: string | null;
  supportPhone: string | null;
  /** Shown as is in both languages when FOODHUB_SUPPORT_HOURS is set, otherwise the default per language. */
  supportHours: { fr: string; en: string };
  privacyOfficer: string;
  updated: string;
  approved: boolean;
  /** Free trial length, the monthly price per app and the price of each additional brand per platform (CAD),
   *  billed only through Clover App Market billing. */
  pricing: { trialDays: number; monthlyCad: number; extraBrandCad: number };
  /** TAKATAK Phone AI, the second Clover app (automated phone assistant): free trial, monthly price and the price of each
   *  minute the assistant is on the line (CAD), billed by Clover through the Clover App Market; Canada only. */
  phonePricing: { trialDays: number; monthlyCad: number; minuteCad: number };
  appName: string;
  phoneAppName: string;
  baseUrl: string;
}

export function legalInfo(): LegalInfo {
  const hours = (process.env.FOODHUB_SUPPORT_HOURS || '').trim();
  return {
    company: process.env.FOODHUB_LEGAL_COMPANY || 'Quadro Holdings LTEE',
    address: process.env.FOODHUB_LEGAL_ADDRESS || '6280, av. Somerled, Montréal (Québec) H3X 2B6, Canada',
    supportEmail: process.env.FOODHUB_SUPPORT_EMAIL || null,
    supportPhone: process.env.FOODHUB_SUPPORT_PHONE || null,
    supportHours: hours ? { fr: hours, en: hours } : SUPPORT_HOURS_DEFAULT,
    privacyOfficer: process.env.FOODHUB_PRIVACY_OFFICER || '',
    updated: process.env.FOODHUB_LEGAL_UPDATED || '2026-10-16',
    approved: process.env.FOODHUB_LEGAL_APPROVED === 'true',
    pricing: {
      trialDays: positiveInt(process.env.FOODHUB_TRIAL_DAYS, 14),
      monthlyCad: positiveInt(process.env.FOODHUB_MONTHLY_PRICE_CAD, 50),
      extraBrandCad: positiveInt(process.env.FOODHUB_EXTRA_BRAND_PRICE_CAD, 15),
    },
    phonePricing: {
      trialDays: positiveInt(process.env.FOODHUB_PHONE_TRIAL_DAYS, 14),
      monthlyCad: positiveInt(process.env.FOODHUB_PHONE_MONTHLY_PRICE_CAD, 50),
      minuteCad: positiveCents(process.env.FOODHUB_PHONE_MINUTE_PRICE_CAD, 0.25),
    },
    appName: 'TAKATAK Food Hub',
    phoneAppName: 'TAKATAK Phone AI',
    baseUrl: publicBaseUrl(),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number((raw || '').trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** A positive amount with at most two decimals ("0.25", "1"); anything else falls back to the default. */
function positiveCents(raw: string | undefined, fallback: number): number {
  const s = (raw || '').trim();
  const n = Number(s);
  return /^\d+(\.\d{1,2})?$/.test(s) && n > 0 ? n : fallback;
}

/** An amount as French ("0,25") or English ("0.25") text; whole amounts stay whole ("50"). */
function cad(n: number, lang: 'fr' | 'en'): string {
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return lang === 'fr' ? s.replace('.', ',') : s;
}

/** The fees wording shared by the terms (§6) and the support FAQ, so both always say the same thing. */
export function feesText(p: LegalInfo['pricing']): { fr: string; en: string } {
  return {
    fr: `Essai gratuit de ${p.trialDays} jours, puis ${p.monthlyCad} $ CA par mois par application, facturés uniquement par la facturation du Clover App Market : rien n’est facturé en dehors de Clover. Ce prix couvre une marque sur toutes ses plateformes ; chaque marque additionnelle coûte ${p.extraBrandCad} $ CA par mois par plateforme, facturés par Clover (le prix est affiché avant l’ajout). Le prix en vigueur est indiqué dans la fiche de l’application du Clover App Market.`,
    en: `Free ${p.trialDays}-day trial, then CAD $${p.monthlyCad} per month per app, billed only through Clover App Market billing: nothing is billed outside Clover. This price covers one brand on all its platforms; each additional brand costs CAD $${p.extraBrandCad} per month per platform, billed by Clover (the price is shown before you add it). The current price is shown on the app’s Clover App Market listing.`,
  };
}

/** The TAKATAK Phone AI fees, shown next to feesText() in the terms (§6) and the support FAQ. Minutes follow the
 *  metering on main (pos/clover-phone-minutes.ts, phone/metering.ts): AI time only (greeting to hand-off, goodbye or
 *  hang-up), order or not, ceil(seconds / 60) per call, never the hold or the person after a transfer, ACTIVE
 *  subscriptions only (never in the trial). */
export function phoneFeesText(p: LegalInfo['phonePricing']): { fr: string; en: string } {
  return {
    fr: `Essai gratuit de ${p.trialDays} jours, puis ${cad(p.monthlyCad, 'fr')} $ CA par mois, plus ${cad(p.minuteCad, 'fr')} $ CA par minute d’appel avec l’assistant automatisé, qu’une commande soit passée ou non. Seul le temps où l’assistant est en ligne avec l’appelant est compté (de sa réponse jusqu’au transfert à une personne, à la fin de la conversation ou au raccrochage), arrondi à la minute supérieure pour chaque appel ; l’attente pendant un transfert et le temps passé avec une personne du restaurant ne sont pas comptés, et aucune minute n’est facturée pendant l’essai gratuit ni lorsque l’abonnement Clover n’est pas actif. Le tout est facturé uniquement par Clover, par la facturation du Clover App Market : rien n’est facturé en dehors de Clover. Offert au Canada seulement.`,
    en: `Free ${p.trialDays}-day trial, then CAD $${cad(p.monthlyCad, 'en')} per month, plus CAD $${cad(p.minuteCad, 'en')} per minute of call with the automated assistant, whether or not an order is placed. Only the time the assistant is on the line with the caller is counted (from its answer until the transfer to a person, the end of the conversation or the caller hanging up), rounded up to the next minute for each call; the wait during a transfer and the time spent with a person from the restaurant are not counted, and no minutes are billed during the free trial or while the Clover subscription is not active. Everything is billed only through Clover App Market billing: nothing is billed outside Clover. Offered in Canada only.`,
  };
}

/** When a merchant's Clover tokens are deleted: the same words on the privacy, terms and support pages. */
export const TOKEN_DELETION = {
  fr: 'sont supprimés lorsque Clover nous avise de la désinstallation de l’application, ou sur demande',
  en: 'are deleted when Clover notifies us that the app was uninstalled, or on request',
} as const;

export const LEGAL_PATHS = { index: '/legal', privacy: '/legal/privacy', terms: '/legal/terms', support: '/legal/support' } as const;

export function legalUrls() {
  const b = publicBaseUrl();
  return { privacy: `${b}${LEGAL_PATHS.privacy}`, terms: `${b}${LEGAL_PATHS.terms}`, support: `${b}${LEGAL_PATHS.support}` };
}
