// Plain-text kitchen ticket for the Food Hub tablet app (apps/kitchen-tablet), printed on the tablet's own thermal
// printer (ESC/POS, 58 mm = 32 columns, 80 mm = 42 columns). Pure: no clock, no database, no environment — the same
// order always gives the same text, so the layout is tested (tests/kitchen-ticket-text.test.ts).
//
// Format: one printed line per text line. A line starting with "@@" + flags + one space is styled by the app:
//   B = bold, C = centred, H = double width and height (so at most width / 2 characters).
//   e.g. "@@HBC #1234". Any other line prints as is; a content line that happens to start with "@@" gets a leading
//   space, so customer text can never style the paper. Characters are kept to Latin-1 + € (both CP858 and CP1252
//   print them, French accents included); curly quotes, dashes, emoji and the like are replaced or dropped here.
//
// Takatak MEV (Revenu Québec): when it issues the order's invoice, the only amounts on paper are the SEV's — this
// ticket then carries no amount at all (same rule as app/ticket/[id]/page.tsx, components/live/mev-ticket.tsx).
import type { DirectOrder } from '../delivery/types';
import type { MevRecord } from '../mev/types';
import { orderSourceLabel, type StoredOrder } from '../types';

export type TicketWidth = 32 | 42;
export type TicketLang = 'fr' | 'en';

export interface KitchenTicketLine {
  quantity: number;
  name: string;
  modifiers?: Array<{ quantity: number; name: string }>;
  notes?: string;
}

export interface KitchenTicket {
  /** "UBER EATS", "DOORDASH", "TÉLÉPHONE"… (already in the ticket's language). */
  platform: string;
  /** Second platform line (DoorDash « Storefront », Caviar…), when there is one. */
  platformDetail?: string | null;
  /** As said to the customer: "#A1B2C3", "IA-1043". */
  number: string;
  brandName?: string | null;
  customerFirstName?: string | null;
  fulfillment: 'pickup' | 'delivery' | 'dine_in';
  placedAt: string;
  readyAt?: string | null;
  scheduledFor?: string | null;
  /** Own orders only: paid already, or to be paid at the counter. */
  payment?: 'paid' | 'pay_at_pickup' | 'unpaid' | null;
  lines: KitchenTicketLine[];
  notes?: string | null;
  /** Null = no amounts on this paper (Takatak MEV issues the invoice). */
  total: number | null;
  /** Small last line ("Clover ABC123"). */
  footer?: string | null;
}

export interface CancelTicket {
  platform: string;
  number: string;
  brandName?: string | null;
  cancelledAt?: string | null;
  reason?: string | null;
}

export interface TicketOptions {
  width: TicketWidth;
  lang: TicketLang;
  /** IANA zone for the times on paper (FOODHUB_TIMEZONE, default America/Toronto: Montréal time). */
  timeZone?: string;
}

const T = {
  pickup: { fr: 'POUR EMPORTER', en: 'PICKUP' },
  delivery: { fr: 'LIVRAISON', en: 'DELIVERY' },
  dine_in: { fr: 'SUR PLACE', en: 'DINE IN' },
  readyAt: { fr: 'PRÊTE À', en: 'READY AT' },
  scheduled: { fr: 'PRÉVUE POUR', en: 'SCHEDULED FOR' },
  customer: { fr: 'Client', en: 'Customer' },
  note: { fr: 'NOTE', en: 'NOTE' },
  total: { fr: 'TOTAL', en: 'TOTAL' },
  items: { fr: 'Articles', en: 'Items' },
  paid: { fr: 'PAYÉE', en: 'PAID' },
  toPay: { fr: 'À PAYER AU COMPTOIR', en: 'PAY AT THE COUNTER' },
  unpaid: { fr: 'NON PAYÉE', en: 'NOT PAID' },
  cancelled: { fr: 'ANNULÉE', en: 'CANCELLED' },
  doNotCook: { fr: 'NE PAS PRÉPARER', en: 'DO NOT COOK' },
  cancelledAt: { fr: 'Annulée à', en: 'Cancelled at' },
  reason: { fr: 'Raison', en: 'Reason' },
} as const;

