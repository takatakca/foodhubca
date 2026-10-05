// Who may do what without a manager: the owner chooses, per action, whether staff need a manager PIN.
//   off      anyone with the role permission can do it
//   manager  staff need a manager's (or the owner's) PIN; managers and the owner go straight through
//   always   everyone confirms with a manager PIN, even managers (their own PIN) — for the riskiest actions
// Money-sensitive actions default to "manager", so an employee cannot reject, cancel, refund or pause alone.
import { getRepo } from './repo';
import type { Role } from './types';

export type PolicyRule = 'off' | 'manager' | 'always';

export const ACTIONS = {
  'order.reject': { fr: 'Refuser une commande', en: 'Reject an order', def: 'manager' },
  'order.cancel': { fr: 'Annuler une commande acceptée', en: 'Cancel an accepted order', def: 'manager' },
  'order.adjust': { fr: 'Signaler un article manquant (remboursement)', en: 'Report a missing item (refund)', def: 'manager' },
  'order.delay': { fr: 'Ajouter du temps à une commande', en: 'Add time to an order', def: 'off' },
  'order.reprint': { fr: 'Réimprimer un billet', en: 'Reprint a ticket', def: 'off' },
  'customer.contact': { fr: 'Texter / appeler un client', en: 'Text / call a customer', def: 'manager' },
  'store.pause': { fr: 'Fermer / mettre en pause un magasin', en: 'Pause / close a store', def: 'manager' },
  'store.busy': { fr: 'Mode occupé (temps de préparation)', en: 'Busy mode (prep time)', def: 'off' },
  'item.86': { fr: 'Mettre un article en rupture (86)', en: '86 an item', def: 'off' },
  'menu.price': { fr: 'Changer un prix', en: 'Change a price', def: 'manager' },
  'menu.publish': { fr: 'Publier un menu', en: 'Publish a menu', def: 'off' },
  'money.edit': { fr: 'Argent : dépôts, litiges, commissions, grand livre', en: 'Money: deposits, disputes, fees, ledger', def: 'off' },
  'team.manage': { fr: "Gérer l'équipe et les appareils", en: 'Manage team and devices', def: 'off' },
} as const satisfies Record<string, { fr: string; en: string; def: PolicyRule }>;

export type PolicyAction = keyof typeof ACTIONS;
export type Policy = Record<PolicyAction, PolicyRule>;

export const APPROVER_ROLES: Role[] = ['owner', 'manager'];
const KEY = 'policy';

export function defaultPolicy(): Policy {
  return Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.def])) as Policy;
}

export async function getPolicy(): Promise<Policy> {
  const stored = (await getRepo().getKv<Partial<Policy>>(KEY).catch(() => null)) ?? {};
  const out = defaultPolicy();
  for (const k of Object.keys(out) as PolicyAction[]) if (stored[k] && ['off', 'manager', 'always'].includes(stored[k]!)) out[k] = stored[k]!;
  return out;
}

export async function savePolicy(patch: Partial<Record<string, string>>): Promise<Policy> {
  const cur = await getPolicy();
  for (const [k, v] of Object.entries(patch)) {
    if (k in ACTIONS && (v === 'off' || v === 'manager' || v === 'always')) cur[k as PolicyAction] = v;
  }
  await getRepo().setKv(KEY, cur);
  return cur;
}

/** Does this person need someone's PIN for this action? */
export function needsApproval(rule: PolicyRule, role: Role): boolean {
  if (rule === 'off') return false;
  if (rule === 'always') return true;
  return !APPROVER_ROLES.includes(role);
}
