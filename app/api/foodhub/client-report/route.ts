import crypto from 'node:crypto';
import { z } from 'zod';
import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';
import { can } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

// Reports from the client supervisor (lib/ui/supervisor.ts): page crashes, failing or slow server calls, connection
// gaps, per screen and person. Stored for 14 days; crashes and failures are written to the Activity Log so the owner
// sees them next to everything else. GET (admin) lists the latest reports for the help drawer and support.
const COLLECTION = 'client_issues';
const KEEP_DAYS = 14;
const issue = z.object({
  kind: z.enum(['crash', 'error', 'api_fail', 'api_slow', 'offline', 'stale']),
  message: z.string().max(300),
  path: z.string().max(200).optional(),
  count: z.number().int().min(1).max(10_000).default(1),
  firstAt: z.number().optional(),
  lastAt: z.number().optional(),
});
const body = z.object({ screen: z.string().max(120).optional(), note: z.string().max(500).optional(), issues: z.array(issue).max(50).default([]) });

export const POST = withPerm('view', async (req, _ctx, actor) => {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail('Invalid report');
  const { screen, note, issues } = parsed.data;
  if (!issues.length && !note) return ok({ stored: 0 });
  const at = new Date().toISOString();
  await getRepo().putDocs(COLLECTION, [{ id: crypto.randomUUID(), key: actor.username, at, data: { screen: screen ?? null, note: note ?? null, user: actor.username, name: actor.name, deviceId: actor.deviceId ?? null, issues } }]);
  const serious = issues.filter((i) => i.kind === 'crash' || i.kind === 'api_fail');
  if (serious.length || note) {
    await logActivity({
      actor: actor.name, source: actor.source, kind: 'device', action: note ? 'support_report' : 'screen_problem', status: serious.some((i) => i.kind === 'crash') ? 'failed' : 'info',
      summary: note ? `${actor.name} sent a support report from ${screen ?? 'the console'}: ${note.slice(0, 160)}` : `${serious.length} problem(s) on ${screen ?? 'a screen'}: ${serious[0].message.slice(0, 160)}`,
    });
  }
  return ok({ stored: issues.length });
});

export const GET = withPerm('view', async (_req, _ctx, actor) => {
  const repo = getRepo();
  const since = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
  const docs = await repo.listDocs<Record<string, unknown>>(COLLECTION, { limit: 500 });
  const old = docs.filter((d) => (d.at ?? '') < since).map((d) => d.id);
  if (old.length) await repo.deleteDocs(COLLECTION, old).catch(() => undefined);
  const mine = can(actor.role, 'admin') ? docs : docs.filter((d) => d.key === actor.username);
  return ok({ reports: mine.filter((d) => (d.at ?? '') >= since).slice(0, 50).map((d) => ({ at: d.at, ...d.data })) });
});
