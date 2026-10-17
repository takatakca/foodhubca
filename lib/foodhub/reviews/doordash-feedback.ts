// Reviews hub ← DoorDash: the CONSUMER_FEEDBACK report of the Reporting API (doordash/reports.ts, unchanged). Food Hub
// asks for it with the existing requestDoorDashReport (credentials, sandbox and protected-store guards apply), the
// existing refresh downloads it (protected rows already removed by withoutProtectedRows), and this file turns its CSV
// into reviews. Protected stores are dropped a second time here, on purpose (FORBIDDEN_STORE_IDS + the menu lock).
// No new DoorDash HTTP code lives here.
import { logActivity, type Actor } from '../activity';
import { nowIso } from '../config';
import {
  getDoorDashReportFile, refreshDoorDashReport, requestDoorDashReport, REPORT_REQUESTS,
  type DoorDashReportRequest,
} from '../doordash/reports';
import { parseCsv, splitHeader } from '../recon/statements';
import { getRepo } from '../repo';
import type { ChannelResult } from '../types';
import { SUB_RATING } from './import';
import { isPersonalHeader, makeReview, REVIEW_IMPORTS, separateTwins, toReviewAt, upsertReviews, type Review } from './model';
import { rowHasForbiddenId, StoreIndex } from './stores';

export const FEEDBACK_TYPES = ['CONSUMER_FEEDBACK'] as const;

export interface FeedbackRow { reviewId: string | null; storeRef: string | null; storeName: string | null; orderRef: string | null; stars: string | null; text: string; at: string | null; forbidden?: boolean }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

// Header patterns (folded). The first column that matches wins; personal columns are never looked at.
type FeedbackField = Exclude<keyof FeedbackRow, 'forbidden'>;
/** The overall rating column first ("RATING", "OVERALL_RATING"); food / packaging / item / dasher sub-ratings never. */
const OVERALL = /^(rating|stars?|star rating|overall|overall rating|order rating|consumer rating|note|score)$|overall/;
const COLS: Record<FeedbackField, RegExp> = {
  reviewId: /^(feedback|review|rating) ?(id|uuid)$/,
  storeRef: /(^|\s)(store|location|merchant store) ?id$|^store$/,
  storeName: /store name|restaurant name|business name|merchant name|^restaurant$/,
  orderRef: /delivery (uuid|id)|order (uuid|id|number)|^order$|^delivery$/,
  stars: /rating|stars?$|score|^note$/,
  text: /comment|feedback|review|commentaire|avis/,
  at: /date|created|submitted|time/,
};

/** Column index per field for a header row (personal columns, courier ratings and sub-ratings are skipped). */
export function feedbackColumns(headers: string[]): Partial<Record<FeedbackField, number>> {
  const out: Partial<Record<FeedbackField, number>> = {};
  const used = new Set<number>();
  const find = (re: RegExp, not?: RegExp) => headers.findIndex((h, idx) => !used.has(idx) && !isPersonalHeader(h) && re.test(fold(h)) && !(not && not.test(fold(h))));
  // Order matters: specific ids before the broad "feedback"/"review" text pattern, rating before text.
  for (const key of ['reviewId', 'storeRef', 'storeName', 'orderRef', 'stars', 'at', 'text'] as FeedbackField[]) {
    let i = -1;
    if (key === 'stars') { i = find(OVERALL); if (i < 0) i = find(COLS.stars, SUB_RATING); }
    else i = find(COLS[key], key === 'text' ? /rating|score|date|id$/ : key === 'orderRef' ? /date|rating|total|amount/ : undefined);
    if (i >= 0) { out[key] = i; used.add(i); }
  }
  return out;
}

/** CONSUMER_FEEDBACK CSV → rows. Header-tolerant: unknown columns are ignored, personal ones never read. */
export function parseConsumerFeedback(csv: string): FeedbackRow[] {
  const { headers, rows } = splitHeader(parseCsv(String(csv ?? '')));
  if (!headers.length) return [];
  const col = feedbackColumns(headers);
  const cell = (r: string[], k: FeedbackField) => (col[k] === undefined ? '' : String(r[col[k]!] ?? '').trim());
  return rows.map((r): FeedbackRow => (rowHasForbiddenId(r) ? { reviewId: null, storeRef: null, storeName: null, orderRef: null, stars: null, text: '', at: null, forbidden: true } : {
    reviewId: cell(r, 'reviewId') || null,
    storeRef: cell(r, 'storeRef').replace(/\.0+$/, '') || null,
    storeName: cell(r, 'storeName') || null,
    orderRef: cell(r, 'orderRef') || null,
    stars: cell(r, 'stars') || null,
    text: cell(r, 'text'),
    at: toReviewAt(cell(r, 'at')),
  })).filter((r) => r.forbidden || r.stars || r.text);
}

