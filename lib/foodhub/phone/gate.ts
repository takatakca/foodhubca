// TAKATAK Phone (the second Clover App Market app) on the phone module: is the AI phone allowed for a line's kitchens?
//
// The Clover merchant of a kitchen is the one metering bills (metering.ts): a store of the brand at that kitchen, else
// any store there, never the default merchant. Each kitchen's merchant goes through voiceAiEntitled
// (pos/clover-entitlement.ts):
//   - CLOVER_PHONE_APP_ID not set: no gate at all, nothing is read (the phone works exactly as before the app existed).
//   - One of ours (phoneOwnMerchants: PHONE_OWN_MERCHANTS, CLOVER_MERCHANT_ID, CLOVER_MERCHANT_TOKENS,
//     FOODHUB_BILLING_EXEMPT_MERCHANTS): always allowed. A kitchen with no Clover merchant of its own: ours, allowed (it
//     is never billed either; kitchens are only ever created by the owner in the console).
//   - 'call'  (a live call, the pay link): lenient — LAPSED within 7 days, Clover unreachable within 3 days of the last
//     good answer still go through, and the check itself failing (database blip) lets the AI answer (logged; metering
//     still decides billing). A refused call is never dropped: voice.ts hands it to the line's person, else ON2GO.
//   - 'setup' (switching a line on, adding a kitchen to a line that is on): strict — refused with a FR / EN reason.
// A line with several kitchens is allowed only when every kitchen is (the caller may pick any of them); switching on a
// line that mixes our kitchens with a client's is refused (the client's subscription would gate ours).
import { explicitMerchantFor } from '../delivery/clover-direct';
import { cloverApp, cloverPhoneAppEnabled, phoneOwnMerchants } from '../pos/clover-apps';
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

export interface PhoneGateOpts {
  now?: number;
  /** Longest wait on Clover (default CHECK_BUDGET_MS, 2.5 s). A webhook that has already used time passes less. */
  budgetMs?: number;
}

const OK_OFF = (locationCode: string): PhoneGate => ({ ok: true, reason: 'gate_off', merchantId: null, locationCode });

/** One kitchen (its location and the brand that names its Clover merchant). */
export async function kitchenPhoneGate(kitchen: Pick<PhoneLineKitchen, 'locationCode' | 'brands'>, purpose: PhonePurpose, opts: PhoneGateOpts = {}): Promise<PhoneGate> {
  const locationCode = kitchen.locationCode;
  if (!cloverPhoneAppEnabled()) return OK_OFF(locationCode);
  let mid: string | null = null;
  try {
    mid = await explicitMerchantFor(kitchen.brands[0] ?? '', locationCode);
    if (!mid) return { ok: true, reason: 'no_merchant', merchantId: null, locationCode };
    const e = await voiceAiEntitled(mid, purpose, { now: opts.now, budgetMs: opts.budgetMs });
    return { ok: e.ok, reason: e.reason, merchantId: mid, locationCode };
  } catch (e) {
    // A live call fails open (the AI answers, metering decides billing later); setting a line up waits for a real answer.
    console.error(`[foodhub] phone app check failed (kitchen ${locationCode}, ${purpose}: ${purpose === 'call' ? 'AI answers' : 'refused'})`, e instanceof Error ? e.message : e);
    return { ok: purpose === 'call', reason: 'check_failed', merchantId: mid, locationCode };
  }
}

/** Every kitchen of a line (checked at once: a live call waits at most one Clover budget). First refusal wins. */
export async function linePhoneGate(line: Pick<PhoneLine, 'locationCode' | 'brands' | 'kitchens'>, purpose: PhonePurpose, opts: PhoneGateOpts = {}): Promise<PhoneGate> {
  if (!cloverPhoneAppEnabled()) return OK_OFF(line.locationCode);
  const gates = await Promise.all(lineKitchens(line).map((k) => kitchenPhoneGate(k, purpose, opts)));
  const refused = gates.find((g) => !g.ok);
  if (refused && purpose === 'call') console.warn(`[foodhub] ${phoneGateNote(refused)}${refused.merchantId ? ` (merchant ${refused.merchantId})` : ''}: call handed to a person`);
  return refused ?? gates[0] ?? OK_OFF(line.locationCode);
}

/** Whether a kitchen is ours for the phone app (no gate, no Clover merchant of its own, or one of our merchants). */
export async function kitchenIsOurs(kitchen: Pick<PhoneLineKitchen, 'locationCode' | 'brands'>): Promise<boolean> {
  if (!cloverPhoneAppEnabled()) return true;
  const mid = await explicitMerchantFor(kitchen.brands[0] ?? '', kitchen.locationCode);
  return !mid || phoneOwnMerchants().has(mid);
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

/** The end of a refusal: a new line stays off; a line already on keeps its old settings (nothing is saved). */
const OUTCOME = (wasOn: boolean) => (wasOn
  ? { fr: 'Les changements ne sont pas enregistrés ; la ligne reste comme avant.', en: 'Changes not saved; the line stays as it was.' }
  : { fr: 'La ligne reste éteinte.', en: 'The line stays off.' });

/** Why a line cannot be switched on (or changed), in French then English (shown in the console). */
export function phoneGateMessage(g: PhoneGate, lineName: string, opts: { wasOn?: boolean } = {}): string {
  const app = cloverApp('phone').name;
  const r = REASON[g.reason] ?? { fr: `refusé (${g.reason})`, en: `refused (${g.reason})` };
  const o = OUTCOME(Boolean(opts.wasOn));
  return `${app} n’est pas actif pour ${lineName} (cuisine ${g.locationCode}) : ${r.fr}. ${o.fr} / `
    + `${app} is not active for ${lineName} (kitchen ${g.locationCode}): ${r.en}. ${o.en}`;
}

/** Why a line may not mix our kitchens with a client's (FR then EN). */
export function phoneMixedMessage(lineName: string, ours: string[], clients: string[], opts: { wasOn?: boolean } = {}): string {
  const app = cloverApp('phone').name;
  const o = OUTCOME(Boolean(opts.wasOn));
  return `${lineName} : une même ligne ne peut pas mêler nos cuisines (${ours.join(', ')}) et celles d’un client (${clients.join(', ')}), car ${app} se paie par marchand Clover. Mettez-les sur deux numéros. ${o.fr} / `
    + `${lineName}: one line cannot mix our kitchens (${ours.join(', ')}) with a client's (${clients.join(', ')}), because ${app} is paid per Clover merchant. Put them on two numbers. ${o.en}`;
}

/** The call log line of a refused live call (staff only, never said to the caller). */
export function phoneGateNote(g: PhoneGate): string {
  return `${cloverApp('phone').name} not active for kitchen ${g.locationCode} (${g.reason})`;
}
