// Reviews hub: one shape for every platform's customer reviews (DoorDash feedback report, Uber Eats / Skip / Too Good To
// Go / Google exports). Stored in the existing documents collection (repo.putDocs 'reviews'): no migration.
//
// Privacy: no customer name, e-mail or phone and no courier name is ever kept. Personal columns are dropped when a file
// is read, and e-mail / phone-like strings inside the review text are masked before anything is saved.
// Replies: Food Hub never posts a reply on a platform. A person copies the draft into that platform's portal and marks
// the review as replied here. An import never overwrites that reply state.
import crypto from 'node:crypto';
import { parseDate } from '../recon/statements';
import { getRepo } from '../repo';
import { detectLang, detectThemes, type ReviewLang, type ThemeKey } from './themes';

export const REVIEWS = 'reviews';
export const REVIEW_IMPORTS = 'review_imports';
export const MAX_TEXT = 2000;

export const REVIEW_PLATFORMS = ['doordash', 'uber_eats', 'skip', 'tgtg', 'google', 'other'] as const;
export type ReviewPlatform = (typeof REVIEW_PLATFORMS)[number];
export const PLATFORM_LABELS: Record<ReviewPlatform, string> = { doordash: 'DoorDash', uber_eats: 'Uber Eats', skip: 'SkipTheDishes', tgtg: 'Too Good To Go', google: 'Google', other: 'Autre / Other' };

export function isReviewPlatform(v: unknown): v is ReviewPlatform {
  return typeof v === 'string' && (REVIEW_PLATFORMS as readonly string[]).includes(v);
}

export interface ReviewReply {
  draft?: string; draftAt?: string; draftBy?: string;
  /** Where the draft came from: Claude (checked by the guard) or a built-in template. */
  draftSource?: 'ai' | 'template';
  repliedAt?: string; repliedBy?: string;
}

export interface Review {
  id: string;
  platform: ReviewPlatform;
  brandName: string | null;
  locationCode: string | null;
  /** The platform's store id or store name, as the file gave it. */
  storeRef: string | null;
  at: string;
  stars: number | null;
  text: string;
  lang: ReviewLang | null;
  orderRef: string | null;
  themes: ThemeKey[];
  source: 'doordash_report' | 'import';
  importId: string;
  reply?: ReviewReply;
}

/** What a parser hands over before normalization (never any personal field). */
export interface ReviewInput {
  platform: ReviewPlatform;
  platformReviewId?: string | null;
  brandName?: string | null;
  locationCode?: string | null;
  storeRef?: string | null;
  at: string;
  stars?: number | string | null;
  text?: string | null;
  orderRef?: string | null;
  source: Review['source'];
  importId: string;
  reply?: ReviewReply;
}

const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex');
const clean = (v: unknown) => { const s = String(v ?? '').trim(); return s || null; };

/** sha1(platform|platformReviewId) when the platform gives one, else sha1(platform|storeRef|orderRef|at|stars). */
export function reviewId(r: Pick<ReviewInput, 'platform' | 'platformReviewId' | 'storeRef' | 'orderRef' | 'at' | 'stars'>): string {
  const pid = clean(r.platformReviewId);
  return sha1(pid ? `${r.platform}|${pid}` : `${r.platform}|${clean(r.storeRef) ?? ''}|${clean(r.orderRef) ?? ''}|${r.at}|${r.stars ?? ''}`);
}

// ---------------------------------------------------------------- privacy

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// 10–11 digit phone numbers with the usual separators: 514-555-1234, (514) 555 1234, +1 514.555.1234, 5145551234.
const PHONE = /(?<![\d])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\d])/g;

