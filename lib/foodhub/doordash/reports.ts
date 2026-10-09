// DoorDash Reporting API (limited access, "Reports" integration in the Developer Portal): the restaurant's own financial,
// operations, menu and feedback reports, as CSV files.
//   POST /dataexchange/v1/reports                      { report_type, start_date, end_date, business_ids?, store_ids?, webhook_url?, report_version }  → 202 { report_id }
//   GET  /dataexchange/v1/reports/{report_id}/reportlink   PENDING until ready (up to ~5 min), then a link valid for 20 seconds → .ZIP holding a .CSV
// Spec: https://developer.doordash.com/en-US/api/reporting , https://developer.doordash.com/en-US/docs/reporting/how_to/get_a_report
// Credentials: an access key of the Reports integration (DOORDASH_REPORTS_DEVELOPER_ID / _KEY_ID / _SIGNING_SECRET), else the
// Marketplace key. Protected stores (Po Poulet NDG…) are never asked for, and their rows are dropped from every file.
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { logActivity, type Actor } from '../activity';
import { doorDashJwt } from '../adapters/doordash';
import { callApi, nowIso, result, stripSlash, timedFetch } from '../config';
import { importStatement } from '../recon/engine';
import { decodeText, parseCsv } from '../recon/statements';
import { getRepo } from '../repo';
import type { ChannelResult } from '../types';
import { isProtectedDoorDashId, withoutProtectedIds } from './guard';
import { withDoorDashRetry } from './retry';

