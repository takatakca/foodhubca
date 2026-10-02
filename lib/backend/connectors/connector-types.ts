import { IngestEvent, PlatformKey } from '@/lib/types';

export type ConnectorMode = 'oauth' | 'api_key' | 'manual_report' | 'screen_capture' | 'disabled';

export type DiscoveryResult = {
  platform: PlatformKey;
  ok: boolean;
  message: string;
  entities: IngestEvent[];
  errors?: string[];
};

export interface PlatformConnector {
  platform: PlatformKey;
  mode: ConnectorMode;
  health(): Promise<{ ok: boolean; configured: boolean; message: string; missing: string[] }>;
  discoverStores(): Promise<DiscoveryResult>;
  fetchOrders?(from: string, to: string): Promise<DiscoveryResult>;
  fetchPayouts?(from: string, to: string): Promise<DiscoveryResult>;
}
