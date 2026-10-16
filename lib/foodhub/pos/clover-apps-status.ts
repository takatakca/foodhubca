// Settings → Clover app → "Clover apps on this server": each of our Clover apps, whether its keys are set, its
// addresses for the Clover dashboard, its webhook state and which merchants installed it (never tokens or secrets).
import { publicBaseUrl } from '../config';
import { cloverApps, cloverPhoneAppEnabled, type CloverAppKey } from './clover-apps';
import { listCloverConnections } from './clover-oauth';
import { cloverWebhookVerification } from './clover-webhook-gate';

export interface CloverAppInstall {
  merchantId: string;
  name: string | null;
  status: 'active' | 'pending';
  billing: { status: string | null; inTrial: boolean; plan: string | null } | null;
  /** The merchant installed our other app too (they share the merchant's menu, stores and orders). */
  bothApps: boolean;
}

export interface CloverAppStatus {
  key: CloverAppKey;
  name: string;
  appId: string | null;
  /** App ID + secret set: merchants can connect. */
  configured: boolean;
  /** The app exists on this server (Food Hub always; the phone app once CLOVER_PHONE_APP_ID is set). */
  enabled: boolean;
  /** Missing environment variable NAMES (values are never shown). */
  missing: string[];
  env: { appId: string; secret: string; webhookAuth: string };
  connectUrl: string;
  launchPath: string;
  webhookUrl: string;
  events: ReadonlyArray<'app' | 'inventory' | 'orders'>;
  webhookAuthSet: boolean;
  verification: { code: string; at: string } | null;
  installs: CloverAppInstall[];
}

export async function cloverAppsOverview(opts: { showVerification?: boolean } = {}): Promise<CloverAppStatus[]> {
  const base = publicBaseUrl();
  const defs = cloverApps();
  const lists = await Promise.all(defs.map((d) => (d.key === 'foodhub' || cloverPhoneAppEnabled() ? listCloverConnections(d.key).catch(() => []) : Promise.resolve([]))));
  const byApp = new Map(defs.map((d, i) => [d.key, new Set(lists[i].map((c) => c.merchantId))]));
  return Promise.all(defs.map(async (d, i) => {
    const enabled = d.key === 'foodhub' || cloverPhoneAppEnabled();
    const others = defs.filter((o) => o.key !== d.key).map((o) => byApp.get(o.key) ?? new Set<string>());
    const missing = [d.env.appId, d.env.secret].filter((k) => !String(process.env[k] || '').trim());
    return {
      key: d.key,
      name: d.name,
      appId: d.appId,
      configured: missing.length === 0,
      enabled,
      missing,
      env: d.env,
      connectUrl: `${base}${d.startPath}`,
      launchPath: d.callbackPath,
      webhookUrl: `${base}${d.webhookPath}`,
      events: d.events,
      webhookAuthSet: Boolean(d.webhookAuth),
      verification: opts.showVerification && enabled ? await cloverWebhookVerification(d.key) : null,
      installs: lists[i].map((c) => ({
        merchantId: c.merchantId,
        name: c.name,
        status: c.status,
        billing: c.billing ? { status: c.billing.status, inTrial: c.billing.inTrial, plan: c.billing.plan } : null,
        bothApps: others.some((s) => s.has(c.merchantId)),
      })),
    };
  }));
}
