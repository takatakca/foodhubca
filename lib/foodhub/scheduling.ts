// Scheduled (advance) orders: the platform sends them early; the kitchen must start at the right time.
// Food Hub still puts them in Clover and accepts them right away (platform rule), but the kitchen ticket
// prints at "fire time" = customer time − prep time, and they wait in a "Scheduled" lane until then.
import { logActivity } from './activity';
import { CHANNEL_LABELS, nowIso } from './config';
import { cloverAutoPrintEnabled, printCloverOrder } from './pos/clover';
import { getRepo } from './repo';
import { localTimeLabel } from './time';
import type { NormalizedOrder, StoredOrder } from './types';

/** Fire-time print attempts before the order is released to the kitchen lane with a "Ticket not printed" flag. */
export const MAX_FIRE_PRINT_ATTEMPTS = 3;

/** An order counts as scheduled when the customer wants it this many minutes after it arrives (default 60). */
export function scheduledThresholdMin() {
  const v = Number(process.env.FOODHUB_SCHEDULED_AFTER_MIN);
  return Number.isFinite(v) && v > 0 ? v : 60;
}

export function scheduledInfo(n: Pick<NormalizedOrder, 'readyBy'>, prepMinutes: number, now = Date.now()): { scheduledFor: string; fireAt: string } | null {
  if (!n.readyBy) return null;
  const due = Date.parse(n.readyBy);
  if (!Number.isFinite(due) || due - now < scheduledThresholdMin() * 60_000) return null;
  // Kitchen should already have started (prep ≥ time left): not scheduled, print once on arrival like any order.
  if (due - prepMinutes * 60_000 <= now) return null;
  return { scheduledFor: new Date(due).toISOString(), fireAt: new Date(due - prepMinutes * 60_000).toISOString() };
}

export function isWaitingScheduled(o: Pick<StoredOrder, 'timeline' | 'status'>, now = Date.now()) {
  return Boolean(o.timeline?.fireAt && !o.timeline.firedAt && Date.parse(o.timeline.fireAt) > now && ['new', 'accepted'].includes(o.status));
}

/** Housekeeping: print the kitchen ticket of every scheduled order whose fire time has come. */
export async function fireDueScheduled(now = Date.now()): Promise<number> {
  const repo = getRepo();
  // Open orders only, with no createdAt bound: advance orders can be placed days before their fire time.
  const open = await repo.listOrders({ limit: 5000, statuses: ['new', 'accepted'] });
  const due = open.filter((o) => o.timeline?.fireAt && !o.timeline.firedAt && Date.parse(o.timeline.fireAt) <= now);
  let fired = 0;
  for (const o of due) {
    const store = await repo.findStore(o.channel, o.channelStoreId);
    const tag = `${CHANNEL_LABELS[o.channel]} #${o.displayId || o.externalOrderId.slice(0, 8)}`;
    const dueLabel = localTimeLabel(o.timeline!.scheduledFor ?? o.timeline!.fireAt!);
    let printedAt: string | undefined;
    let printError: string | undefined;
    const attempts = (o.timeline?.printAttempts ?? 0) + 1;
    if (o.posOrderId && cloverAutoPrintEnabled()) {
      const p = await printCloverOrder(o.posOrderId, store?.cloverMerchantId);
      await repo.addEvent(o.id, p.ok ? 'printed' : 'print_failed', { message: `${p.message} (scheduled order — fire time, attempt ${attempts})` });
      if (p.ok) printedAt = nowIso(); else printError = p.message;
    }
    if (printError && attempts < MAX_FIRE_PRINT_ATTEMPTS) {
      // Ticket did not print: keep the order in the Scheduled lane (firedAt unset) and retry on the next sync.
      await repo.patchOrder(o.id, { printError, printAttempts: attempts });
      await logActivity({ actor: 'TAKATAK automation', source: 'automation', kind: 'order', action: 'scheduled_fire', status: 'failed', channel: o.channel, brandName: o.brandName, locationCode: o.locationCode, orderId: o.id,
        summary: `Scheduled ${tag}: kitchen ticket did NOT print (${printError}) — retry ${attempts}/${MAX_FIRE_PRINT_ATTEMPTS} on the next sync (due ${dueLabel})` });
      continue;
    }
    await repo.patchOrder(o.id, { firedAt: nowIso(), printAttempts: attempts, ...(printedAt ? { printedAt, printError: undefined } : printError ? { printError } : {}) });
    await repo.addEvent(o.id, 'fired', { message: printError ? 'Scheduled order released to the kitchen lane — ticket NOT printed, use Reprint' : 'Scheduled order sent to the kitchen' });
    await logActivity({ actor: 'TAKATAK automation', source: 'automation', kind: 'order', action: 'scheduled_fire', status: printError ? 'failed' : 'info', channel: o.channel, brandName: o.brandName, locationCode: o.locationCode, orderId: o.id,
      summary: printError
        ? `Scheduled ${tag}: kitchen ticket did NOT print after ${attempts} attempts (${printError}) — press Reprint (due ${dueLabel})`
        : `Scheduled ${tag} sent to the kitchen (due ${dueLabel})` });
    fired++;
  }
  return fired;
}
