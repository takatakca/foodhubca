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
  appName: string;
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
    appName: 'TAKATAK Food Hub',
    baseUrl: publicBaseUrl(),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number((raw || '').trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** The fees wording shared by the terms (§6) and the support FAQ, so both always say the same thing. */
export function feesText(p: LegalInfo['pricing']): { fr: string; en: string } {
  return {
    fr: `Essai gratuit de ${p.trialDays} jours, puis ${p.monthlyCad} $ CA par mois par application, facturés uniquement par la facturation du Clover App Market : rien n’est facturé en dehors de Clover. Ce prix couvre une marque sur toutes ses plateformes ; chaque marque additionnelle coûte ${p.extraBrandCad} $ CA par mois par plateforme, facturés par Clover (le prix est affiché avant l’ajout). Le prix en vigueur est indiqué dans la fiche de l’application du Clover App Market.`,
    en: `Free ${p.trialDays}-day trial, then CAD $${p.monthlyCad} per month per app, billed only through Clover App Market billing: nothing is billed outside Clover. This price covers one brand on all its platforms; each additional brand costs CAD $${p.extraBrandCad} per month per platform, billed by Clover (the price is shown before you add it). The current price is shown on the app’s Clover App Market listing.`,
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