/** Asks DoorDash for the feedback report of a date range (YYYY-MM-DD), through the existing Reporting API code. */
export function requestDoorDashFeedback(from: string, to: string, actor: Actor): Promise<DoorDashReportRequest | ChannelResult> {
  return requestDoorDashReport({ reportType: 'CONSUMER_FEEDBACK', from, to }, actor);
}

/**
 * The feedback report requests already made (newest first). Every request of every report type is read (payout and
 * transaction reports are asked for often): a feedback request never drops out of the list behind them.
 */
export async function listDoorDashFeedbackReports(limit = 20): Promise<DoorDashReportRequest[]> {
  const all = (await getRepo().listDocs<DoorDashReportRequest>(REPORT_REQUESTS, {})).map((d) => d.data);
  return all.filter((r) => (FEEDBACK_TYPES as readonly string[]).includes(r.reportType)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export interface FeedbackIngest { ok: boolean; message: string; messageFr: string; status?: DoorDashReportRequest['status']; rows: number; added: number; duplicates: number; dropped: number; unmapped: number; skipped: number }

/**
 * Turns a downloaded CONSUMER_FEEDBACK report into reviews. When the file is not downloaded yet, the existing refresh
 * asks DoorDash for it first (still pending → nothing to import yet).
 */
export async function ingestDoorDashFeedbackReport(reportId: string, actor: Actor): Promise<FeedbackIngest> {
  const empty = { rows: 0, added: 0, duplicates: 0, dropped: 0, unmapped: 0, skipped: 0 };
  const id = String(reportId ?? '').trim();
  if (!id) return { ok: false, message: 'No report id.', messageFr: 'Aucun rapport choisi.', ...empty };
  const req = (await getRepo().getDoc<DoorDashReportRequest>(REPORT_REQUESTS, id))?.data ?? null;
  if (req && !(FEEDBACK_TYPES as readonly string[]).includes(req.reportType)) return { ok: false, message: `Report ${id} is a ${req.reportType} report, not customer feedback.`, messageFr: `Le rapport ${id} est un rapport ${req.reportType}, pas les commentaires des clients.`, ...empty };
  let file = await getDoorDashReportFile(id);
  let status = req?.status;
  if (!file && req) {
    const fresh = await refreshDoorDashReport(id, actor);
    status = fresh?.status;
    file = await getDoorDashReportFile(id);
    if (!file) return { ok: false, status, message: fresh?.message || 'DoorDash is still preparing the file.', messageFr: reportMessageFr(fresh?.message || 'DoorDash is still preparing the file.'), ...empty };
  }
  if (!file) return { ok: false, message: 'Report file not found: request the report first.', messageFr: 'Fichier du rapport introuvable : demandez d’abord le rapport.', ...empty };

  const rows = parseConsumerFeedback(file.csv);
  // A file cut at the size limit ends in the middle of a row: that last row is dropped (its columns may be shifted).
  if (file.truncated && rows.length) rows.pop();
  const stores = await StoreIndex.load();
  const importId = `doordash:${id}`;
  const made: Array<{ review: Review; platformReviewId?: string | null }> = [];
  let dropped = 0; let unmapped = 0; let skipped = 0;
  for (const row of rows) {
    if (row.forbidden) { dropped++; continue; } // protected store number in any column
    const where = stores.resolve('doordash', row.storeRef, row.storeName);
    // Protected store: never kept, not even counted as a review (by id, or by name when the store is not mapped).
    if (where.forbidden || (!where.mapped && stores.isProtectedPlace(where.brandName, where.locationCode))) { dropped++; continue; }
    if (!row.at) { skipped++; continue; }
    if (!where.brandName) unmapped++;
    made.push({ platformReviewId: row.reviewId, review: makeReview({
      platform: 'doordash', platformReviewId: row.reviewId, brandName: where.brandName, locationCode: where.locationCode, storeRef: row.storeRef ?? row.storeName,
      at: row.at, stars: row.stars, text: row.text, orderRef: row.orderRef, source: 'doordash_report', importId,
    }) });
  }
  const reviews = separateTwins(made);
  const saved = await upsertReviews(reviews);
  await getRepo().putDocs(REVIEW_IMPORTS, [{ id: importId, at: nowIso(), data: { id: importId, fileName: file.fileName, platform: 'doordash', source: 'doordash_report', rows: rows.length, ...saved, dropped, skipped, by: actor.name, at: nowIso() } }]);
  const cut = file.truncated ? { en: ' File truncated: ask for a shorter period.', fr: ' Fichier tronqué : demandez une période plus courte.' } : { en: '', fr: '' };
  const message = `${saved.added} new review(s), ${saved.duplicates} already there${dropped ? `, ${dropped} of a protected store left out` : ''}${unmapped ? `, ${unmapped} not linked to a brand (Stores → Mapping)` : ''}.${cut.en}`;
  const messageFr = `${saved.added} nouvel(s) avis, ${saved.duplicates} déjà là${dropped ? `, ${dropped} d’un magasin protégé laissé(s) de côté` : ''}${unmapped ? `, ${unmapped} sans marque (Magasins → Branchements)` : ''}.${cut.fr}`;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'reviews_doordash_ingest', status: 'success', channel: 'doordash', summary: `DoorDash feedback report ${id}: ${message}` });
  return { ok: true, status, message, messageFr, rows: rows.length, added: saved.added, duplicates: saved.duplicates, dropped, unmapped, skipped };
}

