import { NextResponse } from 'next/server';
import { getLiveConnector, parsePlatformKey } from '@/lib/backend/connectors/live-registry';
import { createSyncRun, finishSyncRun, insertIngestedRecords } from '@/lib/backend/connector-run-service';
import { runAiIngestionSupervisorForRecords } from '@/lib/backend/ai-live-ingestion-supervisor';
import { withPerm } from '@/lib/foodhub/auth';
import { readJson } from '@/lib/foodhub/http';
import { hasSupabaseEnv } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Calls the platform and persists records — admin only.
export const POST = withPerm('admin', async (req) => {
  try {
    const body = await readJson(req);
    const platformKey = parsePlatformKey(body.platformKey);
    const SYNC_TYPES = ['stores', 'orders', 'payouts', 'inventory', 'documents', 'full'] as const;
    const syncType = String(body.syncType ?? 'stores') as (typeof SYNC_TYPES)[number];
    if (!(SYNC_TYPES as readonly string[]).includes(syncType)) return NextResponse.json({ ok: false, error: `syncType must be one of ${SYNC_TYPES.join(', ')}` }, { status: 400 });
    const connector = getLiveConnector(platformKey);
    const health = await connector.testConnection();
    if (!health.canCallLive) return NextResponse.json({ ok: false, blocked: true, health }, { status: 400 });

    if (!hasSupabaseEnv()) {
      return NextResponse.json({
        ok: false,
        blocked: true,
        error: 'Supabase is not configured. Sync-now persists ingested records, so NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Use controlled-sync for a non-persisting preview.',
      }, { status: 503 });
    }

    const run = await createSyncRun(platformKey, syncType, { startDate: body.startDate, endDate: body.endDate });
    try {
      const records = await connector.sync({ syncType, startDate: body.startDate, endDate: body.endDate });
      // Records already ingested by an earlier (overlapping) sync are skipped; findings only for new rows.
      const inserted = await insertIngestedRecords(run.id, records);
      const findings = await runAiIngestionSupervisorForRecords(inserted);
      await finishSyncRun(run.id, { status: 'completed', records_fetched: records.length, records_ingested: inserted.length, ai_findings_created: findings.length, raw_summary: { syncType } });
      return NextResponse.json({ ok: true, runId: run.id, recordsFetched: records.length, recordsIngested: inserted.length, aiFindingsCreated: findings.length });
    } catch (error) {
      await finishSyncRun(run.id, { status: 'failed', error_message: String(error) });
      return NextResponse.json({ ok: false, runId: run.id, error: String(error) }, { status: 500 });
    }
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const status = message.startsWith('Unsupported platform') ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
});
