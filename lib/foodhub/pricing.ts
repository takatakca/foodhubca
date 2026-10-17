// Public price of ON2GO Hub / TAKATAK Food Hub (owner's decision of 2026-10-16), the one source for the public pages
// (/hub, /hub/tarifs, llms.txt) and their structured data.
//  - 14-day free trial (Clover runs it), then CAD $50 per month per app, Canada only;
//  - CAD $15 per month for each ADDITIONAL brand on each delivery platform it is connected to (the first brand is
//    included in the $50): a second brand on Uber Eats, DoorDash and SkipTheDishes = 3 × $15 = $45 per month.
//  - Clover bills the merchant (never us).
// Same numbers as lib/foodhub/pos/clover-pricing.ts on feature/clover-billing-extra-brands: when that branch merges,
// one of the two files re-exports the other. The terms page (fix/legal-pages-complete) should import these too.
//
// The Clover App Market link is FOODHUB_APP_MARKET_URL (empty until Clover approves the listing): without it the pages
// say "Coming soon to the Clover App Market" and label the prices "Planned launch pricing", and no Offer is published
// in the structured data. FOODHUB_APP_MARKET_STATUS=review (set by the owner only once the listing is really submitted
// to Clover) adds "under review by Clover"; anything else says "coming soon". No server-only import here.

export type Lang = 'fr' | 'en';
export type Bilingual = { fr: string; en: string };

export const TRIAL_DAYS = 14;
export const STANDARD_MONTHLY_CAD = 50;
export const EXTRA_BRAND_PLATFORM_CAD = 15;

export const PRICING = {
  trialDays: TRIAL_DAYS,
  monthlyPerApp: STANDARD_MONTHLY_CAD,
  extraBrandPerPlatform: EXTRA_BRAND_PLATFORM_CAD,
  currency: 'CAD',
  country: 'CA',
} as const;

/** The one pricing sentence, everywhere a price is stated. */
export const PRICING_STATEMENT: Bilingual = {
  fr: `Essai gratuit de ${TRIAL_DAYS} jours, puis ${STANDARD_MONTHLY_CAD} $/mois par application, + ${EXTRA_BRAND_PLATFORM_CAD} $/mois par marque supplémentaire par plateforme, taxes en sus, facturé par Clover.`,
  en: `${TRIAL_DAYS}-day free trial, then $${STANDARD_MONTHLY_CAD}/month per app, + $${EXTRA_BRAND_PLATFORM_CAD}/month per extra brand per platform, plus applicable taxes, billed by Clover.`,
};

/** "50 $" (French, Canada) / "$50" (English). Whole dollars when the amount has no cents. */
export function formatCad(amount: number, lang: Lang): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return lang === 'fr' ? `${text.replace('.', ',')} $` : `$${text}`;
}

/** Monthly cost of a plan with `extraUnits` extra brand × platform units. */
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
 * "review" only when the owner set FOODHUB_APP_MARKET_STATUS=review after really submitting the listing; else "soon". */
export type AppMarketStatus = 'soon' | 'review' | 'live';

export function appMarketStatus(
  url: string | null = appMarketUrl(),
  raw: string | null | undefined = typeof process !== 'undefined' ? process.env.FOODHUB_APP_MARKET_STATUS : undefined,
): AppMarketStatus {
  if (url) return 'live';
  return String(raw ?? '').trim().toLowerCase() === 'review' ? 'review' : 'soon';
}

/** The delivery platforms whose ON2GO Hub integration a page may present as live (the platform approved it).
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
