// DoorDash Pharmacy deeplink (experimental): not an HTTP API but a URL a pharmacy creates for one prescription order.
//   https://www.doordash.com/rx/{merchant_tag}?store_id=…&item=<name>:<copay cents>:<expires unix s>[&item=…][&fulfillment_type=pdf_417&fulfillment_data=…][&signature=…]
// Spec: https://developer.doordash.com/en-US/docs/pharmacy/reference/deeplink
// Rules from the spec kept here: the link must never carry patient names or other protected health information; `signature`
// (RSA SHA-256, PKCS#1 v1.5, configured per merchant) must be the LAST parameter and signs the URL before it.
// The reference does not say how the signature is encoded: base64url is used and DOORDASH_PHARMACY_SIGNATURE_ENCODING=base64 changes it.
import crypto from 'node:crypto';

export interface PharmacyItem { name: string; copayCents: number; expiresAtUnix: number }
export interface PharmacyLink { merchantTag: string; storeId: string; items: PharmacyItem[]; fulfillmentType?: 'pdf_417'; fulfillmentData?: string }

/** A line of PHI-looking text (a date of birth, a long number, an email) is refused: item names are drug / product labels only. */
export function pharmacyItemProblem(name: string): string | null {
  if (!name.trim() || name.length > 60) return 'Item names must be 1 to 60 characters.';
  if (/[:&?=#]/.test(name)) return 'Item names cannot contain : & ? = #.';
  if (/@|\b\d{6,}\b|\b\d{4}-\d{2}-\d{2}\b/.test(name)) return 'This looks like personal data: the link must not carry patient information.';
  return null;
}

export function buildPharmacyDeeplink(link: PharmacyLink, opts: { privateKeyPem?: string; now?: number } = {}): { url?: string; error?: string } {
  if (!/^[A-Za-z0-9_-]+$/.test(link.merchantTag)) return { error: 'merchant_tag is the pharmacy identifier DoorDash gave you (letters, digits, - and _).' };
  if (!link.storeId.trim()) return { error: 'store_id is required.' };
  if (!link.items.length) return { error: 'At least one item is required.' };
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  for (const it of link.items) {
    const p = pharmacyItemProblem(it.name);
    if (p) return { error: p };
    if (!Number.isInteger(it.copayCents) || it.copayCents < 0) return { error: 'The copay is a whole number of cents.' };
    if (!Number.isInteger(it.expiresAtUnix) || it.expiresAtUnix <= now) return { error: 'The expiry must be a future Unix time in seconds.' };
  }
  if (link.fulfillmentType === 'pdf_417' && !link.fulfillmentData) return { error: 'fulfillment_data is required with fulfillment_type=pdf_417.' };
  const q = [`store_id=${encodeURIComponent(link.storeId)}`, ...link.items.map((i) => `item=${encodeURIComponent(`${i.name}:${i.copayCents}:${i.expiresAtUnix}`)}`)];
  if (link.fulfillmentType) q.push(`fulfillment_type=${link.fulfillmentType}`, ...(link.fulfillmentData ? [`fulfillment_data=${encodeURIComponent(link.fulfillmentData)}`] : []));
  const unsigned = `https://www.doordash.com/rx/${link.merchantTag}?${q.join('&')}`;
  const key = opts.privateKeyPem ?? process.env.DOORDASH_PHARMACY_PRIVATE_KEY;
  if (!key) return { url: unsigned };
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), { key: key.replace(/\\n/g, '\n'), padding: crypto.constants.RSA_PKCS1_PADDING });
  const enc = process.env.DOORDASH_PHARMACY_SIGNATURE_ENCODING === 'base64' ? sig.toString('base64') : sig.toString('base64url');
  return { url: `${unsigned}&signature=${encodeURIComponent(enc)}` };
}