const KEY = 'doordash' as const;
export const REPORT_TYPES = ['CONSUMER_FEEDBACK', 'MENU_ITEM_ERROR', 'MENU_OPEN_HOURS', 'MENU_SPECIAL_HOURS', 'ORDER_DETAIL', 'PAYOUT_SUMMARY', 'TRANSACTION_DETAIL', 'TEMPORARY_DEACTIVATION',
  'AVOIDABLE_WAIT', 'CANCELLED_ORDERS', 'STORE_INFORMATION', 'NV_PAYMENTS', 'NV_TRANSACTIONS', 'NV_ORDER_ITEMS', 'NV_OPERATIONS_CONSUMER_FEEDBACK'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
/** The report types whose CSV is a payout statement Food Hub can reconcile (Money → Reconciliation). */
const STATEMENT_TYPES: ReportType[] = ['TRANSACTION_DETAIL', 'PAYOUT_SUMMARY'];

export const REPORT_REQUESTS = 'doordash_report_requests';
export const REPORT_FILES = 'doordash_report_files';
const MAX_FILE_CHARS = 1_500_000;

export interface DoorDashReportRequest {
  id: string; reportType: ReportType; from: string; to: string; storeIds: number[];
  status: 'requested' | 'ready' | 'imported' | 'failed';
  message: string; requestedBy: string; at: string; updatedAt?: string;
  rows?: number; droppedRows?: number; fileName?: string; imported?: boolean;
}

function creds() {
  const own = { developerId: process.env.DOORDASH_REPORTS_DEVELOPER_ID, keyId: process.env.DOORDASH_REPORTS_KEY_ID, signingSecret: process.env.DOORDASH_REPORTS_SIGNING_SECRET };
  return own.developerId && own.keyId && own.signingSecret ? own : { developerId: process.env.DOORDASH_DEVELOPER_ID, keyId: process.env.DOORDASH_KEY_ID, signingSecret: process.env.DOORDASH_SIGNING_SECRET };
}
export const reportsBase = () => stripSlash(process.env.DOORDASH_REPORTS_BASE_URL || 'https://openapi.doordash.com');
const headers = () => ({ Authorization: `Bearer ${doorDashJwt(undefined, creds())}`, 'Content-Type': 'application/json', Accept: 'application/json' });

function missing(): string[] {
  const c = creds();
  return [...(c.developerId ? [] : ['DOORDASH_REPORTS_DEVELOPER_ID']), ...(c.keyId ? [] : ['DOORDASH_REPORTS_KEY_ID']), ...(c.signingSecret ? [] : ['DOORDASH_REPORTS_SIGNING_SECRET'])];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Builds the POST body, or says what is wrong. Protected store ids are refused, never silently dropped from an explicit list. */
export function reportBody(input: { reportType: string; from: string; to: string; businessIds?: number[]; storeIds?: number[]; webhookUrl?: string }): { body?: Record<string, unknown>; error?: string } {
  if (!(REPORT_TYPES as readonly string[]).includes(input.reportType)) return { error: `Unknown report type ${input.reportType}. Choose one of: ${REPORT_TYPES.join(', ')}.` };
  if (!DATE.test(input.from) || !DATE.test(input.to) || input.to < input.from) return { error: 'Choose a valid date range (YYYY-MM-DD).' };
  const stores = input.storeIds ?? [];
  const { dropped } = withoutProtectedIds(stores);
  if (dropped.length) return { error: `Store ${dropped.join(', ')} is protected: Food Hub never requests data for it.` };
  if (input.webhookUrl && !/^https:\/\//i.test(input.webhookUrl)) return { error: 'The report-ready webhook must be an https URL.' };
  return { body: {
    report_type: input.reportType, start_date: input.from, end_date: input.to, report_version: 1,
    ...(input.businessIds?.length ? { business_ids: input.businessIds } : {}),
    ...(stores.length ? { store_ids: stores } : {}),
    ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
  } };
}

/** The numeric DoorDash store ids Food Hub may ask about: mapped stores that carry DoorDash's own number, protected ones left out. */
export async function mappedDoorDashStoreNumbers(): Promise<number[]> {
  const stores = await getRepo().listStores('doordash');
  const ids = stores.map((s) => s.meta?.platformStoreId ?? s.channelStoreId).map((v) => String(v)).filter((v) => /^\d+$/.test(v)).map(Number);
  return withoutProtectedIds([...new Set(ids)]).kept;
}

export async function requestDoorDashReport(input: { reportType: string; from: string; to: string; businessIds?: number[]; storeIds?: number[]; webhookUrl?: string }, actor: Actor): Promise<DoorDashReportRequest | ChannelResult> {
  const miss = missing();
  if (miss.length) return result(KEY, 'blocked', `DoorDash Reporting API credentials missing: ${miss.join(', ')} (Developer Portal → your Reports integration → access key).`);
  const built = reportBody(input);
  if (!built.body) return result(KEY, 'blocked', built.error!);
  // No store list given: ask for the mapped, unprotected stores only (an empty list would mean "every store of the account").
  const storeIds = input.storeIds?.length ? input.storeIds : await mappedDoorDashStoreNumbers();
  if (!input.storeIds?.length && !input.businessIds?.length) {
    if (!storeIds.length) return result(KEY, 'blocked', 'No mapped DoorDash store carries a DoorDash store number: give the store ids or business ids explicitly.');
    built.body.store_ids = storeIds;
  }
  const res = await withDoorDashRetry(() => callApi(KEY, `${reportsBase()}/dataexchange/v1/reports`, { method: 'POST', headers: headers(), body: JSON.stringify(built.body) }, 'queued'), { method: 'POST' });
  const reportId = res.ok ? String((res.response as any)?.report_id ?? '') : '';
  const doc: DoorDashReportRequest = {
    id: reportId || `failed-${Date.now()}`, reportType: input.reportType as ReportType, from: input.from, to: input.to, storeIds: (built.body.store_ids as number[] | undefined) ?? [],
    status: res.ok && reportId ? 'requested' : 'failed', message: res.ok && reportId ? 'Requested: DoorDash prepares the file (up to about 5 minutes).' : res.message, requestedBy: actor.name, at: nowIso(),
  };
  await getRepo().putDocs(REPORT_REQUESTS, [{ id: doc.id, at: doc.at, data: doc }]);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'doordash_report_request', status: doc.status === 'failed' ? 'failed' : 'queued', channel: 'doordash',
    summary: `DoorDash ${input.reportType} report ${input.from} → ${input.to}: ${doc.message}` });
  return doc;
}

export interface ReportLink { status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'; link?: string }

/** Reads the report-link answer whatever its field names are (the reference does not name them). */
export function readReportLink(body: any): ReportLink {
  const raw = String(body?.status ?? body?.report_status ?? body?.state ?? '').toUpperCase();
  const link = body?.link ?? body?.report_link ?? body?.reportlink ?? body?.download_url ?? body?.url ?? body?.report_url;
  const status: ReportLink['status'] = /SUCCEED|COMPLETE|READY|DONE/.test(raw) || (!raw && link) ? 'SUCCEEDED' : /FAIL|ERROR/.test(raw) ? 'FAILED' : /PEND|PROCESS|QUEUE|PROGRESS|REQUEST/.test(raw) ? 'PENDING' : 'UNKNOWN';
  return { status, ...(typeof link === 'string' && link ? { link } : {}) };
}

export async function getDoorDashReportLink(reportId: string): Promise<ChannelResult & { link?: ReportLink }> {
  const miss = missing();
  if (miss.length) return result(KEY, 'blocked', `DoorDash Reporting API credentials missing: ${miss.join(', ')}.`);
  const res = await withDoorDashRetry(() => callApi(KEY, `${reportsBase()}/dataexchange/v1/reports/${encodeURIComponent(reportId)}/reportlink`, { headers: headers() }), { method: 'GET', waitOn429: false });
  return res.ok ? { ...res, link: readReportLink(res.response) } : res;
}

/** The file link comes from DoorDash's answer, but it is still data: https and a DoorDash / AWS host only. */
export function allowedDoorDashReportUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const extra = (process.env.DOORDASH_REPORT_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (extra.includes(u.hostname.toLowerCase())) return true;
    return u.protocol === 'https:' && /(^|\.)(doordash\.com|doordash\.team|amazonaws\.com|cloudfront\.net)$/i.test(u.hostname);
  } catch { return false; }
}

/** First .csv inside the ZIP DoorDash serves (or the bytes themselves when it is a plain CSV). */
export function csvFromReportFile(bytes: Uint8Array): { name: string; text: string } | null {
  const isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) return { name: 'report.csv', text: decodeText(bytes) };
  const files = unzipSync(bytes);
  const name = Object.keys(files).find((n) => /\.csv$/i.test(n));
  return name ? { name, text: strFromU8(files[name]) } : null;
}

