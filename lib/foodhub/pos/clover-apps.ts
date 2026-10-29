// The Clover App Market apps this backend serves. One Next.js backend, several Clover apps, each sold on its own:
//
//  - "foodhub" — TAKATAK Food Hub (platform orders → Clover, menu sync, kitchen screen). Its keys are the original
//    ones (CLOVER_CLIENT_ID / CLOVER_CLIENT_SECRET / CLOVER_WEBHOOK_AUTH), its tokens the original store
//    (clover_oauth_merchants): nothing changes for it.
//  - "phone"   — the AI phone app (default name "TAKATAK Phone AI"): answers calls, takes the order, texts a Clover pay
//    link. Optional: until CLOVER_PHONE_APP_ID and CLOVER_PHONE_APP_SECRET are set it does not exist (its routes
//    answer 404, it is never listed as configured) and the server behaves exactly as before.
//
// Clover has no "app B needs app A" setting: each app works alone. When a merchant installs both, the two
// connections share the merchant ID, so the phone uses Food Hub's menu, stores and order list (docs/CLOVER_MULTI_APP.md).
// Each app has its own OAuth callback, webhook, verification code and token store, keyed by merchant ID: an app's
// tokens are only ever used for that app's features (the phone app never unlocks Food Hub features).
import { missingEnv } from '../env-utils';

export type CloverAppKey = 'foodhub' | 'phone';
export const CLOVER_APP_KEYS: readonly CloverAppKey[] = ['foodhub', 'phone'];

export interface CloverAppDef {
  key: CloverAppKey;
  /** Name shown to merchants and in the console (matches the App Market listing). */
  name: string;
  /** Clover App ID = OAuth client_id. Null = not set on this server. */
  appId: string | null;
  /** App Secret (server-side only, never returned by an API). */
  secret: string | null;
  /** X-Clover-Auth code of this app's webhook. */
  webhookAuth: string | null;
  /** Environment variable names (for setup hints; values are never shown). */
  env: { appId: string; secret: string; webhookAuth: string };
  /** fh_kv key of this app's connections ({ [merchantId]: CloverConnection }). */
  tokenStoreKey: string;
  /** fh_kv key of this app's last webhook verification code. */
  verifyKey: string;
  /** Owner-started connect ("Connect a Clover merchant"). */
  startPath: string;
  /** OAuth redirect + Alternate Launch Path in the Clover dashboard. */
  callbackPath: string;
  /** Webhook URL path in the Clover dashboard. */
  webhookPath: string;
  /** Webhook events this app subscribes to in Clover. The phone app takes App events only, so Food Hub's menu and
   *  order handlers never run twice for a merchant that has both apps. */
  events: ReadonlyArray<'app' | 'inventory' | 'orders'>;
}

const env = (k: string) => (process.env[k] && process.env[k]!.trim() ? process.env[k]!.trim() : null);

const DEFS: Record<CloverAppKey, Omit<CloverAppDef, 'appId' | 'secret' | 'webhookAuth' | 'name'> & { defaultName: string; nameEnv?: string }> = {
  foodhub: {
    key: 'foodhub',
    defaultName: 'TAKATAK Food Hub',
    env: { appId: 'CLOVER_CLIENT_ID', secret: 'CLOVER_CLIENT_SECRET', webhookAuth: 'CLOVER_WEBHOOK_AUTH' },
    tokenStoreKey: 'clover_oauth_merchants',
    verifyKey: 'clover_webhook_verification',
    startPath: '/api/foodhub/clover-connect/start',
    callbackPath: '/api/foodhub/clover-connect/callback',
    webhookPath: '/api/foodhub/webhooks/clover',
    events: ['app', 'inventory', 'orders'],
  },
  phone: {
    key: 'phone',
    defaultName: 'TAKATAK Phone AI',
    nameEnv: 'CLOVER_PHONE_APP_NAME',
    env: { appId: 'CLOVER_PHONE_APP_ID', secret: 'CLOVER_PHONE_APP_SECRET', webhookAuth: 'CLOVER_PHONE_WEBHOOK_AUTH' },
    tokenStoreKey: 'clover_oauth_merchants:phone',
    verifyKey: 'clover_webhook_verification:phone',
    startPath: '/api/foodhub/clover-connect/phone/start',
    callbackPath: '/api/foodhub/clover-connect/phone/callback',
    webhookPath: '/api/foodhub/webhooks/clover/phone',
    events: ['app'],
  },
};

