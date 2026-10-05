import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { deleteReportSchedule, listReportSchedules, ownsSchedule, saveReportSchedule, type ReportKey } from '@/lib/foodhub/reports';
import { can } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

export const GET = withPerm('analytics:view', async () => ok({ schedules: await listReportSchedules() }));

// Daily (yesterday), weekly (last Mon–Sun) or monthly (last month): the latest completed period goes out on the
// first run after 8:00 that has not sent it yet. Creating / changing / stopping a schedule needs finance:edit
// (owner, manager); an existing schedule can only be changed by its creator or an admin.
export const POST = withPerm('finance:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (b.id && !can(actor.role, 'admin')) {
    const existing = (await listReportSchedules()).find((s) => s.id === String(b.id));
    if (existing && !ownsSchedule(existing, actor)) return fail('Only the person who created this schedule (or an admin) can change it.', 403);
  }
  const emails = (Array.isArray(b.emails) ? b.emails : String(b.emails || '').split(',')).map(String);
  const schedule = await saveReportSchedule({
    id: b.id ? String(b.id) : undefined, report: String(b.report) as ReportKey, frequency: b.frequency, emails, format: b.format === 'xlsx' ? 'xlsx' : 'csv',
    filter: { locationCodes: actor.locations.length ? actor.locations : Array.isArray(b.locationCodes) ? b.locationCodes : undefined, channels: Array.isArray(b.channels) ? b.channels : undefined, brands: Array.isArray(b.brands) ? b.brands : undefined },
  }, actor);
  return ok({ schedule });
});

export const DELETE = withPerm('finance:edit', async (req, _ctx, actor) => {
  const id = new URL(req.url).searchParams.get('id');
  const existing = id ? (await listReportSchedules()).find((s) => s.id === id) : undefined;
  if (!id || !existing) return fail('Schedule not found', 404);
  if (!can(actor.role, 'admin') && !ownsSchedule(existing, actor)) return fail('Only the person who created this schedule (or an admin) can stop it.', 403);
  if (!(await deleteReportSchedule(id, actor))) return fail('Schedule not found', 404);
  return ok();
});
