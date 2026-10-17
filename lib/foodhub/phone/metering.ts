// TAKATAK Phone: when an ordering-line call is over, count the minutes the AI handled and hand them to the Clover
// per-minute metering (pos/clover-phone-minutes.ts: off unless FOODHUB_PHONE_METERED_ENABLED=true, ACTIVE merchants
// only, once per call SID).
// The merchant billed is the kitchen's OWN Clover merchant (a store of the call's brand at the call's kitchen, else any
// store there; never the default merchant). A line with several kitchens bills the kitchen the caller chose, or the
// line's first kitchen when none was chosen. No Clover merchant for the kitchen = nothing billed.
// The ON2GO menu (our own line) is never metered. Never throws: a metering problem never touches the call.
import { explicitMerchantFor } from '../delivery/clover-direct';
import { aiHandledSeconds, recordCallMinutes, type MinuteResult } from '../pos/clover-phone-minutes';
import { getCall } from './calls';
import { getPhoneSettings } from './settings';

export async function meterEndedCall(callId: string, now = Date.now()): Promise<MinuteResult | null> {
  try {
    const call = await getCall(callId);
    if (!call || call.status === 'active') return null;
    if (call.simulated) return { outcome: 'test_call', minutes: 0 };
    const line = (await getPhoneSettings()).lines.find((l) => l.id === call.lineId);
    const locationCode = call.locationCode || line?.locationCode || '';
    const brand = call.brands[0] ?? line?.brands[0] ?? '';
    const mid = locationCode ? await explicitMerchantFor(brand, locationCode) : null;
    if (!mid) return null;
    return await recordCallMinutes({ callSid: call.id, merchantId: mid, aiSeconds: aiHandledSeconds(call), endedAt: call.endedAt }, { now });
  } catch (e) {
    console.error('[foodhub] phone minutes metering failed', e instanceof Error ? e.message : e);
    return null;
  }
}
