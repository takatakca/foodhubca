import { timedFetch } from './env-utils';
import { AbstractLiveConnector } from './abstract-live-connector';
import { ConnectorHealthResult, ConnectorSyncRequest, DiscoveredEntity, IngestedRecordCandidate } from './live-connector-types';

// Cached OAuth token when using client-credentials flow.
let cachedToken: { value: string; expiresAt: number } | null = null;

export class UberEatsLiveConnector extends AbstractLiveConnector {
  platformKey = 'uber_eats' as const;
  requiredEnv = ['UBER_BASE_URL'];

  // Auth accepted in either form:
  //  - UBER_ACCESS_TOKEN (static token), or
  //  - UBER_CLIENT_ID + UBER_CLIENT_SECRET (token fetched + refreshed automatically)
  protected readinessCheck(): ConnectorHealthResult | null {
    const baseBlocked = super.readinessCheck();
    if (baseBlocked) return baseBlocked;
    const hasStatic = Boolean(process.env.UBER_ACCESS_TOKEN);
    const hasOauth = Boolean(process.env.UBER_CLIENT_ID && process.env.UBER_CLIENT_SECRET);
    if (!hasStatic && !hasOauth) {
      return {
        platformKey: this.platformKey,
        status: 'not_configured',
        canCallLive: false,
        missingSecretKeys: ['UBER_ACCESS_TOKEN (or UBER_CLIENT_ID + UBER_CLIENT_SECRET)'],
        message: 'Provide UBER_ACCESS_TOKEN, or UBER_CLIENT_ID + UBER_CLIENT_SECRET so a token can be fetched automatically.',
      };
    }
    return null;
  }

  private async getAccessToken(): Promise<string> {
    if (process.env.UBER_ACCESS_TOKEN) return process.env.UBER_ACCESS_TOKEN;
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
    const authUrl = process.env.UBER_AUTH_URL || 'https://auth.uber.com/oauth/v2/token';
    const scope = process.env.UBER_OAUTH_SCOPE || 'eats.store';
    const body = new URLSearchParams({
      client_id: process.env.UBER_CLIENT_ID!,
      client_secret: process.env.UBER_CLIENT_SECRET!,
      grant_type: 'client_credentials',
      scope,
    });
    const res = await timedFetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Uber OAuth token request failed: HTTP ${res.status}. Check UBER_CLIENT_ID/SECRET and the approved scope (UBER_OAUTH_SCOPE, default "eats.store").`);
    const json = await res.json();
    if (!json.access_token) throw new Error('Uber OAuth response did not include an access_token.');
    const ttlMs = (Number(json.expires_in) || 2592000) * 1000;
    cachedToken = { value: json.access_token, expiresAt: Date.now() + ttlMs };
    return cachedToken.value;
  }

  private async headers() {
    return { Authorization: `Bearer ${await this.getAccessToken()}`, 'Content-Type': 'application/json' };
  }

  protected async performTestConnection(): Promise<ConnectorHealthResult> {
    const started = Date.now();
    try {
      const res = await timedFetch(`${process.env.UBER_BASE_URL!.replace(/\/$/, '')}/v1/eats/stores`, { headers: await this.headers() });
      return { platformKey: this.platformKey, status: res.ok ? 'healthy' : 'unhealthy', canCallLive: res.ok, missingSecretKeys: [], latencyMs: Date.now() - started, message: res.ok ? 'Uber Eats connection OK.' : `Uber Eats returned HTTP ${res.status}.`, raw: { status: res.status } };
    } catch (error) {
      return { platformKey: this.platformKey, status: 'error', canCallLive: false, missingSecretKeys: [], latencyMs: Date.now() - started, message: String(error) };
    }
  }

  protected async performAutodiscover(): Promise<DiscoveredEntity[]> {
    const res = await timedFetch(`${process.env.UBER_BASE_URL!.replace(/\/$/, '')}/v1/eats/stores`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`Uber Eats store discovery failed: HTTP ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json?.stores) ? json.stores : Array.isArray(json?.data) ? json.data : [];
    return rows.map((row: any) => ({ platformKey: this.platformKey, entityType: 'store', externalId: String(row.id ?? row.store_id ?? ''), name: row.name, address: row.location?.address ?? row.address, raw: row }));
  }

  protected async performSync(request: ConnectorSyncRequest): Promise<IngestedRecordCandidate[]> {
    if (request.syncType === 'stores') {
      const entities = await this.performAutodiscover();
      return entities.map((entity) => ({ platformKey: this.platformKey, recordType: 'store' as const, externalId: entity.externalId, locationHint: entity.name, storeHint: entity.name, rawPayload: entity.raw }));
    }
    throw new Error(`Uber Eats sync type "${request.syncType}" is not enabled yet. Supported now: stores. Order/report endpoints are enabled once Uber approves the reporting scopes for your app.`);
  }
}
