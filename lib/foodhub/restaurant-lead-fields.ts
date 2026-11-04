// Shared public enquiry fields: safe to import in the browser, without storage or notification code.
export const LEAD_PLATFORMS = ['uber', 'doordash', 'skip', 'tgtg', 'direct', 'phone'] as const;
export type LeadPlatform = (typeof LEAD_PLATFORMS)[number];
export const LEAD_PROVINCES = ['QC', 'ON', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'YT', 'NT', 'NU'] as const;
export type LeadProvince = (typeof LEAD_PROVINCES)[number];
export const LEAD_LIMITS = { restaurant: 120, contact: 80, email: 254, phone: 30, city: 80, address: 200, website: 200, message: 2000, source: 40 } as const;
export const LEAD_MAX_BODY_BYTES = 16_000;
