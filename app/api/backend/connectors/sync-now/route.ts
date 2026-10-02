import { NextRequest, NextResponse } from 'next/server';
import { getLiveConnector, parsePlatformKey } from '@/lib/backend/connectors/live-registry';
import { createSyncRun, finishSyncRun, insertIngestedRecords } from '@/lib/backend/connector-run-service';
import { runAiIngestionSupervisorForRecords } from '@/lib/backend/ai-live-ingestion-supervisor';
import { hasSupabaseEnv } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const platformKey = parsePlatformKey(body.platformKey);
    const syncType = body.syncType ?? 'stores';
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

    const run = await createSyncRun(platformKey, syncType);
    try {
      const records = await connector.sync({ syncType, startDate: body.startDate, endDate: body.endDate });
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
}
