// Watchtower — the background supervisor. It watches orders, stores, tablets, Clover and the platforms,
// opens an incident when something goes wrong, and escalates until a person handles it:
//   on screen (beep) → SMS to the manager on duty → phone call → the owner.
// It never accepts, cancels, refunds or changes anything by itself (AI = supervisor only).

export type IncidentKind =
  | 'order_unaccepted'   // a new order is waiting and the platform deadline is coming
  | 'order_unseen'       // auto-accepted, but nobody looked at the kitchen screen
  | 'order_late'         // past its ready-by time and not ready
  | 'courier_waiting'    // the courier is at the counter, the food is not ready
  | 'pos_failed'         // Clover did not receive the order
  | 'store_offline'      // paused / closed by the platform during opening hours
  | 'store_deactivated'  // deactivated by the platform
  | 'device_offline'     // kitchen tablet off / no Wi-Fi during opening hours
  | 'device_muted'       // kitchen tablet sound off or screen hidden
  | 'cancel_spike'       // several cancellations in the last hour at one location
  | 'sync_stale'         // store statuses not refreshed
  | 'webhook_unreadable' // a platform sent something Food Hub could not read
  | 'menu_failed'        // a menu / 86 / pause did not reach a platform
  | 'payout_gap'         // money to recover from the platforms
  | 'customer_issue';    // cancelled by the customer, missing item reported…

export type Severity = 'critical' | 'warning' | 'info';
export type IncidentStatus = 'open' | 'acknowledged' | 'snoozed' | 'resolved';

export interface IncidentStep {
  at: string;
  kind: 'opened' | 'screen' | 'sms' | 'call' | 'chat' | 'email' | 'owner' | 'ack' | 'snooze' | 'resolved' | 'reopened' | 'note' | 'customer_sms' | 'ai';
  to?: string;
  ok?: boolean;
  by?: string;
  message?: string;
}

export interface Incident {
  id: string;
  /** One incident per problem: e.g. "order_late:<orderId>", "device_offline:<deviceId>". */
  key: string;
  kind: IncidentKind;
  severity: Severity;
  status: IncidentStatus;
  /** French first (Québec team); English alongside. */
  title: string;
  titleEn: string;
  detail?: string;
  detailEn?: string;
  locationCode?: string | null;
  brandName?: string | null;
  channel?: string | null;
  orderId?: string | null;
  storeId?: string | null;
  deviceId?: string | null;
  openedAt: string;
  updatedAt: string;
  /** Last time the rule saw the problem still there. */
  lastSeenAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  ackBy?: string | null;
  ackAt?: string | null;
  snoozedUntil?: string | null;
  /** Escalation level reached: 0 screen, 1 SMS, 2 call, 3 owner. */
  level: number;
  steps: IncidentStep[];
  /** Plain-language explanation and what to do (rule text, or Claude when ANTHROPIC_API_KEY is set). */
  explanation?: string | null;
  suggestions?: string[];
  /** Customer contact for late orders, when the platform shares a phone number. */
  customer?: { name?: string | null; phone?: string | null; draftFr?: string; draftEn?: string } | null;
  /** How many times the rule fired again while open. */
  count: number;
}

export interface RuleSetting {
  enabled: boolean;
  /** Escalate by SMS / call / owner (otherwise screen + chat only). */
  escalate: boolean;
}

export interface WatchSettings {
  enabled: boolean;
  /** Minutes after opening before each escalation step (an acknowledged incident stops escalating). */
  smsAfterMin: number;
  callAfterMin: number;
  ownerAfterMin: number;
  /** Order rules */
  unacceptedAfterSec: number;
  unseenAfterSec: number;
  lateAfterMin: number;
  courierWaitMin: number;
  /** Quiet hours: only critical incidents escalate (screens still beep). */
  quietFrom: string;
  quietTo: string;
  /** Post warnings and critical incidents to team chat (ALERT_WEBHOOK_URL). */
  postToChat: boolean;
  /** Use Claude to explain incidents (needs ANTHROPIC_API_KEY). */
  aiExplain: boolean;
  /** Text late customers automatically with the delay message (only when the platform shares a phone). */
  autoTextLateCustomers: boolean;
  /** Extra numbers that get every critical alert (support line / live agent), E.164. */
  supportPhones: string[];
  rules: Record<IncidentKind, RuleSetting>;
  updatedAt?: string;
  updatedBy?: string;
}

export const INCIDENT_KINDS: IncidentKind[] = [
  'order_unaccepted', 'order_unseen', 'order_late', 'courier_waiting', 'pos_failed', 'store_offline', 'store_deactivated',
  'device_offline', 'device_muted', 'cancel_spike', 'sync_stale', 'webhook_unreadable', 'menu_failed', 'payout_gap', 'customer_issue',
];

export const KIND_LABEL: Record<IncidentKind, { fr: string; en: string }> = {
  order_unaccepted: { fr: 'Commande en attente', en: 'Order waiting' },
  order_unseen: { fr: 'Commande non vue en cuisine', en: 'Order not seen in the kitchen' },
  order_late: { fr: 'Commande en retard', en: 'Late order' },
  courier_waiting: { fr: 'Livreur qui attend', en: 'Courier waiting' },
  pos_failed: { fr: 'Clover n’a pas reçu la commande', en: 'Clover did not get the order' },
  store_offline: { fr: 'Magasin hors ligne', en: 'Store offline' },
  store_deactivated: { fr: 'Magasin désactivé', en: 'Store deactivated' },
  device_offline: { fr: 'Tablette éteinte', en: 'Tablet off' },
  device_muted: { fr: 'Tablette sans son', en: 'Tablet muted' },
  cancel_spike: { fr: 'Annulations en hausse', en: 'Cancellation spike' },
  sync_stale: { fr: 'Statuts pas à jour', en: 'Statuses not refreshed' },
  webhook_unreadable: { fr: 'Message illisible d’une plateforme', en: 'Unreadable platform message' },
  menu_failed: { fr: 'Action non reçue par une plateforme', en: 'Action not received by a platform' },
  payout_gap: { fr: 'Argent à récupérer', en: 'Money to recover' },
  customer_issue: { fr: 'Problème client', en: 'Customer issue' },
};

const on = (escalate = true): RuleSetting => ({ enabled: true, escalate });

export const DEFAULT_RULES: Record<IncidentKind, RuleSetting> = {
  order_unaccepted: on(), order_unseen: on(), order_late: on(), courier_waiting: on(), pos_failed: on(),
  store_offline: on(), store_deactivated: on(), device_offline: on(), device_muted: on(),
  cancel_spike: on(false), sync_stale: on(false), webhook_unreadable: on(false), menu_failed: on(false), payout_gap: on(false), customer_issue: on(false),
};

export const DEFAULT_WATCH: WatchSettings = {
  enabled: true,
  smsAfterMin: 2,
  callAfterMin: 5,
  ownerAfterMin: 10,
  unacceptedAfterSec: 60,
  unseenAfterSec: 120,
  lateAfterMin: 5,
  courierWaitMin: 3,
  quietFrom: '23:30',
  quietTo: '07:00',
  postToChat: true,
  aiExplain: true,
  autoTextLateCustomers: false,
  supportPhones: [],
  rules: DEFAULT_RULES,
};
