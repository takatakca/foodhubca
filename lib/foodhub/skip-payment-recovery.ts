// Recover the proof of an existing direct Skip payment attempt. This runner cannot send a payment,
// refresh a Clover OAuth token, close a Clover order, or reopen a released attempt.
import { logActivity } from './activity';
import { CHANNEL_LABELS } from './config';
import { confirmedCloverPayment } from './pos/clover-books';
import { getRepo, type SkipPaymentRecoveryClaim } from './repo';

const CLAIM_LIMIT = 4;
const RETRY_INTERVAL_MS = 5 * 60_000;

export interface SkipPaymentRecoveryReport {
  claimed: number;
  recovered: number;
  terminalClosed: number;
  held: number;
  failed: number;
}

type RecoveryOutcome = Pick<SkipPaymentRecoveryReport, 'recovered' | 'terminalClosed' | 'held' | 'failed'>;

async function recoverClaim(claim: SkipPaymentRecoveryClaim): Promise<RecoveryOutcome> {
  const repo = getRepo();
  const { order, paymentAttempt: claimed } = claim;
  const { merchantId, posOrderId, paymentReference } = claimed;
  const idle = { recovered: 0, terminalClosed: 0, held: 0, failed: 0 };
  if (order.channel !== 'skip' || order.viaHub || order.viaPos || order.posOrderId !== posOrderId
    || order.timeline?.posMerchantId !== merchantId) return { ...idle, failed: 1 };
  const identity = { orderId: order.id, externalOrderId: order.externalOrderId, merchantId, posOrderId, paymentReference };
  const checked = await repo.applySkipLifecycle({ kind: 'check_payment', ...identity });
  const attempt = checked.paymentAttempt;
  if (!checked.order || !attempt || attempt.id !== claimed.id || attempt.merchantId !== merchantId
      || attempt.posOrderId !== posOrderId || attempt.paymentReference !== paymentReference) return { ...idle, held: 1 };

  const wasPaid = attempt.state === 'paid';
  const paymentId = wasPaid ? attempt.paymentId : await confirmedCloverPayment(merchantId, posOrderId, paymentReference, { background: true });
  if (!paymentId) return { ...idle, held: 1 };
  const result = await repo.applySkipLifecycle({
    kind: 'finish_payment', ...identity, attemptId: attempt.id, result: 'paid', paymentId, closeTerminal: true,
  });
  if (result.order?.timeline?.posPaymentId !== paymentId || result.outcome !== 'payment_finished'
    || result.paymentAttempt?.id !== attempt.id) return { ...idle, held: 1 };

  if (result.completedClosure) {
    const tag = result.order.displayId || result.order.externalOrderId.slice(0, 8);
    await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'order', action: 'clover_paid_cancelled',
      status: 'failed', channel: 'skip', brandName: result.order.brandName, locationCode: result.order.locationCode,
      orderId: order.id, summary: `${CHANNEL_LABELS.skip} #${tag} was cancelled after it was recorded as paid in Clover — check the payout; refund it in the Clover app if the platform did not pay you.` });
  }
  return { ...idle, recovered: wasPaid ? 0 : 1, terminalClosed: result.completedClosure ? 1 : 0 };
}

export async function recoverSkipCloverPayments(now: number): Promise<SkipPaymentRecoveryReport> {
  const repo = getRepo();
  const claims = await repo.claimSkipPaymentRecoveries({ now: new Date(now).toISOString(), limit: CLAIM_LIMIT });
  const nextCheckAt = new Date(now + RETRY_INTERVAL_MS).toISOString();
  const results = await Promise.all(claims.map(async (claim): Promise<RecoveryOutcome> => {
    try {
      return await recoverClaim(claim);
    } catch {
      return { recovered: 0, terminalClosed: 0, held: 0, failed: 1 };
    } finally {
      // Explicitly delay the next read. If the worker disappears, expiration alone cannot authorize another send.
      await repo.rescheduleSkipPaymentRecovery({ attemptId: claim.paymentAttempt.id, leaseId: claim.leaseId, nextCheckAt }).catch(() => false);
    }
  }));
  const report = { claimed: claims.length, recovered: 0, terminalClosed: 0, held: 0, failed: 0 };
  for (const result of results) {
    report.recovered += result.recovered;
    report.terminalClosed += result.terminalClosed;
    report.held += result.held;
    report.failed += result.failed;
  }
  return report;
}
