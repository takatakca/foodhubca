// Public legal / support details for the privacy policy, terms of use and support pages
// (/legal/privacy, /legal/terms, /legal/support) — also the URLs given to the Clover App Market.
// Everything comes from environment variables so the owner can change it without code.
// The pages show a "draft" banner until FOODHUB_LEGAL_APPROVED=true (owner / lawyer review done).
import { publicBaseUrl } from './config';

export interface LegalInfo {
  company: string;
  address: string;
  supportEmail: string | null;
  supportPhone: string | null;
  privacyOfficer: string;
  updated: string;
  approved: boolean;
  appName: string;
  baseUrl: string;
}

export function legalInfo(): LegalInfo {
  return {
    company: process.env.FOODHUB_LEGAL_COMPANY || 'Quadro Holdings LTEE',
    address: process.env.FOODHUB_LEGAL_ADDRESS || '6280, av. Somerled, Montréal (Québec) H3X 2B6, Canada',
    supportEmail: process.env.FOODHUB_SUPPORT_EMAIL || null,
    supportPhone: process.env.FOODHUB_SUPPORT_PHONE || null,
    privacyOfficer: process.env.FOODHUB_PRIVACY_OFFICER || '',
    updated: process.env.FOODHUB_LEGAL_UPDATED || '2026-10-05',
    approved: process.env.FOODHUB_LEGAL_APPROVED === 'true',
    appName: 'TAKATAK Food Hub',
    baseUrl: publicBaseUrl(),
  };
}

export const LEGAL_PATHS = { privacy: '/legal/privacy', terms: '/legal/terms', support: '/legal/support' } as const;

export function legalUrls() {
  const b = publicBaseUrl();
  return { privacy: `${b}${LEGAL_PATHS.privacy}`, terms: `${b}${LEGAL_PATHS.terms}`, support: `${b}${LEGAL_PATHS.support}` };
}
