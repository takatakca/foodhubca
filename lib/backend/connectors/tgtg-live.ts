import { AbstractLiveConnector } from './abstract-live-connector';
import { ConnectorHealthResult, ConnectorSyncRequest, DiscoveredEntity, IngestedRecordCandidate } from './live-connector-types';

export class TooGoodToGoLiveConnector extends AbstractLiveConnector {
  platformKey = 'too_good_to_go' as const;
  requiredEnv = ['TGTG_BASE_URL', 'TGTG_API_KEY'];

  protected async performTestConnection(): Promise<ConnectorHealthResult> {
    // HONESTY RULE: never report "healthy" without a real API call.
    return {
      platformKey: this.platformKey,
      status: 'blocked',
      canCallLive: false,
      missingSecretKeys: [],
      message: 'Too Good To Go credential configuration is present, but partner/report access must be confirmed and the endpoint configured before live sync is allowed.',
    };
  }
  protected async performAutodiscover(): Promise<DiscoveredEntity[]> {
    throw new Error('Too Good To Go auto-discovery is not enabled yet: partner/report endpoint must be configured first.');
  }
  protected async performSync(_request: ConnectorSyncRequest): Promise<IngestedRecordCandidate[]> {
    throw new Error('Too Good To Go sync is not enabled yet: partner/report endpoint must be configured first.');
  }
}
