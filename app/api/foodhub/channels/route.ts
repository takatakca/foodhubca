import { CHANNEL_KEYS, getAdapter } from '@/lib/foodhub/adapters';
import { liveConnectorsGloballyEnabled, publicBaseUrl } from '@/lib/foodhub/config';
import { withPerm } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { can } from '@/lib/foodhub/session';
import { VERIFY_KEY, cloverInventorySyncEnabled } from '@/lib/foodhub/clover-sync';
import { cloverReadiness, cloverTokenFor, knownCloverMerchants } from '@/lib/foodhub/pos/clover';
import { cloverAppReadiness, listCloverConnections } from '@/lib/foodhub/pos/clover-oauth';
import { cloverOrderTypesEnabled, cloverRecordPaymentEnabled } from '@/lib/foodhub/pos/clover-books';
import { getRepo } from '@/lib/foodhub/repo';
import { relayReadiness } from '@/lib/foodhub/adapters/relay';

export const dynamic = 'force-dynamic';

// Behind sign-in. Only the owner (admin) can use `?reveal=1`, which returns the webhook secrets that
// npm run setup generated, so the owner can hand them to each platform from this screen.
// Platform API keys (Uber secret, DoorDash signing secret, JET API key, Clover token) are NEVER returned.
export const GET = withPerm('stores:map', async (req, _ctx, actor) => {
  const url = new URL(req.url);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  // Without a dashboard password, secrets are only revealed to a browser on this same machine.
  const reveal = url.searchParams.get('reveal') === '1' && can(actor.role, 'admin') && (Boolean(process.env.DASHBOARD_PASSWORD) || local);
  const repo = getRepo();
  const base = publicBaseUrl();
  const channels = CHANNEL_KEYS.map((k) => {
    const r = getAdapter(k).readiness();
    return {
      ...r,
      webhookUrl: `${base}${r.webhookPath}`,
      extraWebhooks: (r.extraWebhooks ?? []).map((w) => ({ label: w.label, url: `${base}${w.path}` })),
      handoff: (r.handoff ?? []).map((h) => ({ label: h.label, envKey: h.envKey, set: Boolean(process.env[h.envKey]), value: reveal ? process.env[h.envKey] || '' : undefined })),
    };
  });
  const jobs = await repo.listJobs(40);
  return ok({
    mode: repo.mode,
    publicUrl: base,
    liveEnabled: liveConnectorsGloballyEnabled(),
    dashboardProtected: Boolean(process.env.DASHBOARD_PASSWORD),
    clover: {
      ...cloverReadiness(),
      // Merchants with an API token in the environment (CLOVER_ACCESS_TOKEN / CLOVER_MERCHANT_TOKENS): orders reach them too.
      tokenMerchants: knownCloverMerchants().filter((m) => cloverTokenFor(m)).length,
      webhookUrl: `${base}/api/foodhub/webhooks/clover`,
      webhookAuthSet: Boolean(process.env.CLOVER_WEBHOOK_AUTH),
      // The verification code is not a secret (Clover shows it to you too); only shown to owners.
      verification: can(actor.role, 'admin') ? await repo.getKv<{ code: string; at: string }>(VERIFY_KEY).catch(() => null) : null,
      recordPayments: cloverRecordPaymentEnabled(),
      orderTypes: cloverOrderTypesEnabled(),
      inventorySync: cloverInventorySyncEnabled(),
      // Clover App Market app: Site URL + launch path to enter in the Clover developer dashboard, connected merchants.
      app: { ...cloverAppReadiness(), connectUrl: `${base}/api/foodhub/clover-connect/start`, merchants: await listCloverConnections().catch(() => []) },
    },
    channels,
    // Food Hub Order Relay: partners that push orders (TGTG feed, website…) post to this address.
    relay: {
      ...relayReadiness(),
      webhookUrl: `${base}/api/foodhub/webhooks/relay?token=${reveal ? encodeURIComponent(process.env.FOODHUB_RELAY_SECRET || '') : '••••••••'}`,
      revealed: reveal,
    },
    jobs: jobs.filter((j) => j.kind !== 'webhook_unparsed'),
    unparsed: jobs.filter((j) => j.kind === 'webhook_unparsed'),
  });
});
