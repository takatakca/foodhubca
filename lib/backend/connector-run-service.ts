import { createServiceClient, hasSupabaseEnv } from '../supabase/server';
import { ConnectorHealthResult, IngestedRecordCandidate, PlatformKey } from './connectors/live-connector-types';

export async function logConnectorHealth(result: ConnectorHealthResult) {
  // Logging is best-effort. A missing/unreachable Supabase project must never
  // break a health check, so we skip silently when Supabase is not configured
  // and swallow insert errors (the health result is still returned to the UI).
  if (!hasSupabaseEnv()) return;
  try {
    const supabase = createServiceClient();
    await insertHealthRow(supabase, result);
  } catch {
    // best-effort logging only
  }
}

async function insertHealthRow(supabase: ReturnType<typeof createServiceClient>, result: ConnectorHealthResult) {
  await supabase.from('connector_health_checks').insert({
    platform_key: result.platformKey,
    status: result.status,
    can_call_live: result.canCallLive,
    missing_secret_keys: result.missingSecretKeys,
    latency_ms: result.latencyMs ?? null,
    error_message: result.status === 'error' ? result.message ?? null : null,
    raw_result: result.raw ?? {},
  });
}

export async function createSyncRun(platformKey: PlatformKey, syncType: string, window: { startDate?: string; endDate?: string } = {}) {
  const supabase = createServiceClient();
  const iso = (value?: string) => (value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null);
  const { data, error } = await supabase.from('connector_sync_runs').insert({
    platform_key: platformKey,
    sync_type: syncType,
    status: 'running',
    source_window_start: iso(window.startDate),
    source_window_end: iso(window.endDate),
    started_at: new Date().toISOString(),
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function finishSyncRun(id: string, patch: Record<string, unknown>) {
  const supabase = createServiceClient();
  await supabase.from('connector_sync_runs').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', id);
}

export async function insertIngestedRecords(runId: string, records: IngestedRecordCandidate[]) {
  if (!records.length) return [];
  const supabase = createServiceClient();
  const rows = records.map((record) => ({
    platform_key: record.platformKey,
    connector_run_id: runId,
    record_type: record.recordType,
    external_id: record.externalId ?? null,
    brand_hint: record.brandHint ?? null,
    location_hint: record.locationHint ?? null,
    store_hint: record.storeHint ?? null,
    occurred_at: record.occurredAt ?? null,
    amount: record.amount ?? null,
    currency: record.currency ?? 'CAD',
    raw_payload: record.rawPayload,
    normalized_payload: record.normalizedPayload ?? {},
  }));
  // Manual syncs overlap (Clover defaults to the last 7 days), so a record seen by an earlier run
  // is skipped (unique index: platform_key, record_type, external_id — release_1_4_0_patch.sql).
  // Only the rows actually inserted come back, so AI findings are created once per record.
  const { data, error } = await supabase
    .from('ingested_platform_records')
    .upsert(rows, { onConflict: 'platform_key,record_type,external_id', ignoreDuplicates: true })
    .select('*');
  if (error) throw error;
  return data ?? [];
}
