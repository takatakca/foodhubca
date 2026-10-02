import { getLiveConnector } from './connectors/live-registry';
import { ConnectorSyncRequest, PlatformKey } from './connectors/live-connector-types';
import { analyzeLiveIngestionRecords } from './ai-live-ingestion-supervisor';

export type LiveSyncOrchestrationResult = {
  platformKey: PlatformKey;
  status: 'blocked' | 'completed' | 'failed';
  healthStatus?: string;
  discoveredCount?: number;
  syncedCount?: number;
  aiFindingsCreated?: number;
  message: string;
  records?: unknown[];
};

export async function runControlledLiveSync(platformKey: PlatformKey, request: ConnectorSyncRequest): Promise<LiveSyncOrchestrationResult> {
  const connector = getLiveConnector(platformKey);

  const health = await connector.testConnection();
  if (!health.canCallLive || health.status !== 'healthy') {
    return {
      platformKey,
      status: 'blocked',
      healthStatus: health.status,
      message: health.message || 'Connector health check blocked live sync.',
    };
  }

  const records = await connector.sync(request);
  const findings = analyzeLiveIngestionRecords(records.map((record) => ({
    platformKey: record.platformKey,
    recordType: record.recordType,
    externalId: record.externalId,
    amount: record.amount,
    rawPayload: record.rawPayload,
    normalizedPayload: record.normalizedPayload,
  })));

  return {
    platformKey,
    status: 'completed',
    healthStatus: health.status,
    syncedCount: records.length,
    aiFindingsCreated: findings.length,
    message: `Sync completed. ${records.length} records fetched and ${findings.length} AI finding(s) prepared for review.`,
    records,
  };
}
