// Customer identity: Food Hub is the ONE customer store of the TAKATAK brand websites (pppmtl.com first).
// A customer is a verified cell number. The website never keeps a customer database: it asks Food Hub to text a
// code, Food Hub checks it, creates the record the first time, and hands back a signed token the site keeps in an
// httpOnly cookie. Loyalty (LOY4LTY) and gift cards (REW4RDS) will key on the same E.164 number (adapters.ts).
//
// "Tenant" here = the brand website that talks to this API (its slug, e.g. "pppmtl"), NOT the merchant instance of
// lib/foodhub/tenant.ts. One customer record can be shared by several brand websites (tenants[]).
//
// Privacy (Québec Loi 25): only what the order flow needs — phone, name, e-mail, language, marketing consent,
// addresses, favourites. Codes are stored hashed and never returned or logged. A customer can be deleted: the record
// is anonymised (store.ts anonymiseCustomer) and every token stops working.

export type CustomerLang = 'fr' | 'en';

export interface CustomerAddress {
  /** "Maison", "Bureau"… */
  label?: string;
  street: string;
  unit?: string;
  city: string;
  province: string;
  /** Canadian format "H4A 1E1". */
  postalCode: string;
  /** Door code, floor, "leave at the door"… */
  instructions?: string;
}

export interface MasterCustomer {
  /** cus_<random>, stable for the life of the record. */
  id: string;
  /** E.164 (+15145550123). Empty once anonymised. */
  phone: string;
  /** Brand websites that verified this number (first one first). */
  tenants: string[];
  name?: string;
  email?: string;
  lang: CustomerLang;
  marketingConsent: boolean;
  createdAt: string;
  /** Last successful code check. */
  verifiedAt: string;
  /** Bumped by logout / delete: every token carrying an older version is void. */
  tokenVersion: number;
  addresses: CustomerAddress[];
  /** Menu item refs ("<ref>" as the website names them). */
  favourites: string[];
  /** Set by DELETE /me: the record is anonymised and kept only as an id + dates. */
  deletedAt?: string;
  /** takatak-v1 MasterIdentity id, set when the customer signed in through TAKATAK (takatak-bridge.ts). */
  takatakIdentityId?: string;
}

/** What the website receives (contract § A.2): never tenants, token version or consent internals. */
export interface PublicCustomer {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  lang: CustomerLang;
  marketingConsent: boolean;
  createdAt: string;
  verifiedAt: string;
}

export function toPublicCustomer(c: MasterCustomer): PublicCustomer {
  return {
    id: c.id, phone: c.phone, ...(c.name ? { name: c.name } : {}), ...(c.email ? { email: c.email } : {}), lang: c.lang,
    marketingConsent: c.marketingConsent, createdAt: c.createdAt, verifiedAt: c.verifiedAt,
  };
}

/** Display name of each brand website, used in the SMS ("Votre code PPP Pizzeria : …"). */
export const CUSTOMER_TENANT_NAMES: Record<string, string> = { pppmtl: 'PPP Pizzeria', on2go: 'ON2GO' };

/** on2go.ca: the consumer app. Always allowed (our own site); it signs in through TAKATAK (takatak-bridge.ts) or by text. */
export const ON2GO_TENANT = 'on2go';

export const DEFAULT_CUSTOMER_TENANTS = ['pppmtl'];
const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Brand websites allowed to call this API: FOODHUB_CUSTOMER_TENANTS (comma-separated slugs), default "pppmtl". */
export function allowedCustomerTenants(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = String(env.FOODHUB_CUSTOMER_TENANTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => TENANT_SLUG.test(s));
  return [...new Set([...(raw.length ? raw : DEFAULT_CUSTOMER_TENANTS), ON2GO_TENANT])];
}

/** The tenant slug of a request body, or null when it is not an allowed brand website. */
export function customerTenant(raw: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  const t = String(raw ?? '').trim().toLowerCase();
  return TENANT_SLUG.test(t) && allowedCustomerTenants(env).includes(t) ? t : null;
}

export function tenantDisplayName(tenant: string): string {
  return CUSTOMER_TENANT_NAMES[tenant] ?? tenant.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function customerLang(raw: unknown, fallback: CustomerLang = 'fr'): CustomerLang {
  return raw === 'en' ? 'en' : raw === 'fr' ? 'fr' : fallback;
}
