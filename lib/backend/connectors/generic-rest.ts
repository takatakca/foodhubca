import { BaseConnector } from './base';
import { DiscoveryResult } from './connector-types';
import { PlatformKey } from '@/lib/types';

export class GenericRestConnector extends BaseConnector {
  platform: PlatformKey;
  mode: 'oauth' | 'api_key' | 'manual_report' | 'screen_capture' | 'disabled';
  protected requiredEnv: string[];
  private endpointEnv: string;
  private tokenEnv: string;

  constructor(args: { platform: PlatformKey; mode: 'oauth' | 'api_key' | 'manual_report'; endpointEnv: string; tokenEnv: string; extraRequired?: string[] }) {
    super();
    this.platform = args.platform;
    this.mode = args.mode;
    this.endpointEnv = args.endpointEnv;
    this.tokenEnv = args.tokenEnv;
    this.requiredEnv = [args.endpointEnv, args.tokenEnv, ...(args.extraRequired ?? [])];
  }

  protected async fetchRealStores(): Promise<DiscoveryResult> {
    const base = process.env[this.endpointEnv]!;
    const token = process.env[this.tokenEnv]!;
    const url = `${base.replace(/\/$/, '')}/stores`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store'
    });

    if (!res.ok) {
      return { platform: this.platform, ok: false, message: `${this.platform} store discovery failed with HTTP ${res.status}`, entities: [] };
    }

    const json = await res.json() as any;
    const rows = Array.isArray(json) ? json : (json.data ?? json.stores ?? []);
    return {
      platform: this.platform,
      ok: true,
      message: `${rows.length} stores discovered from ${this.platform}`,
      entities: rows.map((row: any) => ({
        platform: this.platform,
        entityType: 'store',
        externalId: String(row.id ?? row.store_id ?? row.location_id ?? row.name),
        payload: row
      }))
    };
  }
}
