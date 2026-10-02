import { featureFlags } from '@/lib/config';
import { PlatformConnector, DiscoveryResult } from './connector-types';
import { PlatformKey } from '@/lib/types';

export abstract class BaseConnector implements PlatformConnector {
  abstract platform: PlatformKey;
  abstract mode: 'oauth' | 'api_key' | 'manual_report' | 'screen_capture' | 'disabled';
  protected abstract requiredEnv: string[];

  protected missing() {
    return this.requiredEnv.filter(k => !process.env[k]);
  }

  protected liveAllowed() {
    return featureFlags.liveConnectorsEnabled;
  }

  async health() {
    const missing = this.missing();
    const configured = missing.length === 0;
    const ok = configured && this.liveAllowed();
    return {
      ok,
      configured,
      missing,
      message: ok
        ? `${this.platform} connector ready.`
        : configured
          ? `${this.platform} credentials configured, but LIVE_CONNECTORS_GLOBAL_ENABLED is false.`
          : `${this.platform} connector missing required server secrets.`
    };
  }

  async discoverStores(): Promise<DiscoveryResult> {
    const health = await this.health();
    if (!health.ok) {
      return { platform: this.platform, ok: false, message: health.message, entities: [], errors: health.missing };
    }
    return this.fetchRealStores();
  }

  protected abstract fetchRealStores(): Promise<DiscoveryResult>;
}
