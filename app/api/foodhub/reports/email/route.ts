import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { parseFilters, parseRange } from '@/lib/foodhub/report-filter';
import { buildReport, emailReport, isEmail, isReportKey, type ReportFilter } from '@/lib/foodhub/reports';

export const dynamic = 'force-dynamic';

// "Email this report now": same filters as the download, sent as an attachment.
// Sending company data off-site needs finance:edit (owner, manager); analysts stay read-only.
export const POST = withPerm('finance:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (!isReportKey(b.report)) return fail('Unknown report');
  const emails: string[] = (Array.isArray(b.emails) ? b.emails : String(b.emails || '').split(',')).map((e: string) => String(e).trim()).filter(Boolean);
  if (!emails.length || emails.some((e) => !isEmail(e))) return fail('Enter valid email address(es).');
  const q = new URLSearchParams(Object.entries(b.query ?? {}).map(([k, v]) => [k, String(v)]));
  let f: ReportFilter;
  try { f = { ...parseRange(q), ...parseFilters(q, actor) }; } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  const table = await buildReport(b.report, f);
  const r = await emailReport(table, emails, b.format === 'xlsx' ? 'xlsx' : 'csv');
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'report_email', status: r.ok ? 'success' : 'failed', summary: `${table.title} emailed to ${emails.join(', ')}: ${r.message}` });
  return r.ok ? ok({ message: r.message, rows: table.rows.length }) : fail(r.message, 409);
});
