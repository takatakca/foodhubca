import { ConnectorHealthResult, ConnectorSyncRequest, DiscoveredEntity, IngestedRecordCandidate, LiveConnector, PlatformKey } from './live-connector-types';
import { liveConnectorsGloballyEnabled, missingEnv } from './env-utils';

export abstract class AbstractLiveConnector implements LiveConnector {
  abstract platformKey: PlatformKey;
  abstract requiredEnv: string[];

  protected blockedResult(missing: string[]): ConnectorHealthResult {
    return {
      platformKey: this.platformKey,
      status: missing.length ? 'not_configured' : 'blocked',
      canCallLive: false,
      missingSecretKeys: missing,
      message: missing.length
        ? `Missing required secure environment variables for ${this.platformKey}.`
        : 'Live connectors are globally disabled. Set LIVE_CONNECTORS_GLOBAL_ENABLED=true only after owner approval.',
    };
  }

  protected readinessCheck(): ConnectorHealthResult | null {
    const missing = missingEnv(this.requiredEnv);
    if (missing.length) return this.blockedResult(missing);
    if (!liveConnectorsGloballyEnabled()) return this.blockedResult([]);
    return null;
  }

  async testConnection(): Promise<ConnectorHealthResult> {
    const blocked = this.readinessCheck();
    if (blocked) return blocked;
    return this.performTestConnection();
  }

  async autodiscover(): Promise<DiscoveredEntity[]> {
    const blocked = this.readinessCheck();
    if (blocked) throw new Error(blocked.message || 'Connector blocked');
    return this.performAutodiscover();
  }

  async sync(request: ConnectorSyncRequest): Promise<IngestedRecordCandidate[]> {
    const blocked = this.readinessCheck();
    if (blocked) throw new Error(blocked.message || 'Connector blocked');
    return this.performSync(request);
  }

  protected abstract performTestConnection(): Promise<ConnectorHealthResult>;
  protected abstract performAutodiscover(): Promise<DiscoveredEntity[]>;
  protected abstract performSync(request: ConnectorSyncRequest): Promise<IngestedRecordCandidate[]>;
}
