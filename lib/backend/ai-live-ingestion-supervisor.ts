import { createServiceClient } from '../supabase/server';

export type IngestionFinding = {
  ingestedRecordId: string;
  platformKey: string;
  findingType: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description?: string;
  confidence?: number;
  suggestedAction?: string;
};

export function analyzeRecord(record: any): IngestionFinding[] {
  const findings: IngestionFinding[] = [];
  const payload = record.raw_payload ?? {};

  if (!record.external_id) {
    findings.push({
      ingestedRecordId: record.id,
      platformKey: record.platform_key,
      findingType: 'missing_external_id',
      severity: 'medium',
      title: 'Incoming record is missing external ID',
      description: 'The record was saved, but cannot be safely matched until an external platform ID is found.',
      confidence: 90,
      suggestedAction: 'Review raw payload and map correct external ID field.',
    });
  }

  if (record.record_type === 'store') {
    const name = String(record.store_hint || payload.name || '').toLowerCase();
    if (name.includes('(i)')) {
      findings.push({
        ingestedRecordId: record.id,
        platformKey: record.platform_key,
        findingType: 'store_deactivated_symbol',
        severity: 'high',
        title: 'Store appears deactivated',
        description: '(I) in the store name means deactivated by locked business rule.',
        confidence: 98,
        suggestedAction: 'Create/reactivate platform store fix task.',
      });
    }
    if (name.includes('(z)')) {
      findings.push({
        ingestedRecordId: record.id,
        platformKey: record.platform_key,
        findingType: 'store_active_closed_symbol',
        severity: 'low',
        title: 'Store appears active but closed',
        description: '(Z) means active but currently closed by locked business rule.',
        confidence: 98,
        suggestedAction: 'Monitor hours/status; do not mark as deactivated.',
      });
    }
  }

  if (typeof record.amount === 'number' && record.amount < 0) {
    findings.push({
      ingestedRecordId: record.id,
      platformKey: record.platform_key,
      findingType: 'negative_amount',
      severity: 'high',
      title: 'Negative platform amount detected',
      description: 'This may represent refund, chargeback, fee, or adjustment.',
      confidence: 85,
      suggestedAction: 'Route to reconciliation review.',
    });
  }

  return findings;
}

export async function runAiIngestionSupervisorForRecords(records: any[]) {
  const enabled = process.env.AI_INGESTION_ENABLED !== 'false';
  if (!enabled || !records.length) return [];

  const supabase = createServiceClient();
  const findings = records.flatMap(analyzeRecord);
  if (!findings.length) return [];

  const { data, error } = await supabase.from('ai_ingestion_findings').insert(findings.map((finding) => ({
    ingested_record_id: finding.ingestedRecordId,
    platform_key: finding.platformKey,
    finding_type: finding.findingType,
    severity: finding.severity,
    title: finding.title,
    description: finding.description ?? null,
    confidence: finding.confidence ?? 0,
    suggested_action: finding.suggestedAction ?? null,
  }))).select('*');

  if (error) throw error;
  return data ?? [];
}

export function analyzeLiveIngestionRecords(records: Array<{
  platformKey: string;
  recordType: string;
  externalId?: string;
  amount?: number;
  rawPayload?: Record<string, unknown>;
  normalizedPayload?: Record<string, unknown>;
}>) {
  return records.flatMap((record, index) => analyzeRecord({
    id: record.externalId || `live-${record.platformKey}-${index}`,
    platform_key: record.platformKey,
    record_type: record.recordType,
    external_id: record.externalId,
    amount: record.amount,
    raw_payload: record.rawPayload || {},
    normalized_payload: record.normalizedPayload || {},
    store_hint: (record.normalizedPayload?.storeHint || record.rawPayload?.name || '') as string,
  }));
}