/** The app's definition, read from the environment now (env changes apply without a restart in tests). */
export function cloverApp(key: CloverAppKey = 'foodhub'): CloverAppDef {
  const d = DEFS[key];
  const { defaultName, nameEnv, ...rest } = d;
  // Food Hub reads its keys raw (never trimmed), exactly as before several apps existed: the authorize URL, the code
  // exchange, the refresh, the launch-state signature, the wrong-app check, the App-event filter and the webhook auth
  // all keep using the very same values. A new app (the phone) trims them.
  const read = key === 'foodhub' ? (k: string) => process.env[k] || null : env;
  return {
    ...rest,
    name: (nameEnv && env(nameEnv)) || defaultName,
    appId: read(d.env.appId),
    secret: read(d.env.secret),
    webhookAuth: read(d.env.webhookAuth),
  };
}

export function isCloverAppKey(v: unknown): v is CloverAppKey {
  return typeof v === 'string' && (CLOVER_APP_KEYS as readonly string[]).includes(v);
}

/** App ID + secret set: the app can connect merchants. */
export function cloverAppKeysSet(key: CloverAppKey = 'foodhub'): boolean {
  const d = DEFS[key];
  return missingEnv([d.env.appId, d.env.secret]).length === 0;
}

/** Missing key names for an app (empty = configured). */
export function cloverAppMissing(key: CloverAppKey = 'foodhub'): string[] {
  const d = DEFS[key];
  return missingEnv([d.env.appId, d.env.secret]);
}

/**
 * The phone app exists on this server once its App ID is set (its routes answer from then on, so Clover's webhook
 * verification can land before the secret is pasted). Without it, every phone route answers 404.
 */
export function cloverPhoneAppEnabled(): boolean {
  return Boolean(env(DEFS.phone.env.appId));
}

/** Every app known to this server with its configuration (the phone app is listed even when not set, as "not set"). */
export function cloverApps(): CloverAppDef[] {
  return CLOVER_APP_KEYS.map((k) => cloverApp(k));
}

/** Which of our apps a Clover App ID belongs to (null = not one of ours, or that app is not set here). */
export function cloverAppByAppId(appId: string | null | undefined): CloverAppKey | null {
  const id = String(appId || '').trim();
  if (!id) return null;
  for (const k of CLOVER_APP_KEYS) if (cloverApp(k).appId === id) return k;
  return null;
}

const idList = (v: string | undefined) => String(v || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

/**
 * Our own restaurants for the phone app (never billed, always allowed): PHONE_OWN_MERCHANTS, comma-separated, plus the
 * merchants this server already treats as ours: the default CLOVER_MERCHANT_ID, the keys of CLOVER_MERCHANT_TOKENS
 * (tokens pasted by the owner, never a client's) and FOODHUB_BILLING_EXEMPT_MERCHANTS. So adding the phone app env and
 * forgetting one ID in PHONE_OWN_MERCHANTS never takes the AI off the owner's own lines.
 */
export function phoneOwnMerchants(): Set<string> {
  const ids = new Set([...idList(process.env.PHONE_OWN_MERCHANTS), ...idList(process.env.FOODHUB_BILLING_EXEMPT_MERCHANTS), ...idList(process.env.CLOVER_MERCHANT_ID)]);
  try {
    const map: unknown = JSON.parse(process.env.CLOVER_MERCHANT_TOKENS || '{}');
    if (map && typeof map === 'object' && !Array.isArray(map)) for (const k of Object.keys(map)) if (k.trim()) ids.add(k.trim());
  } catch { /* not JSON: ignored, as clover.ts does */ }
  return ids;
}

/**
 * Merchants never billed by either app (TAKATAK Phone minutes, Food Hub extra brands): FOODHUB_BILLING_EXEMPT_MERCHANTS
 * (comma-separated) and our own restaurants (phoneOwnMerchants: PHONE_OWN_MERCHANTS, CLOVER_MERCHANT_ID,
 * CLOVER_MERCHANT_TOKENS), so forgetting one list never bills our own merchant.
 */
export function billingExemptMerchants(): Set<string> {
  return new Set([...idList(process.env.FOODHUB_BILLING_EXEMPT_MERCHANTS), ...phoneOwnMerchants()]);
}
