export type PlatformKey =
  | 'clover'
  | 'doordash'
  | 'uber_eats'
  | 'skip_the_dishes'
  | 'too_good_to_go';

export type ConnectorAction = 'health' | 'autodiscover' | 'sync';

export type ConnectorHealthStatus = 'not_configured' | 'blocked' | 'healthy' | 'unhealthy' | 'error';

export type ConnectorHealthResult = {
  platformKey: PlatformKey;
  status: ConnectorHealthStatus;
  canCallLive: boolean;
  missingSecretKeys: string[];
  latencyMs?: number;
  message?: string;
  raw?: Record<string, unknown>;
};

export type DiscoveredEntity = {
  platformKey: PlatformKey;
  entityType: 'account' | 'location' | 'store' | 'brand' | 'channel' | 'merchant' | 'inventory_location';
  externalId?: string;
  name?: string;
  address?: string;
  brandHint?: string;
  locationHint?: string;
  raw: Record<string, unknown>;
};

export type ConnectorSyncRequest = {
  syncType: 'stores' | 'orders' | 'payouts' | 'inventory' | 'documents' | 'full';
  startDate?: string;
  endDate?: string;
};

export type IngestedRecordCandidate = {
  platformKey: PlatformKey;
  recordType: 'store' | 'order' | 'payout' | 'payment' | 'refund' | 'adjustment' | 'inventory' | 'document';
  externalId?: string;
  brandHint?: string;
  locationHint?: string;
  storeHint?: string;
  occurredAt?: string;
  amount?: number;
  currency?: string;
  rawPayload: Record<string, unknown>;
  normalizedPayload?: Record<string, unknown>;
};

export interface LiveConnector {
  platformKey: PlatformKey;
  requiredEnv: string[];
  /** Missing credential variables, when the connector accepts more than one credential set (Uber). Defaults to missingEnv(requiredEnv). */
  missingCredentials?(): string[];
  testConnection(): Promise<ConnectorHealthResult>;
  autodiscover(): Promise<DiscoveredEntity[]>;
  sync(request: ConnectorSyncRequest): Promise<IngestedRecordCandidate[]>;
}
