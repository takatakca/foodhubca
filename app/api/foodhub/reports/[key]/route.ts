import { NextResponse } from 'next/server';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { parseFilters, parseLimit, parseRange } from '@/lib/foodhub/report-filter';
import { buildReport, isReportKey, renderReport, type ReportFilter } from '@/lib/foodhub/reports';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ key: string }> };

// GET /api/foodhub/reports/order_transactions?from=2026-10-01&to=2026-10-01&format=csv|xlsx|json
export const GET = withPerm<Ctx>('analytics:view', async (req, context, actor) => {
  const { key } = await context.params;
  if (!isReportKey(key)) return fail('Unknown report', 404); // hasOwn: "constructor" / "toString" are not reports
  const q = new URL(req.url).searchParams;
  let f: ReportFilter;
  try { f = { ...parseRange(q), ...parseFilters(q, actor) }; } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  const table = await buildReport(key, f);
  const format = q.get('format') || 'csv';
  if (format === 'json') return ok({ title: table.title, columns: table.columns, rows: table.rows.slice(0, parseLimit(q.get('limit'), 50, 1000)), total: table.rows.length, truncated: table.truncated ?? false, filename: table.filename });
  const file = renderReport(table, format === 'xlsx' ? 'xlsx' : 'csv');
  return new NextResponse(file.body as BodyInit, { headers: { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' } });
});
