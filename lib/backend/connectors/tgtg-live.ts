import { AbstractLiveConnector } from './abstract-live-connector';
import { ConnectorHealthResult, ConnectorSyncRequest, DiscoveredEntity, IngestedRecordCandidate } from './live-connector-types';

export class TooGoodToGoLiveConnector extends AbstractLiveConnector {
  platformKey = 'too_good_to_go' as const;
  // Too Good To Go is webhook-only: the only credential is the inbound webhook secret.
  requiredEnv = ['TGTG_WEBHOOK_SECRET'];
  static readonly WEBHOOK_ONLY = 'Too Good To Go is webhook-only: there is no public merchant API, so nothing can be fetched. Bag orders arrive through the TGTG webhook (Food Hub → Channels).';

  // Reported as blocked whatever the env/global switch says: there is no API to call.
  async testConnection(): Promise<ConnectorHealthResult> {
    return this.performTestConnection();
  }
  protected async performTestConnection(): Promise<ConnectorHealthResult> {
    // HONESTY RULE: never report "healthy" without a real API call — and there is none to make.
    return {
      platformKey: this.platformKey,
      status: 'blocked',
      canCallLive: false,
      missingSecretKeys: [],
      message: TooGoodToGoLiveConnector.WEBHOOK_ONLY,
    };
  }
  protected async performAutodiscover(): Promise<DiscoveredEntity[]> {
    throw new Error(TooGoodToGoLiveConnector.WEBHOOK_ONLY);
  }
  protected async performSync(_request: ConnectorSyncRequest): Promise<IngestedRecordCandidate[]> {
    throw new Error(TooGoodToGoLiveConnector.WEBHOOK_ONLY);
  }
}
