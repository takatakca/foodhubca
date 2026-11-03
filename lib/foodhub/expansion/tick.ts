// Background work for the expansion features, run right AFTER each Watchtower run (live pulse while a screen is open,
// the server timer, or the 1-minute cron) — never inside it — and throttled here to at most every 15 s:
//   - own delivery: auto-dispatch couriers that are due; read new Clover "Delivery" orders every 2 minutes
//   - phone: close calls that never sent a "completed" status (lost callbacks); every 10 minutes, send TAKATAK Phone
//     minutes left pending (only with FOODHUB_PHONE_METERED_ENABLED=true; see pos/clover-phone-minutes.ts)
//   - ON2GO menu (on by default, whatever the switches): calls that lost their callback, voicemails still to email (retried)
//   - payment links (only with a Clover ecommerce key): ask Clover about held orders, one reminder, expiry
//   - Interac e-Transfers (own delivery on): one reminder, then the expiry of held website orders (a person confirms
//     the transfer; nothing here reads a bank)
// Every part is skipped while its feature switch is off. Never throws.
import { getRepo } from '../repo';
import { getFeatures } from './features';

const LAST = 'expansion_tick_last';
const CLOVER_LAST = 'expansion_clover_delivery_last';
const MINUTES_LAST = 'expansion_phone_minutes_last';

type TickOut = { ran: boolean; minutesReported?: number; booked?: number; cloverImported?: number; callsClosed?: number; voicemailsEmailed?: number; paylinks?: { checked: number; released: number; cancelled: number; reminded: number }; interac?: { checked: number; cancelled: number; reminded: number } };

export async function tickExpansion(now = Date.now()): Promise<TickOut> {
  const repo = getRepo();
  try {
    const features = await getFeatures();
    const [{ getIvrSettings }, { ecommConfigured }] = await Promise.all([import('../phone/ivr/config'), import('../pos/clover-checkout')]);
    const ivrOn = (await getIvrSettings()).enabled;
    const paylinks = ecommConfigured();
    if (!features.delivery.on && !features.phone.on && !ivrOn && !paylinks) return { ran: false };
    const last = await repo.getKv<number>(LAST).catch(() => null);
    if (last && now - last < 15_000) return { ran: false };
    await repo.setKv(LAST, now);
    const out: TickOut = { ran: true };
    if (paylinks) {
      // Before dispatch: a payment found here releases the order, and tickDispatch then books its courier.
      const { tickPaylinks } = await import('../delivery/paylink');
      out.paylinks = await tickPaylinks(now);
    }
    if (features.delivery.on) {
      const lastClover = (await repo.getKv<number>(CLOVER_LAST).catch(() => null)) ?? 0;
      if (now - lastClover >= 2 * 60_000) {
        await repo.setKv(CLOVER_LAST, now);
        const [{ allCloverMerchants }, { importCloverDeliveryOrders }] = await Promise.all([import('../pos/clover'), import('../delivery/clover-source')]);
        let n = 0;
        for (const mid of await allCloverMerchants((await repo.listStores()).map((s) => s.cloverMerchantId))) n += (await importCloverDeliveryOrders(mid, now)).imported;
        out.cloverImported = n;
      }
      const { tickInterac } = await import('../delivery/interac');
      out.interac = await tickInterac(now);
      const { tickDispatch } = await import('../delivery/dispatch');
      out.booked = (await tickDispatch(now)).booked;
    }
    if (features.phone.on) {
      const { closeStaleCalls } = await import('../phone/calls');
      out.callsClosed = await closeStaleCalls(now);
      const { phoneMeteringEnabled, settlePhoneMinutes } = await import('../pos/clover-phone-minutes');
      const lastMinutes = (await repo.getKv<number>(MINUTES_LAST).catch(() => null)) ?? 0;
      if (phoneMeteringEnabled() && now - lastMinutes >= 10 * 60_000) {
        await repo.setKv(MINUTES_LAST, now);
        out.minutesReported = (await settlePhoneMinutes({ now })).reported;
      }
    }
    if (ivrOn) {
      // ON2GO phone menu: calls that lost their last callback, voicemails not emailed yet (the menu is on by default,
      // so this runs even with every expansion switch off).
      const { tickIvr } = await import('../phone/ivr/engine');
      const r = await tickIvr(now);
      out.callsClosed = (out.callsClosed ?? 0) + r.closed;
      out.voicemailsEmailed = r.emailed;
    }
    return out;
  } catch (e) {
    console.error('[foodhub] expansion tick failed', e instanceof Error ? e.message : e);
    return { ran: false };
  }
}
