// Heartbeat of the store availability center (cron/watch, the live pulse, the server timer): the busy schedule, then the
// tablet-off guard. At most every 30 s (fh_kv availability_tick_last), one run at a time, never throws.
import { getRepo } from '../repo';
import { tickBusySchedule, type BusyTick } from './busy-schedule';
import { tickDowntimeGuard, type GuardTick } from './downtime-guard';

export const AVAILABILITY_TICK_KEY = 'availability_tick_last';
const MIN_GAP_MS = 30_000;

export interface AvailabilityTick { ran: boolean; busy?: BusyTick; guard?: GuardTick }

export async function tickAvailability(now = Date.now()): Promise<AvailabilityTick> {
  const g = globalThis as { __foodhubAvailabilityTick?: boolean };
  if (g.__foodhubAvailabilityTick) return { ran: false };
  g.__foodhubAvailabilityTick = true;
  try {
    const repo = getRepo();
    const last = await repo.getKv<number>(AVAILABILITY_TICK_KEY).catch(() => null);
    if (typeof last === 'number' && now - last < MIN_GAP_MS && now >= last) return { ran: false };
    await repo.setKv(AVAILABILITY_TICK_KEY, now);
    const busy = await tickBusySchedule(now);
    const guard = await tickDowntimeGuard(now);
    return { ran: true, busy, guard };
  } catch (e) {
    console.error('[foodhub] availability tick failed', e instanceof Error ? e.message : e);
    return { ran: false };
  } finally {
    g.__foodhubAvailabilityTick = false;
  }
}
