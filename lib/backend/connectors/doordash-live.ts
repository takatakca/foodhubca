import { AbstractLiveConnector } from './abstract-live-connector';
import { ConnectorHealthResult, ConnectorSyncRequest, DiscoveredEntity, IngestedRecordCandidate } from './live-connector-types';

export class DoorDashLiveConnector extends AbstractLiveConnector {
  platformKey = 'doordash' as const;
  requiredEnv = ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET'];

  protected async performTestConnection(): Promise<ConnectorHealthResult> {
    // HONESTY RULE: never report "healthy" without a real API call.
    // DoorDash reporting access differs by account/product. Until the exact
    // reporting endpoint granted to this account is configured, this connector
    // must stay blocked so sync cannot silently complete with zero records.
    return {
      platformKey: this.platformKey,
      status: 'blocked',
      canCallLive: false,
      missingSecretKeys: [],
      message: 'DoorDash credentials are present, but the account-specific reporting endpoint is not configured yet. Live sync stays blocked until the endpoint is confirmed, so no data can be silently missed.',
    };
  }

  protected async performAutodiscover(): Promise<DiscoveredEntity[]> {
    throw new Error('DoorDash auto-discovery is not enabled yet: the reporting endpoint for this account must be configured first.');
  }

  protected async performSync(_request: ConnectorSyncRequest): Promise<IngestedRecordCandidate[]> {
    throw new Error('DoorDash sync is not enabled yet: the reporting endpoint for this account must be configured first.');
  }
}
