import { timedFetch } from './env-utils';
import { AbstractLiveConnector } from './abstract-live-connector';
import { ConnectorHealthResult, ConnectorSyncRequest, DiscoveredEntity, IngestedRecordCandidate } from './live-connector-types';

export class CloverLiveConnector extends AbstractLiveConnector {
  platformKey = 'clover' as const;
  requiredEnv = ['CLOVER_BASE_URL', 'CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN'];

  private headers() {
    return { Authorization: `Bearer ${process.env.CLOVER_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
  }

  protected async performTestConnection(): Promise<ConnectorHealthResult> {
    const started = Date.now();
    const base = process.env.CLOVER_BASE_URL!;
    const merchant = process.env.CLOVER_MERCHANT_ID!;
    try {
      const res = await timedFetch(`${base.replace(/\/$/, '')}/v3/merchants/${merchant}`, { headers: this.headers() });
      return { platformKey: this.platformKey, status: res.ok ? 'healthy' : 'unhealthy', canCallLive: res.ok, missingSecretKeys: [], latencyMs: Date.now() - started, message: res.ok ? 'Clover connection OK.' : `Clover returned HTTP ${res.status}.`, raw: { status: res.status } };
    } catch (error) {
      return { platformKey: this.platformKey, status: 'error', canCallLive: false, missingSecretKeys: [], latencyMs: Date.now() - started, message: String(error) };
    }
  }

  protected async performAutodiscover(): Promise<DiscoveredEntity[]> {
    const base = process.env.CLOVER_BASE_URL!;
    const merchant = process.env.CLOVER_MERCHANT_ID!;
    const res = await timedFetch(`${base.replace(/\/$/, '')}/v3/merchants/${merchant}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Clover merchant discovery failed: HTTP ${res.status}`);
    const row = await res.json();
    return [{ platformKey: this.platformKey, entityType: 'merchant', externalId: String(row.id ?? merchant), name: row.name, address: row.address?.address1, raw: row }];
  }

  protected async performSync(request: ConnectorSyncRequest): Promise<IngestedRecordCandidate[]> {
    const base = process.env.CLOVER_BASE_URL!;
    const merchant = process.env.CLOVER_MERCHANT_ID!;
    if (request.syncType === 'orders' || request.syncType === 'full') {
      // Clover filters use epoch-millisecond createdTime. Default window: last 7 days.
      const startMs = request.startDate ? Date.parse(request.startDate) : Date.now() - 7 * 24 * 60 * 60 * 1000;
      const endMs = request.endDate ? Date.parse(request.endDate) : Date.now();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new Error('Clover sync received an invalid startDate/endDate.');
      const limit = 100;
      const maxPages = 50; // safety cap: 5,000 orders per manual sync
      const records: IngestedRecordCandidate[] = [];
      for (let page = 0; page < maxPages; page += 1) {
        const filters = `filter=createdTime>=${startMs}&filter=createdTime<=${endMs}`;
        const url = `${base.replace(/\/$/, '')}/v3/merchants/${merchant}/orders?${filters}&limit=${limit}&offset=${page * limit}`;
        const res = await timedFetch(url, { headers: this.headers() });
        if (!res.ok) throw new Error(`Clover order sync failed: HTTP ${res.status}`);
        const json = await res.json();
        const rows = Array.isArray(json?.elements) ? json.elements : [];
        records.push(...rows.map((row: any) => ({
          platformKey: this.platformKey,
          recordType: 'order' as const,
          externalId: row.id,
          occurredAt: row.createdTime ? new Date(row.createdTime).toISOString() : undefined,
          amount: typeof row.total === 'number' ? row.total / 100 : undefined,
          currency: row.currency ?? 'CAD',
          rawPayload: row,
        })));
        if (rows.length < limit) break;
      }
      return records;
    }
    throw new Error(`Clover sync type "${request.syncType}" is not enabled yet. Supported: orders, full.`);
  }
}
