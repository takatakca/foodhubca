// Validation of what the website may change on a customer (contract § A.4–A.6): profile fields, addresses (max 5),
// favourites (max 50). Each returns either a clean patch or a 422 with a clear message — nothing partial is saved.
import { normalizePostal } from '../delivery/address';
import { normalizeEmail } from '../notify';
import { cleanAddress } from './store';
import type { CustomerAddress, MasterCustomer } from './types';

export const ADDRESSES_MAX = 5;
export const FAVOURITES_MAX = 50;
export const NAME_MAX = 80;

export type Invalid = { ok: false; status: 422; error: string };
const bad = (error: string): Invalid => ({ ok: false, status: 422, error });

export type ProfilePatch = Partial<Pick<MasterCustomer, 'name' | 'email' | 'lang' | 'marketingConsent'>> & { clearName?: boolean; clearEmail?: boolean };

/** PATCH /me: name (1–80 chars, null clears), email (valid, null clears), lang (fr | en), marketingConsent (boolean). */
export function validateProfilePatch(body: Record<string, unknown> | null | undefined): { ok: true; patch: ProfilePatch } | Invalid {
  const patch: ProfilePatch = {};
  if (!body || typeof body !== 'object') return bad('Body must be a JSON object.');
  if ('name' in body) {
    if (body.name === null || body.name === '') patch.clearName = true;
    else if (typeof body.name !== 'string') return bad('name must be text.');
    else {
      const name = body.name.replace(/\s+/g, ' ').trim();
      if (!name || name.length > NAME_MAX) return bad(`name must be 1 to ${NAME_MAX} characters.`);
      patch.name = name;
    }
  }
  if ('email' in body) {
    if (body.email === null || body.email === '') patch.clearEmail = true;
    else {
      const email = typeof body.email === 'string' ? normalizeEmail(body.email) : null;
      if (!email || email.length > 120) return bad('email is not a valid address.');
      patch.email = email;
    }
  }
  if ('lang' in body) {
    if (body.lang !== 'fr' && body.lang !== 'en') return bad('lang must be "fr" or "en".');
    patch.lang = body.lang;
  }
  if ('marketingConsent' in body) {
    if (typeof body.marketingConsent !== 'boolean') return bad('marketingConsent must be true or false.');
    patch.marketingConsent = body.marketingConsent;
  }
  return { ok: true, patch };
}

export function applyProfilePatch(c: MasterCustomer, p: ProfilePatch): MasterCustomer {
  const next: MasterCustomer = { ...c };
  if (p.clearName) delete next.name; else if (p.name !== undefined) next.name = p.name;
  if (p.clearEmail) delete next.email; else if (p.email !== undefined) next.email = p.email;
  if (p.lang) next.lang = p.lang;
  if (p.marketingConsent !== undefined) next.marketingConsent = p.marketingConsent;
  return next;
}

/** PUT /me/addresses: up to 5, each with street, city and a Canadian postal code; province defaults to QC. */
export function validateAddresses(body: Record<string, unknown> | null | undefined): { ok: true; addresses: CustomerAddress[] } | Invalid {
  const raw = body?.addresses;
  if (!Array.isArray(raw)) return bad('addresses must be a list.');
  if (raw.length > ADDRESSES_MAX) return bad(`At most ${ADDRESSES_MAX} addresses.`);
  const addresses: CustomerAddress[] = [];
  for (const [i, item] of raw.entries()) {
    const a = cleanAddress(item as Partial<CustomerAddress>);
    if (!a) return bad(`Address ${i + 1}: street and city are required.`);
    const postal = normalizePostal(a.postalCode);
    if (!postal) return bad(`Address ${i + 1}: postal code is not valid (format H4A 1E1).`);
    addresses.push({ ...a, postalCode: postal, province: a.province.toUpperCase().slice(0, 2) === 'QU' ? 'QC' : a.province.toUpperCase() });
  }
  return { ok: true, addresses };
}

/** PUT /me/favourites: up to 50 item refs (text, 1–120 chars), duplicates dropped, order kept. */
export function validateFavourites(body: Record<string, unknown> | null | undefined): { ok: true; favourites: string[] } | Invalid {
  const raw = body?.favourites;
  if (!Array.isArray(raw)) return bad('favourites must be a list.');
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') return bad('favourites must be a list of item references.');
    const ref = v.trim();
    if (!ref || ref.length > 120) return bad('Each favourite must be 1 to 120 characters.');
    if (!out.includes(ref)) out.push(ref);
  }
  if (out.length > FAVOURITES_MAX) return bad(`At most ${FAVOURITES_MAX} favourites.`);
  return { ok: true, favourites: out };
}