const tr = (k: keyof typeof T, lang: TicketLang) => T[k][lang];

// ------------------------------------------------------------------ characters

const REPLACE: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...', '•': '*', '×': 'x', ' ': ' ', ' ': ' ', ' ': ' ', '\t': ' ',
  'œ': 'oe', 'Œ': 'OE', 'Ÿ': 'Y', '™': 'TM',
};

/** Text the printer can print: Latin-1 + €, one line, no control characters. */
export function printable(input: unknown): string {
  const s = String(input ?? '').normalize('NFC');
  let out = '';
  for (const ch of s) {
    const rep = REPLACE[ch];
    if (rep !== undefined) { out += rep; continue; }
    const code = ch.codePointAt(0)!;
    if (code === 0x0a || code === 0x0d) { out += ' '; continue; }
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue;
    if (code <= 0xff || ch === '€') { out += ch; continue; }
    if (code > 0xffff) continue; // emoji and other astral symbols: dropped
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    out += /^[\x20-\x7e]+$/.test(base) ? base : '?';
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

/** Splits text into lines of at most `width` characters (words kept whole when they fit); next lines are indented. */
export function wrap(text: string, width: number, indent = 0): string[] {
  const pad = ' '.repeat(indent);
  const out: string[] = [];
  const room = () => Math.max(1, out.length ? width - indent : width);
  let cur = '';
  for (const word of text.split(' ').filter(Boolean)) {
    let w = word;
    if (cur && cur.length + 1 + w.length <= room()) { cur += ` ${w}`; continue; }
    if (cur) { out.push(cur); cur = ''; }
    for (let r = room(); w.length > r; r = room()) { // a word longer than the line: hard break
      out.push(w.slice(0, r));
      w = w.slice(r);
    }
    cur = w;
  }
  if (cur) out.push(cur);
  return out.map((l, i) => (i === 0 ? l : pad + l));
}

/** Content line: never starts with "@@" (that would style the paper). */
const plain = (line: string) => (line.startsWith('@@') ? ` ${line}` : line);
const styled = (flags: string, line: string) => `@@${flags} ${line}`;

/** Left text and right text on one line, or left (wrapped) then right aligned below when both do not fit. */
function row(left: string, right: string, width: number): string[] {
  if (left.length + 1 + right.length <= width) return [left + ' '.repeat(width - left.length - right.length) + right];
  const lines = wrap(left, width);
  return [...lines, ' '.repeat(Math.max(0, width - right.length)) + right];
}

/** "14:05" in the kitchen's time zone (24 h, the same in French and English). '' for a missing or bad date. */
export function clock(iso: string | null | undefined, timeZone = 'America/Toronto'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

/** "23,45 $" (fr) / "$23.45" (en). */
export function moneyText(amount: number, lang: TicketLang): string {
  const v = Math.round((Number(amount) || 0) * 100) / 100;
  const neg = v < 0 ? '-' : '';
  const abs = Math.abs(v).toFixed(2);
  return lang === 'fr' ? `${neg}${abs.replace('.', ',')} $` : `${neg}$${abs}`;
}

const qty = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 1);

// ------------------------------------------------------------------ layout

/** The kitchen ticket as printed text (see the format at the top of this file). */
export function renderKitchenTicket(t: KitchenTicket, opts: TicketOptions): string {
  const W = opts.width;
  const big = Math.floor(W / 2);
  const tz = opts.timeZone || 'America/Toronto';
  const L = opts.lang;
  const out: string[] = [];
  const rule = (c = '-') => out.push(c.repeat(W));
  const center = (text: string, flags = 'C') => { for (const l of wrap(printable(text), flags.includes('H') ? big : W)) out.push(styled(flags, l)); };

  center(t.platform, 'BC');
  if (t.platformDetail) center(t.platformDetail);
  center(t.number || '?', 'HBC');
  if (t.brandName) center(t.brandName);
  rule('=');

  const kind = tr(t.fulfillment === 'pickup' ? 'pickup' : t.fulfillment === 'dine_in' ? 'dine_in' : 'delivery', L);
  for (const l of row(kind, clock(t.placedAt, tz), W)) out.push(styled('B', l));
  if (t.scheduledFor) for (const l of row(tr('scheduled', L), clock(t.scheduledFor, tz), W)) out.push(styled('B', l));
  if (t.readyAt) out.push(...row(tr('readyAt', L), clock(t.readyAt, tz), W).map(plain));
  const first = printable(t.customerFirstName);
  if (first) out.push(...wrap(`${tr('customer', L)} : ${first}`, W).map(plain));
  if (t.payment === 'paid') out.push(plain(tr('paid', L)));
  else if (t.payment === 'pay_at_pickup') out.push(styled('B', tr('toPay', L)));
  else if (t.payment === 'unpaid') out.push(styled('B', tr('unpaid', L)));
  rule();

  let count = 0;
  for (const line of t.lines) {
    const q = qty(line.quantity);
    count += q;
    for (const l of wrap(`${q} x ${printable(line.name)}`, W, 4)) out.push(styled('B', l));
    for (const m of line.modifiers ?? []) {
      const mq = qty(m.quantity);
      out.push(...wrap(`+ ${mq > 1 ? `${mq} x ` : ''}${printable(m.name)}`, W - 2, 2).map((l) => plain(`  ${l}`)));
    }
    const note = printable(line.notes);
    if (note) out.push(...wrap(`» ${note}`, W - 2, 2).map((l) => plain(`  ${l}`)));
  }
  if (!t.lines.length) out.push(plain('-'));
  rule();

  const notes = printable(t.notes);
  if (notes) {
    out.push(styled('B', `${tr('note', L)} :`));
    out.push(...wrap(notes, W).map(plain));
    rule();
  }

  out.push(plain(`${tr('items', L)} : ${count}`));
  if (t.total !== null && t.total !== undefined) for (const l of row(tr('total', L), moneyText(t.total, L), W)) out.push(styled('B', l));
  const footer = printable(t.footer);
  if (footer) { rule(); center(footer); }
  return out.join('\n');
}

/** Short ticket for an order that was printed here and then cancelled: stop cooking it. */
export function renderCancelTicket(t: CancelTicket, opts: TicketOptions): string {
  const W = opts.width;
  const big = Math.floor(W / 2);
  const tz = opts.timeZone || 'America/Toronto';
  const L = opts.lang;
  const out: string[] = [];
  const center = (text: string, flags = 'C') => { for (const l of wrap(printable(text), flags.includes('H') ? big : W)) out.push(styled(flags, l)); };
  center(`*** ${tr('cancelled', L)} ***`, 'BC');
  center(tr('cancelled', L), 'HBC');
  center(t.number || '?', 'HBC');
  center([t.platform, t.brandName].filter(Boolean).join(' - '));
  out.push('='.repeat(W));
  center(tr('doNotCook', L), 'BC');
  const at = clock(t.cancelledAt, tz);
  if (at) out.push(plain(`${tr('cancelledAt', L)} ${at}`));
  const why = printable(t.reason);
  if (why) out.push(...wrap(`${tr('reason', L)} : ${why}`, W).map(plain));
  out.push('='.repeat(W));
  return out.join('\n');
}

/** Lines as the paper shows them (markup removed): what tests and previews read. */
export function stripMarkup(ticket: string): string[] {
  return ticket.split('\n').map((l) => (l.startsWith('@@') ? l.replace(/^@@[A-Z]* /, '') : l));
}

// ------------------------------------------------------------------ orders → tickets

const PLATFORM: Record<string, string> = { uber_eats: 'UBER EATS', doordash: 'DOORDASH', skip: 'SKIPTHEDISHES', tgtg: 'TOO GOOD TO GO' };
const DIRECT: Record<string, { fr: string; en: string }> = {
  phone: { fr: 'TÉLÉPHONE', en: 'PHONE' },
  phone_ai: { fr: 'TÉLÉPHONE (IA)', en: 'PHONE (AI)' },
  website: { fr: 'SITE WEB', en: 'WEBSITE' },
  manual: { fr: 'COMMANDE', en: 'ORDER' },
  clover: { fr: 'CLOVER', en: 'CLOVER' },
  clover_online: { fr: 'SITE WEB (CLOVER)', en: 'WEBSITE (CLOVER)' },
};

/** Same rule as components/live/mev-ticket.tsx mevHandles(): Takatak MEV issues this order's invoice. */
export function mevIssuesInvoice(mev?: MevRecord | null): boolean {
  return !!mev && mev.status !== 'skipped' && mev.status !== 'shadow';
}

const firstName = (name?: string | null) => printable(name).split(' ')[0] || null;

export function platformNumber(o: Pick<StoredOrder, 'displayId' | 'externalOrderId'>): string {
  return `#${o.displayId || String(o.externalOrderId ?? '').slice(0, 8)}`;
}

export function directLabel(source: string, lang: TicketLang): string {
  return DIRECT[source]?.[lang] ?? DIRECT.manual[lang];
}

export function platformLabel(channel: string): string {
  return PLATFORM[channel] ?? String(channel).toUpperCase();
}

export function ticketFromStoredOrder(o: StoredOrder): KitchenTicket {
  const detail = orderSourceLabel(o.orderSource);
  const raw = o.raw as { source?: string; tgtg?: { code?: string } } | null;
  const tgtgCode = raw?.source === 'tgtg_email' ? raw.tgtg?.code : null;
  return {
    platform: platformLabel(o.channel),
    platformDetail: detail && detail.toUpperCase() !== platformLabel(o.channel) ? detail.toUpperCase() : null,
    number: platformNumber(o),
    brandName: o.brandName ?? null,
    customerFirstName: firstName(o.customerName),
    fulfillment: o.fulfillment,
    placedAt: o.placedAt || o.createdAt,
    readyAt: o.timeline?.readyTarget ?? null,
    // A scheduled platform order prints at its fire time (lib/foodhub/scheduling.ts); its ready-by target says when.
    scheduledFor: null,
    lines: (o.lines ?? []).map((l) => ({ quantity: l.quantity, name: l.name, notes: l.notes, modifiers: (l.modifiers ?? []).map((m) => ({ quantity: m.quantity, name: m.name })) })),
    notes: o.notes ?? null,
    total: mevIssuesInvoice(o.timeline?.mev) ? null : o.total,
    footer: [tgtgCode ? `TGTG ${tgtgCode}` : null, o.posOrderId ? `Clover ${o.posOrderId}` : null].filter(Boolean).join(' - ') || null,
  };
}

export function ticketFromDirectOrder(o: DirectOrder, lang: TicketLang): KitchenTicket {
  return {
    platform: directLabel(o.source, lang),
    number: o.number,
    brandName: o.brandName,
    customerFirstName: firstName(o.customer?.name),
    fulfillment: o.fulfillment,
    placedAt: o.placedAt || o.createdAt,
    readyAt: o.readyAt ?? null,
    scheduledFor: o.wantedAt ?? null,
    payment: o.payment ?? null,
    lines: (o.lines ?? []).map((l) => ({ quantity: l.quantity, name: l.name, notes: l.notes, modifiers: (l.modifiers ?? []).map((m) => ({ quantity: m.quantity, name: m.name })) })),
    notes: o.notes ?? null,
    total: mevIssuesInvoice(o.mev) ? null : o.total,
    footer: o.posOrderId ? `Clover ${o.posOrderId}` : null,
  };
}
