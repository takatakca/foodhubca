// Background work for the expansion features, run right AFTER each Watchtower run (live pulse while a screen is open,
// the server timer, or the 1-minute cron) — never inside it — and throttled here to at most every 15 s:
//   - own delivery: auto-dispatch couriers that are due; read new Clover "Delivery" orders every 2 minutes
//   - phone: close calls that never sent a "completed" status (lost callbacks); ON2GO menu voicemails still to email
// Every part is skipped while its feature switch is off. Never throws.
import { getRepo } from '../repo';
import { getFeatures } from './features';

const LAST = 'expansion_tick_last';
const CLOVER_LAST = 'expansion_clover_delivery_last';

export async function tickExpansion(now = Date.now()): Promise<{ ran: boolean; booked?: number; cloverImported?: number; callsClosed?: number }> {
  const repo = getRepo();
  try {
    const features = await getFeatures();
    if (!features.delivery.on && !features.phone.on) return { ran: false };
    const last = await repo.getKv<number>(LAST).catch(() => null);
    if (last && now - last < 15_000) return { ran: false };
    await repo.setKv(LAST, now);
    const out: { ran: boolean; booked?: number; cloverImported?: number; callsClosed?: number } = { ran: true };
    if (features.delivery.on) {
      const lastClover = (await repo.getKv<number>(CLOVER_LAST).catch(() => null)) ?? 0;
      if (now - lastClover >= 2 * 60_000) {
        await repo.setKv(CLOVER_LAST, now);
        const [{ allCloverMerchants }, { importCloverDeliveryOrders }] = await Promise.all([import('../pos/clover'), import('../delivery/clover-source')]);
        let n = 0;
        for (const mid of await allCloverMerchants((await repo.listStores()).map((s) => s.cloverMerchantId))) n += (await importCloverDeliveryOrders(mid, now)).imported;
        out.cloverImported = n;
      }
      const { tickDispatch } = await import('../delivery/dispatch');
      out.booked = (await tickDispatch(now)).booked;
    }
    if (features.phone.on) {
      const { closeStaleCalls } = await import('../phone/calls');
      out.callsClosed = await closeStaleCalls(now);
      // ON2GO phone menu: calls that lost their last callback, voicemails not emailed yet.
      const { tickIvr } = await import('../phone/ivr/engine');
      out.callsClosed += (await tickIvr(now)).closed;
    }
    return out;
  } catch (e) {
    console.error('[foodhub] expansion tick failed', e instanceof Error ? e.message : e);
    return { ran: false };
  }
}
