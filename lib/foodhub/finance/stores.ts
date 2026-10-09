// Store → brand / location / kitchen for the finance report.
// Order of trust: the owner's store map (store-map.csv: platform store id or exact store name) → the store name
// matched against the brand list and street numbers (brand-match.ts) → unknown (reported so it can be mapped).
import { matchBrandLocation, normName, type LocationRef } from '../brand-match';
import { parseCsv } from '../recon/statements';
import { KITCHEN_OF, type FinanceLine, type Platform } from './model';

export interface StoreEntry {
  platform: Platform;
  storeId: string;
  storeName: string;
  brand: string;
  location: string;
  address: string;
  bankLast4: string;
  status: string;
  note: string;
}

export const STORE_MAP_HEADERS = ['platform', 'store_id', 'store_name', 'brand', 'location_code', 'address', 'bank_last4', 'status', 'note'] as const;

const PLATFORMS: Platform[] = ['uber_eats', 'doordash', 'skip', 'clover', 'tgtg'];

export function parseStoreMap(text: string): StoreEntry[] {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) return [];
  const h = rows[0].map((x) => x.toLowerCase().trim());
  const col = (name: string) => h.indexOf(name);
  return rows.slice(1).map((r) => {
    const get = (name: string) => (col(name) >= 0 ? String(r[col(name)] ?? '').trim() : '');
    const platform = get('platform') as Platform;
    return { platform, storeId: get('store_id'), storeName: get('store_name'), brand: get('brand'), location: get('location_code'), address: get('address'), bankLast4: get('bank_last4').replace(/\D/g, '').slice(-4), status: get('status'), note: get('note') };
  }).filter((e) => PLATFORMS.includes(e.platform) && (e.storeId || e.storeName));
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function storeMapCsv(entries: StoreEntry[]): string {
  return [STORE_MAP_HEADERS.join(','), ...entries.map((e) => [e.platform, e.storeId, e.storeName, e.brand, e.location, e.address, e.bankLast4, e.status, e.note].map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export interface Resolved { brand: string; location: string; kitchen: string; mappedBy: FinanceLine['mappedBy'] }

export class StoreResolver {
  private byId = new Map<string, StoreEntry>();
  private byName = new Map<string, StoreEntry>();
  readonly unknown = new Map<string, { platform: Platform; storeId: string; storeName: string; lines: number }>();
  private entries: StoreEntry[];
  private brands: string[];
  private locations: LocationRef[];

  // No TypeScript parameter properties: the offline runner executes this file with Node's type stripping.
  constructor(entries: StoreEntry[], brands: string[], locations: LocationRef[]) {
    this.entries = entries; this.brands = brands; this.locations = locations;
    for (const e of entries) {
      if (e.storeId) this.byId.set(`${e.platform}|${e.storeId.toLowerCase()}`, e);
      // Uber store UUIDs are often printed by their first 8 characters (payout lists).
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(e.storeId)) this.byId.set(`${e.platform}|${e.storeId.slice(0, 8).toLowerCase()}`, e);
      if (e.storeName) this.byName.set(`${e.platform}|${normName(e.storeName)}`, e);
    }
  }

  resolve(platform: Platform, storeId: string, storeName: string): Resolved {
    const hit = (storeId && this.byId.get(`${platform}|${storeId.toLowerCase()}`)) || (storeName && this.byName.get(`${platform}|${normName(storeName)}`))
      || (platform === 'clover' ? this.entries.find((e) => e.platform === 'clover') : undefined);
    if (hit) return { brand: hit.brand, location: hit.location, kitchen: KITCHEN_OF[hit.location] ?? '', mappedBy: 'map' };
    const k = `${platform}|${storeId}|${storeName}`;
    if (!storeName && !storeId) return { brand: '', location: '', kitchen: '', mappedBy: 'none' };
    const s = matchBrandLocation(storeName || storeId, '', this.brands, this.locations);
    const u = this.unknown.get(k) ?? { platform, storeId, storeName, lines: 0 };
    u.lines++; this.unknown.set(k, u);
    const location = s.suggestedLocation ?? '';
    return { brand: s.suggestedBrand ?? '', location, kitchen: KITCHEN_OF[location] ?? '', mappedBy: s.suggestedBrand || location ? 'name' : 'none' };
  }

  apply(lines: FinanceLine[]): void {
    for (const l of lines) {
      const r = this.resolve(l.platform, l.storeId, l.storeName);
      l.brand = r.brand || (l.platform === 'clover' ? 'On2GO (Clover, all brands)' : '(unmapped store)');
      l.location = r.location || '(unknown)';
      l.kitchen = r.kitchen || '(unknown)';
      l.mappedBy = r.mappedBy;
      if (r.mappedBy === 'name') l.notes.push('Brand/location guessed from the store name — add the store to store-map.csv to confirm');
    }
  }
}
