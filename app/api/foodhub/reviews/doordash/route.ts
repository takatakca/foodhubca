import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { ingestDoorDashFeedbackReport, listDoorDashFeedbackReports, reportMessageFr, requestDoorDashFeedback } from '@/lib/foodhub/reviews/doordash-feedback';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// A DoorDash report covers every mapped store, so only people who see every kitchen can list, request or import one
// (the list carries every mapped store's DoorDash number and DoorDash's messages).
const SCOPED = 'A DoorDash report covers every kitchen: ask someone with access to all kitchens.';
const SCOPED_FR = 'Un rapport DoorDash couvre toutes les cuisines : demandez à une personne qui a accès à toutes les cuisines.';

// GET → the CONSUMER_FEEDBACK report requests already made (newest first).
export const GET = withPerm('menu:edit', async (_req, _ctx, actor) => {
  if (actor.locations.length) return fail(SCOPED, 403, { errorFr: SCOPED_FR });
  const reports = await listDoorDashFeedbackReports();
  return ok({ reports: reports.map((r) => ({ ...r, messageFr: reportMessageFr(r.message) })) });
});

// POST { action: 'request', from, to } → asks DoorDash for the feedback report (existing Reporting API code and its guards).
// POST { action: 'ingest', reportId } → downloads it when ready (existing refresh) and imports its reviews.
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  if (actor.locations.length) return fail(SCOPED, 403, { errorFr: SCOPED_FR });
  const b = await readJson(req);
  if (b.action === 'request') {
    const out = await requestDoorDashFeedback(String(b.from ?? ''), String(b.to ?? ''), actor);
    if ('reportType' in out) return ok({ report: out });
    return fail(out.message, 409, { status: out.status });
  }
  if (b.action === 'ingest') {
    const { ok: imported, ...out } = await ingestDoorDashFeedbackReport(String(b.reportId ?? ''), actor);
    return ok({ imported, ...out });
  }
  return fail('Unknown action: use "request" or "ingest".');
});
