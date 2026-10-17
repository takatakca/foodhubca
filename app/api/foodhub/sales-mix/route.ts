import { NextResponse } from 'next/server';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { parseFilters, parseLimit, parseRange } from '@/lib/foodhub/report-filter';
import { renderReport } from '@/lib/foodhub/reports';
import { buildSalesMix, isDirectMode, isSalesMixTable, salesMixTable, type DirectMode } from '@/lib/foodhub/sales-mix';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const list = (v: string | null) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);

// GET /api/foodhub/sales-mix?from=2026-10-01&to=2026-10-07&locations=…&channels=doordash&brands=…&direct=include|exclude|only
//   &sources=phone,website&limit=100&format=json|csv|xlsx&table=items|hours|weekdays|sources|fulfillment&lang=fr|en
// Read-only: sales by item, hour, weekday, channel (platforms + direct orders) and fulfillment.
export const GET = withPerm('analytics:view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  let range: { from: string; to: string };
  try { range = parseRange(q, 7); } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  const table = q.get('table') || 'items';
  if (!isSalesMixTable(table)) return fail('Unknown table (items, hours, weekdays, sources or fulfillment).');
  const directQ = q.get('direct');
  if (directQ !== null && directQ !== '' && !isDirectMode(directQ)) return fail('direct must be include, exclude or only.');
  const format = q.get('format') || 'json';
  if (!['json', 'csv', 'xlsx'].includes(format)) return fail('format must be json, csv or xlsx.');
  const f = parseFilters(q, actor);
  const mix = await buildSalesMix({ ...range, locationCodes: f.locationCodes, channels: f.channels, brands: f.brands, direct: (directQ || undefined) as DirectMode | undefined, sources: list(q.get('sources')) });
  if (format === 'json') return ok({ ...mix, items: mix.items.slice(0, parseLimit(q.get('limit'), 100, 2000)), itemsTotal: mix.items.length });
  const file = renderReport(salesMixTable(mix, table, q.get('lang') === 'en' ? 'en' : 'fr'), format === 'xlsx' ? 'xlsx' : 'csv');
  return new NextResponse(file.body as BodyInit, { headers: { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' } });
});
