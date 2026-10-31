// Shared shapes of the Food Hub Assistant (server and panel). No server import here: the panel imports this file.
import type { Permission } from '../session';

export type Lang = 'fr' | 'en';

/** Which console screen the person is on (from the route). */
export type PageKey = 'home' | 'orders' | 'order' | 'menu' | 'menu86' | 'stores' | 'insights' | 'reviews' | 'money' | 'alerts' | 'autopilot' | 'settings' | 'kitchen' | 'direct' | 'other';

/** A notable thing on the page ("cancellation spike", "tablet off") with the question "Investigate this" asks. */
export interface PageSignal {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  fr: string;
  en: string;
  questionFr: string;
  questionEn: string;
}

/** Small structured picture of a page: route + key numbers already computed server-side (snapshot.ts). */
export interface PageSnapshot {
  route: string;
  page: PageKey;
  titleFr: string;
  titleEn: string;
  at: string;
  /** Kitchens the person sees ([] = all). */
  scope: string[];
  numbers: Record<string, number | string | boolean | null>;
  lists: Record<string, Array<Record<string, string | number | boolean | null>>>;
  signals: PageSignal[];
  /** Extra keys a page chose to share (components/assistant/page-context.ts). */
  extra?: Record<string, string | number | boolean | null>;
}

export interface NextStep {
  fr: string;
  en: string;
  /** Asked in the chat when the person taps the step. */
  askFr: string;
  askEn: string;
  href?: string;
}

/** What the panel posts when a page opens: a summary and 3–4 numbered next steps. */
export interface PageBrief {
  summaryFr: string;
  summaryEn: string;
  steps: NextStep[];
  signals: PageSignal[];
  source: 'claude' | 'rules';
}

export type ProposalKind = 'price_change' | 'item_availability' | 'store_status' | 'prep_time' | 'campaign_draft';
export type ProposalStatus = 'pending' | 'approved' | 'dismissed' | 'failed';

/** One line of "exactly what will change, where". */
export interface ProposalChange {
  /** What changes (item, store, setting). */
  fr: string;
  en: string;
  /** Where (platforms, brand, kitchen). */
  whereFr: string;
  whereEn: string;
  /** Value now (null when unknown) → value after Approve. */
  fromFr: string | null;
  fromEn: string | null;
  toFr: string;
  toEn: string;
}

/** What the card shows (never the internal request). */
export interface ProposalView {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  titleFr: string;
  titleEn: string;
  changes: ProposalChange[];
  /** Honest notes: left-out stores, "platforms get it at the next publish", big changes… */
  notesFr: string[];
  notesEn: string[];
  /** The Food Hub permission the person needs (checked again when they tap Approve). */
  perm: Permission;
  createdAt: string;
  decidedAt?: string | null;
  resultFr?: string | null;
  resultEn?: string | null;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** What the person typed / what the assistant answered (shown in the panel). */
  text: string;
  /** What was really sent to the model for this user turn (page context + question): replayed byte for byte. */
  prompt?: string;
  proposals?: ProposalView[];
  source?: 'claude' | 'rules';
  at: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
  messages: number;
}

/** One line of the streamed answer (NDJSON, app/api/foodhub/assistant/chat). */
export type StreamEvent =
  | { type: 'start'; chatId: string; source: 'claude' | 'rules'; aiConfigured: boolean }
  | { type: 'brief'; brief: PageBrief }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; fr: string; en: string }
  | { type: 'proposal'; proposal: ProposalView }
  | { type: 'error'; message: string; messageFr: string }
  | { type: 'done'; chatId: string; messageId: string | null };

/** Prompt chips (rotating) — DoorDash parity: analyze sales, update menu prices, pause the store. */
export const PROMPT_CHIPS: Array<{ fr: string; en: string }> = [
  { fr: 'Analyser mes ventes', en: 'Analyze my sales' },
  { fr: 'Changer les prix de mon menu', en: 'Update my menu prices' },
  { fr: 'Mettre mon magasin en pause', en: 'Pause my store' },
  { fr: 'Pourquoi des commandes annulées ?', en: 'Why were orders cancelled?' },
  { fr: 'Mes meilleurs articles cette semaine', en: 'My top items this week' },
  { fr: 'Les avis à répondre', en: 'Reviews to answer' },
];
