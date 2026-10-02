import { AbstractLiveConnector } from './abstract-live-connector';
import { ConnectorHealthResult, ConnectorSyncRequest, DiscoveredEntity, IngestedRecordCandidate } from './live-connector-types';

export class SkipTheDishesLiveConnector extends AbstractLiveConnector {
  platformKey = 'skip_the_dishes' as const;
  requiredEnv = ['SKIP_BASE_URL', 'SKIP_API_KEY'];

  protected async performTestConnection(): Promise<ConnectorHealthResult> {
    // HONESTY RULE: never report "healthy" without a real API call.
    return {
      platformKey: this.platformKey,
      status: 'blocked',
      canCallLive: false,
      missingSecretKeys: [],
      message: 'SkipTheDishes credentials are present, but partner API access must be confirmed and the endpoint configured before live sync is allowed.',
    };
  }
  protected async performAutodiscover(): Promise<DiscoveredEntity[]> {
    throw new Error('SkipTheDishes auto-discovery is not enabled yet: partner API endpoint must be configured first.');
  }
  protected async performSync(_request: ConnectorSyncRequest): Promise<IngestedRecordCandidate[]> {
    throw new Error('SkipTheDishes sync is not enabled yet: partner API endpoint must be configured first.');
  }
}
