// Recovery runner — "never lose an order" (docs/MASTER_PLAN.md Phase 1). Runs every few seconds from wherever Food Hub
// is alive: the server timer (instrumentation.ts), the 1-minute cron (/api/foodhub/cron/watch), every sync and every
// open screen's pulse. Each run is cheap when there is nothing to do.
//   1. Automatic Clover retries: an order Clover did not take is sent again after 30 s and 2 min (order-retry.ts),
//      looking in Clover first when the last answer was lost — then, once Clover has it, the usual auto-accept.
//   2. The webhook inbox (inbox.ts): a webhook that was saved but never processed (the server stopped right after
//      answering the platform) or that failed is processed again.
import crypto from 'node:crypto';
import { logActivity } from './activity';
import { CHANNEL_LABELS } from './config';
import { armRetryTimer, cloverRetryDelaysS } from './order-retry';
import { autoAcceptAfterClover, resendToClover } from './pipeline';
import { getRepo } from './repo';

const CLAIM_TTL_MS = 90_000;

export interface CloverRetryReport { due: number; recovered: number; failed: number; gaveUp: number }

export async function runCloverRetries(opts: { now?: number; trigger?: string } = {}): Promise<CloverRetryReport> {
  const now = opts.now ?? Date.now();
  const repo = getRepo();
  const out: CloverRetryReport = { due: 0, recovered: 0, failed: 0, gaveUp: 0 };
  const delays = cloverRetryDelaysS();
  const waiting = (await repo.listOrders({ statuses: ['new'], limit: 500 })).filter((o) => !o.posOrderId && o.timeline?.posRetry?.nextAt && Date.parse(o.timeline.posRetry.nextAt) <= now);
  for (const o of waiting) {
    const fresh = await repo.getOrder(o.id);
    const pr = fresh?.timeline?.posRetry;
    if (!fresh || !pr?.nextAt || Date.parse(pr.nextAt) > now) continue;
    if (fresh.posOrderId || fresh.status !== 'new') { await repo.patchOrder(fresh.id, { posRetry: { ...pr, nextAt: null } }); continue; }
    if (pr.claimedAt && now - Date.parse(pr.claimedAt) < CLAIM_TTL_MS) continue;
    // Claim it (another server, timer or screen may run at the same moment) and check the claim stuck.
    const claim = crypto.randomUUID();
    await repo.patchOrder(fresh.id, { posRetry: { ...pr, claim, claimedAt: new Date(now).toISOString() } });
    const mine = await repo.getOrder(fresh.id);
    if (!mine || mine.timeline?.posRetry?.claim !== claim) continue;
    out.due++;
    const attempt = pr.attempts + 1;
    const tag = `${CHANNEL_LABELS[mine.channel]} #${mine.displayId || mine.externalOrderId.slice(0, 8)}`;
    const sent = await resendToClover(mine, { attempt });
    if (sent.pos.ok) {
      out.recovered++;
      await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'order', action: 'clover_retry_ok', status: 'success', channel: mine.channel, brandName: mine.brandName, locationCode: mine.locationCode, orderId: mine.id,
        summary: `${tag} reached Clover on automatic try ${attempt}${sent.pos.adopted ? ' (Clover already had it — linked, not sent twice)' : ''}` });
      // Clover has it now: the usual auto-accept, if the store wants it and the platform has not cancelled meanwhile.
      if (sent.store?.autoAccept && sent.order.status === 'new') await autoAcceptAfterClover(sent.order, sent.pos.posOrderId);
      continue;
    }
    out.failed++;
    const nextS = delays[attempt];
    const gaveUp = nextS === undefined;
    const state = { attempts: attempt, nextAt: gaveUp ? null : new Date(now + nextS * 1000).toISOString(), lastError: sent.pos.error, uncertain: Boolean(sent.pos.uncertain || pr.uncertain), ...(gaveUp ? { gaveUpAt: new Date(now).toISOString() } : {}) };
    await repo.patchOrder(mine.id, { posRetry: state });
    if (gaveUp) {
      out.gaveUp++;
      await repo.addEvent(mine.id, 'pos_retry_gave_up', { message: `Clover still did not take the order after ${attempt} automatic tries — a manager is alerted. Use "Send to Clover" once Clover is back, or enter it by hand and use "Accept without Clover".`, error: sent.pos.error });
      await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'order', action: 'clover_retry_gave_up', status: 'failed', channel: mine.channel, brandName: mine.brandName, locationCode: mine.locationCode, orderId: mine.id,
        summary: `${tag}: Clover still refused it after ${attempt} automatic tries (${sent.pos.error}) — the Watchtower is waking a manager` });
    } else {
      armRetryTimer(nextS * 1000);
    }
  }
  return out;
}

export interface RecoveryReport { at: string; trigger: string; ran: boolean; clover: CloverRetryReport; inbox: { processed: number; failed: number } }

const LAST_KEY = 'recovery:last';

/** Both runners, at most every 10 s across the whole deployment (KV-throttled), unless forced. */
export async function runOrderRecovery(opts: { now?: number; trigger?: string; force?: boolean } = {}): Promise<RecoveryReport> {
  const now = opts.now ?? Date.now();
  const repo = getRepo();
  const empty: RecoveryReport = { at: new Date(now).toISOString(), trigger: opts.trigger ?? 'manual', ran: false, clover: { due: 0, recovered: 0, failed: 0, gaveUp: 0 }, inbox: { processed: 0, failed: 0 } };
  const g = globalThis as unknown as { __takatakRecoveryRunning?: number };
  if (g.__takatakRecoveryRunning && now - g.__takatakRecoveryRunning < 60_000) return empty;
  if (!opts.force) {
    const last = await repo.getKv<{ at: string }>(LAST_KEY).catch(() => null);
    if (last && now - Date.parse(last.at) < 10_000) return empty;
  }
  g.__takatakRecoveryRunning = now;
  try {
    await repo.setKv(LAST_KEY, { at: new Date(now).toISOString(), trigger: opts.trigger ?? 'manual' }).catch(() => undefined);
    const clover = await runCloverRetries({ now, trigger: opts.trigger }).catch((e) => { console.error('[foodhub] Clover retries failed', e); return empty.clover; });
    const { sweepInbox } = await import('./inbox');
    const inbox = await sweepInbox({ now }).catch((e) => { console.error('[foodhub] inbox sweep failed', e); return empty.inbox; });
    return { ...empty, ran: true, clover, inbox };
  } finally {
    g.__takatakRecoveryRunning = 0;
  }
}

export async function lastRecoveryRun(): Promise<{ at: string; trigger?: string } | null> {
  return getRepo().getKv<{ at: string; trigger?: string }>(LAST_KEY).catch(() => null);
}
