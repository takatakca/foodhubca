// TAKATAK Phone (the second Clover App Market app) on the phone module: is the AI phone allowed for a line's kitchens?
//
// The Clover merchant of a kitchen is the one metering bills (metering.ts): a store of the brand at that kitchen, else
// any store there, never the default merchant. Each kitchen's merchant goes through voiceAiEntitled
// (pos/clover-entitlement.ts):
//   - CLOVER_PHONE_APP_ID not set: no gate at all, nothing is read (the phone works exactly as before the app existed).
//   - One of PHONE_OWN_MERCHANTS: always allowed. A kitchen with no Clover merchant of its own: ours, allowed (it is
//     never billed either).
//   - 'call'  (a live call, the pay link): lenient — LAPSED within 7 days, Clover unreachable within 3 days of the last
//     good answer still go through. A refused call is never dropped: voice.ts hands it to the line's person.
//   - 'setup' (switching a line on, adding a kitchen to a line that is on): strict — refused with a FR / EN reason.
// A line with several kitchens is allowed only when every kitchen is (the caller may pick any of them).
import { explicitMerchantFor } from '../delivery/clover-direct';
import { cloverApp, cloverPhoneAppEnabled } from '../pos/clover-apps';
import { voiceAiEntitled, type EntitlementReason, type PhonePurpose } from '../pos/clover-entitlement';
import { lineKitchens, type PhoneLine, type PhoneLineKitchen } from './settings';

export type PhoneGateReason = EntitlementReason | 'no_merchant' | 'check_failed';

export interface PhoneGate {
  ok: boolean;
  reason: PhoneGateReason;
  /** The kitchen's Clover merchant (null: gate off, or no merchant of its own). */
  merchantId: string | null;
  /** The kitchen refused (or the first kitchen when allowed). */
  locationCode: string;
}

const OK_OFF = (locationCode: string): PhoneGate => ({ ok: true, reason: 'gate_off', merchantId: null, locationCode });

/** One kitchen (its location and the brand that names its Clover merchant). */
export async function kitchenPhoneGate(kitchen: Pick<PhoneLineKitchen, 'locationCode' | 'brands'>, purpose: PhonePurpose, opts: { now?: number } = {}): Promise<PhoneGate> {
  const locationCode = kitchen.locationCode;
  if (!cloverPhoneAppEnabled()) return OK_OFF(locationCode);
  let mid: string | null = null;
  try {
    mid = await explicitMerchantFor(kitchen.brands[0] ?? '', locationCode);
    if (!mid) return { ok: true, reason: 'no_merchant', merchantId: null, locationCode };
    const e = await voiceAiEntitled(mid, purpose, { now: opts.now });
    return { ok: e.ok, reason: e.reason, merchantId: mid, locationCode };
  } catch (e) {
    console.error('[foodhub] phone app check failed', e instanceof Error ? e.message : e);
    return { ok: false, reason: 'check_failed', merchantId: mid, locationCode };
  }
}

/** Every kitchen of a line (checked at once: a live call waits at most one Clover budget, 2.5 s). First refusal wins. */
export async function linePhoneGate(line: Pick<PhoneLine, 'locationCode' | 'brands' | 'kitchens'>, purpose: PhonePurpose, opts: { now?: number } = {}): Promise<PhoneGate> {
  if (!cloverPhoneAppEnabled()) return OK_OFF(line.locationCode);
  const gates = await Promise.all(lineKitchens(line).map((k) => kitchenPhoneGate(k, purpose, opts)));
  return gates.find((g) => !g.ok) ?? gates[0] ?? OK_OFF(line.locationCode);
}

const REASON: Partial<Record<PhoneGateReason, { fr: string; en: string }>> = {
  not_installed: { fr: 'l’app n’est pas installée pour ce marchand Clover', en: 'the app is not installed for this Clover merchant' },
  pending_approval: { fr: 'l’installation attend l’approbation du propriétaire (Réglages → App Clover)', en: 'the install is waiting for the owner’s approval (Settings → Clover app)' },
  lapsed: { fr: 'l’abonnement est échu (paiement en retard dans Clover)', en: 'the subscription has lapsed (payment overdue in Clover)' },
  suspended: { fr: 'l’abonnement est suspendu par Clover', en: 'the subscription is suspended by Clover' },
  inactive: { fr: 'l’abonnement n’est pas actif dans Clover', en: 'the subscription is not active in Clover' },
  unknown_status: { fr: 'Clover a donné un statut d’abonnement inconnu', en: 'Clover gave an unknown subscription status' },
  clover_unreachable: { fr: 'Clover ne répond pas pour confirmer l’abonnement : réessayez dans quelques minutes', en: 'Clover is not answering to confirm the subscription: try again in a few minutes' },
  check_failed: { fr: 'la vérification a échoué : réessayez dans quelques minutes', en: 'the check failed: try again in a few minutes' },
};

/** Why a line cannot be switched on, in French then English (shown in the console). */
export function phoneGateMessage(g: PhoneGate, lineName: string): string {
  const app = cloverApp('phone').name;
  const r = REASON[g.reason] ?? { fr: `refusé (${g.reason})`, en: `refused (${g.reason})` };
  return `${app} n’est pas actif pour ${lineName} (cuisine ${g.locationCode}) : ${r.fr}. La ligne reste éteinte. / `
    + `${app} is not active for ${lineName} (kitchen ${g.locationCode}): ${r.en}. The line stays off.`;
}

/** The call log line of a refused live call (staff only, never said to the caller). */
export function phoneGateNote(g: PhoneGate): string {
  return `${cloverApp('phone').name} not active for kitchen ${g.locationCode} (${g.reason})`;
}
