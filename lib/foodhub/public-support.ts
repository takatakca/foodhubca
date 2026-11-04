/** Public group support address, already published by TAKATAK's brand/contact/privacy pages.
 * Source: takatak-v1/src/lib/website/brand.ts. A configured Food Hub address takes precedence.
 * This affects contact presentation only; legalInfo() and company/privacy disclosures remain unchanged. */
export const PUBLIC_GROUP_SUPPORT_EMAIL = 'support@takatak.ca';

export function publicSupportEmail(configured?: string | null): string {
  return String(configured ?? '').trim() || PUBLIC_GROUP_SUPPORT_EMAIL;
}

export function publicSupportHref(configured?: string | null): string {
  return `mailto:${publicSupportEmail(configured)}`;
}
