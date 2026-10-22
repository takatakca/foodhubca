// Public price of the two Clover apps sold on ON2GO.ca (owner's decisions of 2026-10-16 and 2026-10-17), the one source
// for the public pages (/hub, /hub/tarifs, llms.txt) and their structured data.
//  - TAKATAK Food Hub: 14-day free trial (Clover runs it), then CAD $50 per month, Canada only; CAD $15 per month for
//    each ADDITIONAL brand on each delivery platform it is connected to (the first brand is included in the $50): a
//    second brand on Uber Eats, DoorDash and SkipTheDishes = 3 × $15 = $45 per month.
//  - TAKATAK Phone AI (the second Clover app): 14-day free trial, then CAD $50 per month, plus CAD $0.25 per AI minute.
//  - Clover bills the merchant (never us).
// The Food Hub numbers are those of lib/foodhub/pos/clover-pricing.ts (re-exported here, never typed twice); the phone
// numbers match PHONE_PRICE in lib/foodhub/pos/clover-phone-minutes.ts (tests/public-hub.test.ts checks it; that file
// has server imports, so it is not imported here).
//
// Both apps are SUBMITTED to the Clover App Market (pending review, 2026-10-17). The Clover App Market link is
// FOODHUB_APP_MARKET_URL (empty until Clover approves the listing): without it the pages say "under review by Clover"
// and no Offer is published in the structured data. FOODHUB_APP_MARKET_STATUS=soon brings back "coming soon" (only if a
// listing is withdrawn). No server-only import here.

import { EXTRA_BRAND_PLATFORM_CAD, formatCad, STANDARD_MONTHLY_CAD, TRIAL_DAYS, type Bilingual, type Lang } from './pos/clover-pricing';

export { EXTRA_BRAND_PLATFORM_CAD, formatCad, STANDARD_MONTHLY_CAD, TRIAL_DAYS, type Bilingual, type Lang };

/** TAKATAK Phone AI: CAD per minute the automated assistant is on the line (same 14-day trial and CAD $50 per month). */
export const PHONE_MINUTE_CAD = 0.25;
export const PHONE_MONTHLY_CAD = 50;
export const PHONE_TRIAL_DAYS = 14;

export const FOOD_HUB_APP_NAME = 'TAKATAK Food Hub';
export const PHONE_APP_NAME = 'TAKATAK Phone AI';

export const PRICING = {
  trialDays: TRIAL_DAYS,
  monthlyPerApp: STANDARD_MONTHLY_CAD,
  extraBrandPerPlatform: EXTRA_BRAND_PLATFORM_CAD,
  phonePerMinute: PHONE_MINUTE_CAD,
  currency: 'CAD',
  country: 'CA',
} as const;

/** "50 $ CA" (French, Canada) / "CAD $50" (English); "0,25 $ CA" / "CAD $0.25". */
export function formatCadLabel(amount: number, lang: Lang): string {
  const text = formatCad(amount, lang);
  return lang === 'fr' ? `${text} CA` : `CAD ${text}`;
}

const fr$ = (n: number) => formatCadLabel(n, 'fr');
const en$ = (n: number) => formatCadLabel(n, 'en');

/** The one pricing sentence, everywhere a price is stated: both apps. */
export const PRICING_STATEMENT: Bilingual = {
  fr: `Essai gratuit de ${TRIAL_DAYS} jours, puis ${fr$(STANDARD_MONTHLY_CAD)}/mois par application. ${FOOD_HUB_APP_NAME} : ${fr$(EXTRA_BRAND_PLATFORM_CAD)} par plateforme par mois pour chaque marque supplémentaire. ${PHONE_APP_NAME} : + ${fr$(PHONE_MINUTE_CAD)} par minute d’IA. Taxes en sus. Facturé par Clover.`,
  en: `${TRIAL_DAYS}-day free trial, then ${en$(STANDARD_MONTHLY_CAD)}/month per app. ${FOOD_HUB_APP_NAME}: extra brand ${en$(EXTRA_BRAND_PLATFORM_CAD)} per platform per month. ${PHONE_APP_NAME}: + ${en$(PHONE_MINUTE_CAD)} per AI minute. Plus applicable taxes, billed by Clover.`,
};

/** TAKATAK Phone AI alone, for the AI phone page and the pricing page. */
export const PHONE_PRICING_STATEMENT: Bilingual = {
  fr: `Essai gratuit de ${PHONE_TRIAL_DAYS} jours, puis ${fr$(PHONE_MONTHLY_CAD)}/mois, + ${fr$(PHONE_MINUTE_CAD)} par minute d’IA. Taxes en sus. Facturé par Clover.`,
  en: `${PHONE_TRIAL_DAYS}-day free trial, then ${en$(PHONE_MONTHLY_CAD)}/month, + ${en$(PHONE_MINUTE_CAD)} per AI minute. Plus applicable taxes, billed by Clover.`,
};

/** Monthly cost of a Food Hub plan with `extraUnits` extra brand × platform units. */
export function monthlyTotalCad(extraUnits = 0): number {
  return STANDARD_MONTHLY_CAD + Math.max(0, Math.floor(Number(extraUnits) || 0)) * EXTRA_BRAND_PLATFORM_CAD;
}

/**
 * The listing's public Clover App Market address, or null while the app is not listed. Only an https address on
 * clover.com (or a subdomain) is accepted: a typo never becomes a link or an Offer.
 */
export function appMarketUrl(raw: string | null | undefined = typeof process !== 'undefined' ? process.env.FOODHUB_APP_MARKET_URL : undefined): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    if (host !== 'clover.com' && !host.endsWith('.clover.com')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Where the Clover App Market listing stands, for the public wording: "live" once FOODHUB_APP_MARKET_URL is set;
 * otherwise "review" (both apps were submitted on 2026-10-17), unless FOODHUB_APP_MARKET_STATUS=soon. */
export type AppMarketStatus = 'soon' | 'review' | 'live';

export function appMarketStatus(
  url: string | null = appMarketUrl(),
  raw: string | null | undefined = typeof process !== 'undefined' ? process.env.FOODHUB_APP_MARKET_STATUS : undefined,
): AppMarketStatus {
  if (url) return 'live';
  return String(raw ?? '').trim().toLowerCase() === 'soon' ? 'soon' : 'review';
}

/** The delivery platforms whose integration a page may present as live (the platform approved it).
 * FOODHUB_PUBLIC_LIVE_PLATFORMS, comma-separated among uber, doordash, skip; unset = "uber" only. A platform not in
 * the list shows "integration in certification", and its page stays out of the index, the sitemap and llms.txt. */
export type HubPlatform = 'uber' | 'doordash' | 'skip';
export const HUB_PLATFORMS: HubPlatform[] = ['uber', 'doordash', 'skip'];

export function livePlatforms(
  raw: string | null | undefined = typeof process !== 'undefined' ? process.env.FOODHUB_PUBLIC_LIVE_PLATFORMS : undefined,
): HubPlatform[] {
  const v = String(raw ?? '').trim();
  if (!v) return ['uber'];
  const asked = v.toLowerCase().split(/[\s,]+/);
  return HUB_PLATFORMS.filter((p) => asked.includes(p));
}
