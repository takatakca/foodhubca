import { getRepo } from '../repo';
import { configuredControlPlane } from './config';
import { CONTROL_PLANE_MERCHANTS, CONTROL_PLANE_OUTBOX, CONTROL_PLANE_TICK, type MerchantState, type OutboxEntry, type TickReport } from './outbox';

export interface ControlPlaneStatus {
  configured: boolean; problem: string | null; durable: boolean; auth: 'scoped_bearer'; featureGates: 'not_implemented';
  merchants: Array<{ name: string | null; state: 'not_checked' | 'verified' | 'unlinked' | 'unavailable'; error: string | null; lastCheckedAt: string | null; lastVerifiedAt: string | null;
    sourceSubscriptionPlan: string | null; sourceSubscriptionStatus: string | null; nextAt: string | null }>;
  pending: number; failed: number; held: number; sent: number; countsLimited: boolean; monitoringSince: string | null; lastTickAt: string | null; tickError: string | null;
}

/** Restricted administrator read model only. Never proxies requests, settings, payloads or credentials. */
export async function controlPlaneStatus(): Promise<ControlPlaneStatus> {
  const { config, readiness } = configuredControlPlane();const repo = getRepo();
  const result: ControlPlaneStatus = { configured: readiness.configured, problem: readiness.problem, durable: repo.mode === 'supabase', auth: 'scoped_bearer', featureGates: 'not_implemented',
    merchants: [], pending: 0, failed: 0, held: 0, sent: 0, countsLimited: false, monitoringSince: null, lastTickAt: null, tickError: null };
  if (!config) return result;
  const [docs, states, tick, cursor] = await Promise.all([
    repo.listDocs<OutboxEntry>(CONTROL_PLANE_OUTBOX, { limit: 2000 }),
    Promise.all(config.merchants.map((b) => repo.getDoc<MerchantState>(CONTROL_PLANE_MERCHANTS, b.key))),
    repo.getKv<TickReport>(`${CONTROL_PLANE_TICK}:${config.fingerprint}`),
    repo.getKv<{ startedAt: string }>(`control-plane:cursor:${config.fingerprint}`),
  ]);
  const keys = new Set(config.merchants.map((m) => m.key));
  for (const doc of docs) {
    const item = doc.data;
    if (!keys.has(item.bindingKey) || item.origin !== config.url || item.instanceTenantId !== config.instanceTenantId) { if (item.state === 'pending') result.held++;continue; }
    if (item.state === 'pending') result.pending++;else if (item.state === 'failed') result.failed++;else if (item.state === 'sent') result.sent++;
  }
  result.countsLimited = docs.length >= 2000;
  result.monitoringSince = cursor?.startedAt ?? null;result.lastTickAt = tick?.at ?? null;result.tickError = tick?.skipped ?? null;
  result.merchants = states.map((doc) => {
    const s = doc?.data;const last = s?.last;const good = s?.lastGood;
    return { name: good?.storeName ?? null, state: !last ? 'not_checked' : last.verified ? 'verified' : last.error ? 'unavailable' : 'unlinked', error: last?.error ?? null,
      lastCheckedAt: last?.observedAt ?? null, lastVerifiedAt: good?.observedAt ?? null, sourceSubscriptionPlan: good?.subscriptionPlan ?? null,
      sourceSubscriptionStatus: good?.subscriptionStatus ?? null, nextAt: s?.nextAt ?? null };
  });
  return result;
}
