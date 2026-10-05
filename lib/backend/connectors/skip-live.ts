import { AbstractLiveConnector } from './abstract-live-connector';
import { ConnectorHealthResult, ConnectorSyncRequest, DiscoveredEntity, IngestedRecordCandidate } from './live-connector-types';

export class SkipTheDishesLiveConnector extends AbstractLiveConnector {
  platformKey = 'skip_the_dishes' as const;
  // Same variables as the Food Hub Skip adapter and the setup wizard (JET Connect / Flyt).
  requiredEnv = ['SKIP_JET_BASE_URL', 'SKIP_JET_API_KEY'];

  protected async performTestConnection(): Promise<ConnectorHealthResult> {
    // HONESTY RULE: never report "healthy" without a real API call.
    return {
      platformKey: this.platformKey,
      status: 'blocked',
      canCallLive: false,
      missingSecretKeys: [],
      message: 'SkipTheDishes JET Connect credentials are present, but JET Connect has no reporting/sync endpoint for this connector yet. Orders, menus and store status already flow through Food Hub → Channels; this live sync stays blocked.',
    };
  }
  protected async performAutodiscover(): Promise<DiscoveredEntity[]> {
    throw new Error('SkipTheDishes auto-discovery is not enabled yet: partner API endpoint must be configured first.');
  }
  protected async performSync(_request: ConnectorSyncRequest): Promise<IngestedRecordCandidate[]> {
    throw new Error('SkipTheDishes sync is not enabled yet: partner API endpoint must be configured first.');
  }
}
