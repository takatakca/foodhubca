// Reviews hub ← DoorDash: the CONSUMER_FEEDBACK report of the Reporting API (doordash/reports.ts, unchanged). Food Hub
// asks for it with the existing requestDoorDashReport (credentials, sandbox and protected-store guards apply), the
// existing refresh downloads it (protected rows already removed by withoutProtectedRows), and this file turns its CSV
// into reviews. Protected stores are dropped a second time here, on purpose (FORBIDDEN_STORE_IDS + the menu lock).
// No new DoorDash HTTP code lives here.
import { logActivity, type Actor } from '../activity';
import { nowIso } from '../config';
import {
  getDoorDashReportFile, listDoorDashReports, refreshDoorDashReport, requestDoorDashReport, REPORT_REQUESTS,
  type DoorDashReportRequest,
} from '../doordash/reports';
import { parseCsv, splitHeader } from '../recon/statements';
import { getRepo } from '../repo';
import type { ChannelResult } from '../types';
import { isPersonalHeader, makeReview, REVIEW_IMPORTS, toReviewAt, upsertReviews, type Review } from './model';
import { StoreIndex } from './stores';

export const FEEDBACK_TYPES = ['CONSUMER_FEEDBACK'] as const;

export interface FeedbackRow { reviewId: string | null; storeRef: string | null; storeName: string | null; orderRef: string | null; stars: string | null; text: string; at: string | null }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

// Header patterns (folded). The first column that matches wins; personal columns are never looked at.
const COLS: Record<keyof FeedbackRow, RegExp> = {
  reviewId: /^(feedback|review|rating) ?(id|uuid)$/,
  storeRef: /(^|\s)(store|location|merchant store) ?id$|^store$/,
  storeName: /store name|restaurant name|business name|merchant name|^restaurant$/,
  orderRef: /delivery (uuid|id)|order (uuid|id|number)|^order$|^delivery$/,
  stars: /rating|stars?$|score|^note$/,
  text: /comment|feedback|review|commentaire|avis/,
  at: /date|created|submitted|time/,
};

/** Column index per field for a header row (personal columns and courier ratings are skipped). */
export function feedbackColumns(headers: string[]): Partial<Record<keyof FeedbackRow, number>> {
  const out: Partial<Record<keyof FeedbackRow, number>> = {};
  const used = new Set<number>();
  // Order matters: specific ids before the broad "feedback"/"review" text pattern, rating before text.
  for (const key of ['reviewId', 'storeRef', 'storeName', 'orderRef', 'stars', 'at', 'text'] as Array<keyof FeedbackRow>) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && !isPersonalHeader(h) && COLS[key].test(fold(h)) && !(key === 'text' && /rating|score|date|id$/.test(fold(h))));
    if (i >= 0) { out[key] = i; used.add(i); }
  }
  return out;
}

/** CONSUMER_FEEDBACK CSV → rows. Header-tolerant: unknown columns are ignored, personal ones never read. */
export function parseConsumerFeedback(csv: string): FeedbackRow[] {
  const { headers, rows } = splitHeader(parseCsv(String(csv ?? '')));
  if (!headers.length) return [];
  const col = feedbackColumns(headers);
  const cell = (r: string[], k: keyof FeedbackRow) => (col[k] === undefined ? '' : String(r[col[k]!] ?? '').trim());
  return rows.map((r) => ({
    reviewId: cell(r, 'reviewId') || null,
    storeRef: cell(r, 'storeRef').replace(/\.0+$/, '') || null,
    storeName: cell(r, 'storeName') || null,
    orderRef: cell(r, 'orderRef') || null,
    stars: cell(r, 'stars') || null,
    text: cell(r, 'text'),
    at: toReviewAt(cell(r, 'at')),
  })).filter((r) => r.stars || r.text);
}

/** Asks DoorDash for the feedback report of a date range (YYYY-MM-DD), through the existing Reporting API code. */
export function requestDoorDashFeedback(from: string, to: string, actor: Actor): Promise<DoorDashReportRequest | ChannelResult> {
  return requestDoorDashReport({ reportType: 'CONSUMER_FEEDBACK', from, to }, actor);
}

/** The feedback report requests already made (newest first). */
export async function listDoorDashFeedbackReports(limit = 20): Promise<DoorDashReportRequest[]> {
  return (await listDoorDashReports(200)).filter((r) => (FEEDBACK_TYPES as readonly string[]).includes(r.reportType)).slice(0, limit);
}

export interface FeedbackIngest { ok: boolean; message: string; status?: DoorDashReportRequest['status']; rows: number; added: number; duplicates: number; dropped: number; unmapped: number; skipped: number }

/**
 * Turns a downloaded CONSUMER_FEEDBACK report into reviews. When the file is not downloaded yet, the existing refresh
 * asks DoorDash for it first (still pending → nothing to import yet).
 */
export async function ingestDoorDashFeedbackReport(reportId: string, actor: Actor): Promise<FeedbackIngest> {
  const empty = { rows: 0, added: 0, duplicates: 0, dropped: 0, unmapped: 0, skipped: 0 };
  const id = String(reportId ?? '').trim();
  if (!id) return { ok: false, message: 'No report id.', ...empty };
  const req = (await getRepo().getDoc<DoorDashReportRequest>(REPORT_REQUESTS, id))?.data ?? null;
  if (req && !(FEEDBACK_TYPES as readonly string[]).includes(req.reportType)) return { ok: false, message: `Report ${id} is a ${req.reportType} report, not customer feedback.`, ...empty };
  let file = await getDoorDashReportFile(id);
  let status = req?.status;
  if (!file && req) {
    const fresh = await refreshDoorDashReport(id, actor);
    status = fresh?.status;
    file = await getDoorDashReportFile(id);
    if (!file) return { ok: false, status, message: fresh?.message || 'DoorDash is still preparing the file.', ...empty };
  }
  if (!file) return { ok: false, message: 'Report file not found: request the report first.', ...empty };

  const rows = parseConsumerFeedback(file.csv);
  const stores = await StoreIndex.load();
  const importId = `doordash:${id}`;
  const reviews: Review[] = [];
  let dropped = 0; let unmapped = 0; let skipped = 0;
  for (const row of rows) {
    const where = stores.resolve('doordash', row.storeRef, row.storeName);
    if (where.forbidden) { dropped++; continue; } // protected store: never kept, not even counted as a review
    if (!row.at) { skipped++; continue; }
    if (!where.brandName) unmapped++;
    reviews.push(makeReview({
      platform: 'doordash', platformReviewId: row.reviewId, brandName: where.brandName, locationCode: where.locationCode, storeRef: row.storeRef ?? row.storeName,
      at: row.at, stars: row.stars, text: row.text, orderRef: row.orderRef, source: 'doordash_report', importId,
    }));
  }
  const saved = await upsertReviews(reviews);
  await getRepo().putDocs(REVIEW_IMPORTS, [{ id: importId, at: nowIso(), data: { id: importId, fileName: file.fileName, platform: 'doordash', source: 'doordash_report', rows: rows.length, ...saved, dropped, skipped, by: actor.name, at: nowIso() } }]);
  const message = `${saved.added} new review(s), ${saved.duplicates} already there${dropped ? `, ${dropped} of a protected store left out` : ''}${unmapped ? `, ${unmapped} not linked to a brand (Stores → Mapping)` : ''}.`;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'reviews_doordash_ingest', status: 'success', channel: 'doordash', summary: `DoorDash feedback report ${id}: ${message}` });
  return { ok: true, status, message, rows: rows.length, added: saved.added, duplicates: saved.duplicates, dropped, unmapped, skipped };
}
