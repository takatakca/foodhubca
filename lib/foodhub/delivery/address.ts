// Addresses for courier deliveries: Canadian postal codes, one-line formatting for the fleets, a forgiving reader for
// addresses typed in a Clover note or said on the phone, and the per-location service-area rule.
import type { DropoffAddress, LocationDeliveryRule } from './types';

const POSTAL = /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?-?(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i;

/** "h4a1b2" → "H4A 1B2"; null when it is not a Canadian postal code. */
export function normalizePostal(raw: string | null | undefined): string | null {
  const m = String(raw ?? '').toUpperCase().match(POSTAL);
  return m ? `${m[1]} ${m[2]}` : null;
}

const PROVINCES = /\b(QC|QUEBEC|QUÉBEC|ON|ONTARIO|NB|NS|PE|NL|MB|SK|AB|BC|YT|NT|NU)\b/i;
const PROVINCE_CODE: Record<string, string> = { QUEBEC: 'QC', 'QUÉBEC': 'QC', ONTARIO: 'ON' };

/**
 * Reads "1234 rue Sherbrooke O, app 5, Montréal, QC H4A 1B2" (or a Clover customer address) into parts.
 * Returns null when there is no street number and street — never guesses a city the text did not give, except
 * the default (the kitchen's city) when the rest is clearly a local street address.
 */
export function parseAddressText(text: string | null | undefined, defaults: { city?: string; province?: string } = {}): DropoffAddress | null {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const postalCode = normalizePostal(raw) ?? '';
  let rest = postalCode ? raw.replace(POSTAL, ' ') : raw;
  const prov = rest.match(PROVINCES);
  const province = prov ? (PROVINCE_CODE[prov[1].toUpperCase()] ?? prov[1].toUpperCase()) : (defaults.province ?? 'QC');
  if (prov) rest = rest.replace(PROVINCES, ' ');
  rest = rest.replace(/\b(canada)\b/i, ' ');
  const parts = rest.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const street = parts[0];
  if (!/^\d+[A-Z]?(-\d+)?\s+\S+/i.test(street)) return null;
  let unit: string | undefined;
  const others: string[] = [];
  for (const p of parts.slice(1)) {
    const u = p.match(/^(app\.?|apt\.?|appartement|apartment|unit[ée]?|suite|#|bureau|local)\s*([\w-]+)/i);
    if (u && !unit) unit = u[2];
    else others.push(p);
  }
  const city = others.find((p) => /[a-zà-ÿ]/i.test(p) && !/^\d/.test(p)) ?? defaults.city ?? '';
  if (!city) return null;
  return { street, unit, city, province, postalCode, country: 'CA' };
}

/** One line, the way DoorDash Drive and Uber Direct read it best. */
export function formatAddress(a: Pick<DropoffAddress, 'street' | 'unit' | 'city' | 'province' | 'postalCode' | 'country'>): string {
  const street = a.unit ? `${a.street}, ${a.unit.match(/^\d/) ? `#${a.unit}` : a.unit}` : a.street;
  return [street, a.city, [a.province, a.postalCode].filter(Boolean).join(' '), a.country === 'CA' ? 'Canada' : a.country].filter(Boolean).join(', ');
}

/** What is missing for a courier to find the door. Empty = ready. */
export function addressProblems(a: DropoffAddress | null | undefined): string[] {
  if (!a) return ['No delivery address.'];
  const out: string[] = [];
  if (!a.street?.trim()) out.push('Street address is missing.');
  if (!a.city?.trim()) out.push('City is missing.');
  if (!normalizePostal(a.postalCode)) out.push('Postal code is missing or not a Canadian postal code.');
  return out;
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Is this address inside the kitchen's delivery area? Postal-code prefixes are checked when the owner set some; the
 * distance only when both the kitchen and the address have coordinates (Food Hub does not geocode — the fleet's own
 * quote still refuses addresses it cannot reach).
 */
export function serviceAreaProblem(rule: LocationDeliveryRule, a: DropoffAddress): string | null {
  if (rule.postalPrefixes.length) {
    const pc = (normalizePostal(a.postalCode) ?? '').replace(' ', '');
    if (!pc || !rule.postalPrefixes.some((p) => pc.startsWith(p))) return `Postal code ${a.postalCode || '(none)'} is outside this kitchen's delivery area (${rule.postalPrefixes.join(', ')}).`;
  }
  if (rule.maxDistanceKm > 0 && rule.lat !== undefined && rule.lng !== undefined && a.lat !== undefined && a.lng !== undefined) {
    const km = distanceKm({ lat: rule.lat, lng: rule.lng }, { lat: a.lat, lng: a.lng });
    if (km > rule.maxDistanceKm) return `${km.toFixed(1)} km from the kitchen — more than the ${rule.maxDistanceKm} km limit.`;
  }
  return null;
}