/**
 * French for the report-request messages written by doordash/reports.ts (shared code, English): the known ones are
 * translated, anything else is shown as it is.
 */
export function reportMessageFr(message: string): string {
  const m = String(message ?? '');
  const rows = m.match(/^(\d+) row\(s\)(?:, (\d+) row\(s\) of a protected store left out)?\./);
  if (rows) return `${rows[1]} ligne(s)${rows[2] ? `, ${rows[2]} ligne(s) d’un magasin protégé laissée(s) de côté` : ''}.`;
  const known: Array<[RegExp, string]> = [
    [/^DoorDash is still preparing the file\.?$/, 'DoorDash prépare encore le fichier.'],
    [/^DoorDash could not build this report\.?$/, 'DoorDash n’a pas pu préparer ce rapport.'],
    [/^DoorDash reported that the report failed\.?$/, 'DoorDash indique que le rapport a échoué.'],
    [/^Requested/i, 'Demandé à DoorDash : le fichier sera prêt dans quelques minutes.'],
    [/^Not sent: DoorDash is in sandbox mode/i, 'Non envoyé : DoorDash est en mode test (sandbox) et la clé Marketplace est une clé de test. Renseignez DOORDASH_REPORTS_DEVELOPER_ID / _KEY_ID / _SIGNING_SECRET (intégration Reports) pour utiliser les rapports.'],
    [/^Choose a valid date range/i, 'Choisissez une période valide (AAAA-MM-JJ, la fin après le début).'],
    [/^No mapped DoorDash store/i, 'Aucun magasin DoorDash branché ne porte de numéro de magasin DoorDash : complétez Magasins → Branchements.'],
    [/^Unknown report type/i, 'Type de rapport inconnu.'],
    [/^Download refused:/i, 'Téléchargement refusé : le lien n’est pas un lien https DoorDash / AWS.'],
  ];
  const creds = m.match(/^DoorDash Reporting API credentials missing: ([A-Z0-9_, ]+)/);
  if (creds) return `Identifiants de l’API de rapports DoorDash manquants : ${creds[1].trim().replace(/,$/, '')} (Developer Portal → intégration Reports → clé d’accès).`;
  const store = m.match(/^Store (.+) is protected: Food Hub never requests data for it.?$/);
  if (store) return `Le magasin ${store[1]} est protégé : Food Hub ne demande jamais ses données.`;
  return known.find(([re]) => re.test(m))?.[1] ?? m;
}