const STORE_COLUMN = /(^|[^a-z])(merchant )?(store|location)[ _-]?id([^a-z]|$)|^store$/i;
const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Drops every row of a protected store from a report's CSV (a "Store ID" column holding the protected number). */
export function withoutProtectedRows(text: string): { text: string; rows: number; dropped: number } {
  const table = parseCsv(text);
  if (!table.length) return { text, rows: 0, dropped: 0 };
  const [head, ...rows] = table;
  const cols = head.map((h, i) => (STORE_COLUMN.test(h.trim()) ? i : -1)).filter((i) => i >= 0);
  const kept = cols.length ? rows.filter((r) => !cols.some((i) => isProtectedDoorDashId(String(r[i] ?? '').replace(/\.0+$/, '')))) : rows;
  return { text: [head, ...kept].map((r) => r.map(csvCell).join(',')).join('\n'), rows: kept.length, dropped: rows.length - kept.length };
}

/** Looks at one requested report: still pending, failed, or ready → downloaded, protected rows removed, kept, and imported when it is a payout statement. */
export async function refreshDoorDashReport(reportId: string, actor: Actor): Promise<DoorDashReportRequest | null> {
  const repo = getRepo();
  const doc = await repo.getDoc<DoorDashReportRequest>(REPORT_REQUESTS, reportId);
  if (!doc) return null;
  const save = async (patch: Partial<DoorDashReportRequest>) => {
    const next = { ...doc.data, ...patch, updatedAt: nowIso() };
    await repo.putDocs(REPORT_REQUESTS, [{ id: next.id, at: next.at, data: next }]);
    return next;
  };
  if (doc.data.status === 'imported' || doc.data.status === 'ready') return doc.data;
  const linkRes = await getDoorDashReportLink(reportId);
  if (!linkRes.ok) return save({ message: linkRes.message });
  const link = linkRes.link!;
  if (link.status === 'PENDING' || link.status === 'UNKNOWN') return save({ message: 'DoorDash is still preparing the file.' });
  if (link.status === 'FAILED' || !link.link) return save({ status: 'failed', message: 'DoorDash could not build this report.' });
  if (!allowedDoorDashReportUrl(link.link)) return save({ status: 'failed', message: `Download refused: ${link.link.slice(0, 80)} is not an https DoorDash / AWS link.` });
  try {
    const res = await timedFetch(link.link, { redirect: 'manual' }); // the link is valid for 20 seconds: fetch it right away
    if (res.status >= 300 && res.status < 400) throw new Error('the download link redirects elsewhere');
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const file = csvFromReportFile(bytes);
    if (!file) throw new Error('no CSV inside the report file');
    const clean = withoutProtectedRows(file.text);
    const fileName = `doordash-${doc.data.reportType.toLowerCase()}-${doc.data.from}_${doc.data.to}.csv`;
    await repo.putDocs(REPORT_FILES, [{ id: reportId, at: nowIso(), data: { id: reportId, fileName, csv: clean.text.slice(0, MAX_FILE_CHARS), truncated: clean.text.length > MAX_FILE_CHARS } }]);
    let imported = false;
    let message = `${clean.rows} row(s)${clean.dropped ? `, ${clean.dropped} row(s) of a protected store left out` : ''}.`;
    if (STATEMENT_TYPES.includes(doc.data.reportType) && clean.rows) {
      const out = await importStatement({ fileName, bytes: strToU8(clean.text), channel: 'doordash', actor, source: 'doordash_reporting_api' });
      imported = out.ok;
      message += out.ok ? ` Imported into Reconciliation (${out.import.newLines} new line(s)).` : ' Downloaded; confirm the columns under Money → Statement imports to reconcile it.';
    }
    await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'doordash_report_ready', status: 'success', channel: 'doordash', summary: `DoorDash ${doc.data.reportType} report ${doc.data.from} → ${doc.data.to}: ${message}` });
    return save({ status: imported ? 'imported' : 'ready', message, rows: clean.rows, droppedRows: clean.dropped, fileName, imported });
  } catch (error) {
    return save({ status: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
}

/** Report Ready webhook: { report_id, status: SUCCEEDED | FAILED } (payload not documented beyond that). */
export async function onDoorDashReportReady(body: any): Promise<string> {
  const id = String(body?.report_id ?? '');
  const actor: Actor = { username: 'doordash', name: 'DoorDash Reporting API', source: 'platform' };
  if (!id) return 'report webhook without a report id';
  if (/FAIL/i.test(String(body?.status ?? ''))) {
    const doc = await getRepo().getDoc<DoorDashReportRequest>(REPORT_REQUESTS, id);
    if (doc) await getRepo().putDocs(REPORT_REQUESTS, [{ id, at: doc.at, data: { ...doc.data, status: 'failed', message: 'DoorDash reported that the report failed.', updatedAt: nowIso() } }]);
    return 'report failed';
  }
  const out = await refreshDoorDashReport(id, actor);
  return out ? `report ${out.status}` : 'report webhook for a request Food Hub does not know';
}

export async function listDoorDashReports(limit = 30): Promise<DoorDashReportRequest[]> {
  return (await getRepo().listDocs<DoorDashReportRequest>(REPORT_REQUESTS, { limit })).map((d) => d.data).sort((a, b) => b.at.localeCompare(a.at));
}

export async function getDoorDashReportFile(reportId: string): Promise<{ fileName: string; csv: string; truncated: boolean } | null> {
  return (await getRepo().getDoc<{ fileName: string; csv: string; truncated: boolean }>(REPORT_FILES, reportId))?.data ?? null;
}