/** Masks e-mail and phone-like strings inside a free text. */
export function maskPersonalText(text: string): string {
  return String(text ?? '').replace(EMAIL, '[courriel]').replace(PHONE, '[téléphone]');
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** True for a column / field that names or reaches a person: customer name, e-mail, phone, address, any courier field. */
export function isPersonalHeader(header: string): boolean {
  const h = fold(String(header ?? ''));
  if (/(dasher|courier|livreur|livreuse|driver|chauffeur|coursier|delivery person)/.test(h)) return true;
  if (/(store|restaurant|merchant|business|brand|marque|magasin|location|item|dish|plat|product|produit|menu|place)/.test(h)) return false;
  return /(name|nom|prenom|e-?mail|courriel|phone|telephone|(^|[^a-z])tel([^a-z]|$)|mobile|cell|address|adresse|reviewer|author|auteur|profile|profil|user ?id|customer ?id|consumer ?id|client ?id|photo)/.test(h);
}

/** A copy of a raw record without its personal fields; the remaining strings have e-mails and phones masked. */
export function stripPersonal<T extends Record<string, unknown>>(record: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record ?? {})) {
    if (isPersonalHeader(k)) continue;
    if (typeof v === 'string') out[k] = maskPersonalText(v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = stripPersonal(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out as Partial<T>;
}

// ---------------------------------------------------------------- values

/**
 * Any date the portals write → full ISO timestamp. A zoned timestamp is kept as is; a day alone becomes noon UTC (the
 * same calendar day in Montréal); a local time without zone is read as UTC.
 */
export function toReviewAt(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const d = parseDate(s);
  if (!d) return null;
  if (d.length === 10) return `${d}T12:00:00.000Z`;
  const t = Date.parse(`${d}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const WORD_STARS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5 };

/** "5", "4.0", "4/5", "★★★☆☆", "FOUR", "5 étoiles" → 1..5; anything else (thumbs, empty, 0, 7) → null. */
export function parseStars(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 1 && v <= 5 ? Math.round(v) : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const filled = (s.match(/★/g) ?? []).length;
  if (filled) return filled <= 5 ? filled : null;
  const word = WORD_STARS[fold(s).replace(/[^a-z]/g, '')];
  if (word) return word;
  const m = s.replace(',', '.').match(/^(\d+(?:\.\d+)?)(?:\s*(?:\/\s*5|stars?|etoiles?|étoiles?))?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 5 ? Math.round(n) : null;
}

/** One review from parsed input: text masked and cut, language and themes found, id computed. */
export function makeReview(input: ReviewInput): Review {
  const text = maskPersonalText(String(input.text ?? '')).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  const stars = input.stars === undefined ? null : parseStars(input.stars);
  const review: Review = {
    id: reviewId({ ...input, stars }),
    platform: input.platform,
    brandName: clean(input.brandName),
    locationCode: clean(input.locationCode),
    storeRef: clean(input.storeRef),
    at: input.at,
    stars,
    text,
    lang: detectLang(text),
    orderRef: clean(input.orderRef),
    themes: detectThemes(text),
    source: input.source,
    importId: input.importId,
  };
  if (input.reply && Object.keys(input.reply).length) review.reply = { ...input.reply };
  return review;
}

// ---------------------------------------------------------------- storage

const toDoc = (r: Review) => ({ id: r.id, key: r.platform, at: r.at, data: r });

/** Existing ids among these (one read of the collection). */
export async function existingReviewIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const all = await getRepo().listDocs<Review>(REVIEWS, {});
  const want = new Set(ids);
  return new Set(all.map((d) => d.id).filter((id) => want.has(id)));
}

/**
 * Saves new reviews, skips the ones already stored (same id). A stored review keeps its reply state and its first
 * import; only a missing brand / kitchen is filled in from the new copy.
 */
export async function upsertReviews(reviews: Review[]): Promise<{ added: number; duplicates: number; updated: number }> {
  const repo = getRepo();
  const byId = new Map<string, Review>();
  for (const r of reviews) if (!byId.has(r.id)) byId.set(r.id, r);
  const stored = new Map((await repo.listDocs<Review>(REVIEWS, {})).map((d) => [d.id, d.data]));
  const writes: Review[] = [];
  let added = 0; let duplicates = reviews.length - byId.size; let updated = 0;
  for (const r of byId.values()) {
    const old = stored.get(r.id);
    if (!old) { writes.push(r); added++; continue; }
    duplicates++;
    const fill = { brandName: old.brandName ?? r.brandName, locationCode: old.locationCode ?? r.locationCode };
    if (fill.brandName !== old.brandName || fill.locationCode !== old.locationCode) {
      writes.push({ ...old, ...fill }); // the reply (and everything else) stays as stored
      updated++;
    }
  }
  if (writes.length) await repo.putDocs(REVIEWS, writes.map(toDoc));
  return { added, duplicates, updated };
}

export async function getReview(id: string): Promise<Review | null> {
  return (await getRepo().getDoc<Review>(REVIEWS, id))?.data ?? null;
}

export async function listReviews(filter: { since?: string; until?: string } = {}): Promise<Review[]> {
  return (await getRepo().listDocs<Review>(REVIEWS, { since: filter.since, until: filter.until })).map((d) => d.data);
}

/** Changes the reply state of one review (draft saved, marked replied, cleared). */
export async function saveReply(id: string, reply: ReviewReply | undefined): Promise<Review | null> {
  const r = await getReview(id);
  if (!r) return null;
  const next: Review = { ...r };
  if (reply && Object.values(reply).some((v) => v !== undefined)) next.reply = reply; else delete next.reply;
  await getRepo().putDocs(REVIEWS, [toDoc(next)]);
  return next;
}

export function isAnswered(r: Pick<Review, 'reply'>): boolean {
  return Boolean(r.reply?.repliedAt);
}

/** Needs a reply: written text and not marked replied yet (a star-only rating cannot be answered). */
export function needsReply(r: Pick<Review, 'reply' | 'text'>): boolean {
  return !isAnswered(r) && r.text.trim().length > 0;
}

