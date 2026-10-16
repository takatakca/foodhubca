// Reviews hub ← files exported from the platforms' portals: Uber Eats Manager, SkipTheDishes, Too Good To Go, Google
// Business Profile (CSV / XLSX) and Google Takeout (JSON). A known export is recognized by its column names; anything
// else is imported with a manual column mapping (date, stars, text, store / brand, order).
// Preview first (dryRun: nothing saved), then confirm. Personal columns (customer, reviewer, courier, e-mail, phone)
// are never read, and e-mails / phones inside the text are masked (model.ts).
import { logActivity, type Actor } from '../activity';
import { nowIso } from '../config';
import { readTable, splitHeader } from '../recon/statements';
import { getRepo } from '../repo';
import {
  existingReviewIds, isPersonalHeader, isReviewPlatform, makeReview, REVIEW_IMPORTS, toReviewAt, upsertReviews,
  type Review, type ReviewInput, type ReviewPlatform,
} from './model';
import { StoreIndex } from './stores';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const PREVIEW_ROWS = 20;

export const IMPORT_FIELDS = ['date', 'stars', 'text', 'store', 'order', 'reviewId', 'reply'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** Column index per field (0-based), chosen by a person when the file is not recognized. */
export type ReviewMapping = Partial<Record<ImportField, number>>;

export const FIELD_LABELS: Record<ImportField, { fr: string; en: string }> = {
  date: { fr: 'Date', en: 'Date' }, stars: { fr: 'Étoiles', en: 'Stars' }, text: { fr: 'Commentaire', en: 'Comment' },
  store: { fr: 'Magasin / marque', en: 'Store / brand' }, order: { fr: 'Commande', en: 'Order' }, reviewId: { fr: 'No d’avis', en: 'Review id' },
  reply: { fr: 'Réponse déjà publiée', en: 'Reply already posted' },
};

const fold = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

interface Preset { key: string; platform: ReviewPlatform; label: string; signature: RegExp; fileName?: RegExp; fields: Partial<Record<ImportField, RegExp>> }

/**
 * Column names of the common portal exports (folded: lower case, no accents, "_" and "-" as spaces). The signature is
 * a column only that export has; the fields fall back to the generic patterns below.
 */
export const PRESETS: Preset[] = [
  { key: 'uber_eats_manager', platform: 'uber_eats', label: 'Uber Eats Manager', signature: /^(order uuid|workflow uuid|eater rating|rating uuid)$|uber/, fileName: /uber/i,
    fields: { order: /^(order uuid|workflow uuid|order id)$/, stars: /^(rating|star rating|eater rating|stars)$/, text: /^(comment|comments|feedback|eater comment)$/, store: /^(store|store name|restaurant)$/, date: /^(date|rating date|rated at|order date)$/ } },
  { key: 'skip', platform: 'skip', label: 'SkipTheDishes', signature: /skip|^order number$/, fileName: /skip/i,
    fields: { order: /^(order number|order id|order #)$/, stars: /^(rating|overall rating|food rating|stars)$/, text: /^(comment|comments|review|feedback)$/, store: /^(restaurant|restaurant name|location)$/, date: /^(date|review date|order date)$/ } },
  { key: 'tgtg', platform: 'tgtg', label: 'Too Good To Go', signature: /too good|tgtg|^(bag|surprise bag|magic bag|panier)( name)?$/, fileName: /tgtg|too ?good/i,
    fields: { order: /^(order id|reservation id|order)$/, stars: /^(rating|overall rating|note|stars)$/, text: /^(comment|review|feedback|commentaire)$/, store: /^(store|store name|location|commerce)$/, date: /^(date|rating date|pickup date|collection date)$/ } },
  { key: 'google_business', platform: 'google', label: 'Google Business Profile', signature: /^(star rating|review text|reviewer|reviewer name|review id|reply text|owner response)$|google/, fileName: /google|gbp/i,
    fields: { reviewId: /^review id$/, stars: /^(star rating|rating|stars)$/, text: /^(review text|review|comment|text)$/, store: /^(location|business name|location name|store code)$/, date: /^(create time|review date|date|published|created)$/, reply: /^(reply text|owner response|response|reply)$/ } },
];

// Any export (and the fallback for a preset column the file names differently).
const GENERIC: Record<ImportField, RegExp> = {
  reviewId: /^(review|feedback|rating) ?(id|uuid)$/,
  order: /order|commande|delivery (id|uuid)|reservation/,
  stars: /rating|stars?|etoiles?|score|^note$/,
  text: /comment|review|feedback|avis|text|message/,
  store: /store|restaurant|location|magasin|succursale|brand|marque|business|commerce/,
  date: /date|created|time|publi|jour/,
  reply: /reply|response|reponse/,
};

export function detectPreset(headers: string[], fileName = ''): Preset | null {
  const h = headers.map(fold);
  return PRESETS.find((p) => h.some((x) => !isPersonalHeader(x) && p.signature.test(x))) ?? PRESETS.find((p) => p.fileName?.test(fileName)) ?? null;
}

/** The column of each field: preset names first, then the generic patterns. Personal columns are never chosen. */
export function guessReviewMapping(headers: string[], preset: Preset | null): ReviewMapping {
  const h = headers.map(fold);
  const out: ReviewMapping = {};
  const used = new Set<number>();
  // Specific first: ids and ratings before the broad text pattern ("Review ID" is not the review text).
  for (const field of ['reviewId', 'order', 'stars', 'date', 'reply', 'store', 'text'] as ImportField[]) {
    const pick = (re?: RegExp) => (re ? h.findIndex((x, i) => !used.has(i) && !isPersonalHeader(headers[i]) && re.test(x) && !(field === 'text' && /rating|score|date|(^| )id$|uuid/.test(x))) : -1);
    let i = pick(preset?.fields[field]);
    if (i < 0) i = pick(GENERIC[field]);
    if (i >= 0) { out[field] = i; used.add(i); }
  }
  return out;
}

function platformFromName(fileName: string): ReviewPlatform | null {
  if (/doordash/i.test(fileName)) return 'doordash';
  return PRESETS.find((p) => p.fileName?.test(fileName))?.platform ?? null;
}

export interface ImportOptions { platform?: ReviewPlatform | string | null; mapping?: ReviewMapping | null; dryRun?: boolean; brandName?: string | null; locationCode?: string | null; allowedLocations?: string[] }

export type ImportResult =
  | { ok: false; error: string; needsMapping?: boolean; headers?: string[]; fields?: typeof FIELD_LABELS; platform?: ReviewPlatform }
  | {
    ok: true; dryRun: boolean; importId: string; platform: ReviewPlatform; preset: string | null; headers: string[]; mapping: ReviewMapping;
    counts: { rows: number; new: number; duplicate: number; skipped: number; dropped: number; unmapped: number }; preview: Review[];
  };

type Raw = Omit<ReviewInput, 'source' | 'importId' | 'brandName' | 'locationCode'> & { storeName?: string | null; brandName?: string | null; locationCode?: string | null };

// ---------------------------------------------------------------- Google Takeout (JSON)

const STAR_WORDS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/**
 * Google Takeout reviews: the Business Profile export ({ reviews: [{ name, starRating: "FIVE", comment, createTime,
 * reviewReply }] }, one file per location) or a Maps GeoJSON ({ features: [{ properties: { "Five-Star Rating
 * Published", "Review Comment", "Published", "Location": { "Business Name" } } }] }). Reviewer fields are never read.
 */
export function parseTakeoutReviews(json: unknown): Raw[] {
  const out: Raw[] = [];
  const root = json as any;
  const list: any[] = Array.isArray(root) ? root : Array.isArray(root?.reviews) ? root.reviews : [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const at = toReviewAt(r.createTime ?? r.updateTime ?? r.date);
    if (!at) continue;
    const replied = r.reviewReply?.comment ? toReviewAt(r.reviewReply.updateTime) ?? at : null;
    out.push({
      platform: 'google', platformReviewId: r.reviewId ?? r.name ?? null, at, stars: STAR_WORDS[String(r.starRating ?? '').toUpperCase()] ?? r.rating ?? r.stars ?? null,
      text: String(r.comment ?? r.text ?? ''), storeName: r.locationName ?? r.location?.title ?? r.location?.name ?? null, storeRef: r.storeCode ?? r.locationName ?? null,
      ...(replied ? { reply: { repliedAt: replied, repliedBy: 'Google' } } : {}),
    });
  }
  for (const f of Array.isArray(root?.features) ? root.features : []) {
    const p = f?.properties ?? {};
    const at = toReviewAt(p.Published ?? p.date ?? p.published);
    if (!at) continue;
    const loc = p.Location ?? p.location ?? {};
    out.push({
      platform: 'google', platformReviewId: p['Google Maps URL'] ?? p.google_maps_url ?? null, at,
      stars: p['Five-Star Rating Published'] ?? p.five_star_rating_published ?? p['Star Rating'] ?? null,
      text: String(p['Review Comment'] ?? p.review_text_published ?? ''), storeName: loc['Business Name'] ?? loc.name ?? null, storeRef: loc['Business Name'] ?? loc.name ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- tables (CSV / XLSX)

function rowsFromTable(headers: string[], rows: string[][], mapping: ReviewMapping, platform: ReviewPlatform): Array<Raw | null> {
  const get = (r: string[], f: ImportField) => (mapping[f] === undefined || isPersonalHeader(headers[mapping[f]!] ?? '') ? '' : String(r[mapping[f]!] ?? '').trim());
  return rows.map((r) => {
    const at = toReviewAt(get(r, 'date'));
    const stars = get(r, 'stars'); const text = get(r, 'text');
    if (!at || (!stars && !text)) return null;
    const store = get(r, 'store'); const replyText = get(r, 'reply');
    return {
      platform, platformReviewId: get(r, 'reviewId') || null, at, stars, text, orderRef: get(r, 'order') || null,
      storeRef: store || null, storeName: store || null, ...(replyText ? { reply: { repliedAt: at, repliedBy: 'Portal' } } : {}),
    };
  });
}

function isJson(fileName: string, bytes: Uint8Array): boolean {
  if (/\.json$/i.test(fileName)) return true;
  for (const b of bytes.subarray(0, 64)) { if (b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0xef || b === 0xbb || b === 0xbf) continue; return b === 0x7b || b === 0x5b; }
  return false;
}

/**
 * Reads an exported file into reviews. dryRun: the first 20 parsed rows and the counts (new / duplicate / skipped), nothing
 * saved. Otherwise the new reviews are saved (an existing review keeps its reply state).
 */
export async function importReviews(fileName: string, bytes: Uint8Array, opts: ImportOptions, actor: Actor): Promise<ImportResult> {
  const name = String(fileName || 'reviews.csv');
  if (!bytes?.length) return { ok: false, error: 'The file is empty.' };
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, error: 'File too large (max 5 MB): export a shorter period.' };
  const forced = isReviewPlatform(opts.platform) ? opts.platform : null;

  let raws: Array<Raw | null> = [];
  let headers: string[] = []; let mapping: ReviewMapping = {}; let preset: Preset | null = null;
  let platform: ReviewPlatform = forced ?? platformFromName(name) ?? 'other';
  if (isJson(name, bytes)) {
    let json: unknown;
    try { json = JSON.parse(new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')); } catch { return { ok: false, error: 'This JSON file cannot be read.' }; }
    platform = forced ?? 'google';
    raws = parseTakeoutReviews(json).map((r) => ({ ...r, platform }));
    if (!raws.length) return { ok: false, error: 'No reviews found in this JSON file (expected a Google Takeout reviews file).' };
  } else {
    let table: string[][];
    try { table = readTable(name, bytes); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    const split = splitHeader(table);
    headers = split.headers;
    if (!headers.length) return { ok: false, error: 'No columns found in this file.' };
    preset = detectPreset(headers, name);
    platform = forced ?? preset?.platform ?? platform;
    mapping = opts.mapping && Object.keys(opts.mapping).length ? sanitizeMapping(opts.mapping, headers.length) : guessReviewMapping(headers, preset);
    if (mapping.date === undefined || (mapping.stars === undefined && mapping.text === undefined)) {
      return { ok: false, needsMapping: true, headers: headers.map((h) => (isPersonalHeader(h) ? '(personnel, ignoré / personal, ignored)' : h)), fields: FIELD_LABELS, platform,
        error: 'Columns not recognized: choose which column holds the date, the stars and the comment.' };
    }
    raws = rowsFromTable(headers, split.rows, mapping, platform);
  }

  const stores = await StoreIndex.load();
  const importId = `import:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const reviews: Review[] = [];
  let skipped = 0; let dropped = 0; let unmapped = 0;
  for (const raw of raws) {
    if (!raw) { skipped++; continue; }
    const where = stores.resolve(platform, raw.storeRef, raw.storeName);
    if (where.forbidden) { dropped++; continue; }
    const brandName = where.brandName ?? opts.brandName ?? null;
    const locationCode = where.locationCode ?? opts.locationCode ?? null;
    if (opts.allowedLocations?.length && !(locationCode && opts.allowedLocations.includes(locationCode))) { skipped++; continue; } // outside the person's kitchens
    if (!brandName) unmapped++;
    reviews.push(makeReview({
      platform, platformReviewId: raw.platformReviewId, storeRef: raw.storeRef, at: raw.at, stars: raw.stars, text: raw.text, orderRef: raw.orderRef, reply: raw.reply,
      brandName, locationCode, source: 'import', importId,
    }));
  }
  const ids = [...new Set(reviews.map((r) => r.id))];
  const existing = await existingReviewIds(ids);
  const fresh = ids.filter((id) => !existing.has(id)).length;
  const counts = { rows: raws.length, new: fresh, duplicate: reviews.length - fresh, skipped, dropped, unmapped };
  const base = { ok: true as const, importId, platform, preset: preset?.label ?? (headers.length ? null : 'Google Takeout'), headers, mapping, preview: reviews.slice(0, PREVIEW_ROWS) };
  if (opts.dryRun) return { ...base, dryRun: true, counts };

  const saved = await upsertReviews(reviews);
  await getRepo().putDocs(REVIEW_IMPORTS, [{ id: importId, at: nowIso(), data: { id: importId, fileName: name.slice(0, 200), platform, source: 'import', preset: base.preset, rows: raws.length, ...saved, skipped, dropped, by: actor.name, at: nowIso() } }]);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'reviews_import', status: 'success', channel: platform === 'google' || platform === 'other' ? null : platform,
    summary: `Reviews import ${name.slice(0, 80)} (${platform}): ${saved.added} new, ${saved.duplicates} already there, ${skipped} skipped${dropped ? `, ${dropped} of a protected store left out` : ''}.` });
  return { ...base, dryRun: false, counts: { ...counts, new: saved.added, duplicate: saved.duplicates } };
}

function sanitizeMapping(m: ReviewMapping, width: number): ReviewMapping {
  const out: ReviewMapping = {};
  for (const f of IMPORT_FIELDS) {
    const v = Number((m as Record<string, unknown>)[f]);
    if (Number.isInteger(v) && v >= 0 && v < width) out[f] = v;
  }
  return out;
}
