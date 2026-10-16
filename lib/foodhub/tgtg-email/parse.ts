// Too Good To Go order e-mails → structured reservation. Pure (no I/O), French and English.
//
// TGTG sends the store account one e-mail per reservation ("order confirmation") and one per cancellation. It publishes
// no format, so this reader is built from separate, tolerant patterns, each tried in order:
//   1. labelled lines   "Order number: 3K7Q9XPT"  "Numéro de commande : 3K7Q9XPT"  (also a table cell, or the value on
//                       the next line);
//   2. sentences        "Marie just reserved 2 Surprise Bags"  "Marie vient de réserver 1 Panier Surprise";
//   3. the subject      "New order #3K7Q9XPT – OOEUF NDG".
// Nothing is guessed when it matters: no reservation code or no store name → `problems` is filled and the e-mail goes to
// the attention list in Food Hub (never silently dropped). Optional facts that are missing (price, end of the pickup
// window) become `warnings` shown on the order.
import { foodhubTimeZone, localParts, localWallToUtcMs } from '../time';

export interface TgtgMail {
  from: string;
  /** Other sender headers (Sender, Reply-To) — a forwarding service may keep the original there. */
  senders?: string[];
  to?: string;
  subject: string;
  text?: string;
  html?: string;
  messageId?: string;
  /** ISO date of the e-mail (Date header). */
  date?: string;
}

export type TgtgMailKind = 'order' | 'cancel' | 'unknown';

export interface TgtgMailParse {
  kind: TgtgMailKind;
  lang: 'fr' | 'en';
  /** TGTG order / reservation code, upper case. */
  code?: string;
  firstName?: string;
  quantity?: number;
  bagName?: string;
  /** What the customer paid for the whole reservation (taxes included), in dollars. */
  pricePaid?: number;
  pickupStart?: string;
  pickupEnd?: string;
  /** "jeu. 16 oct. 17:00–17:30" (local), for the ticket and the screens. */
  pickupLabel?: string;
  storeName?: string;
  storeAddress?: string;
  /** Why the e-mail cannot become an order / a cancellation (attention list). */
  problems: string[];
  warnings: string[];
}

// ---------------------------------------------------------------- text

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', iuml: 'ï', euml: 'ë', Eacute: 'É', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…', times: '×', middot: '·', laquo: '«', raquo: '»' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML e-mail → plain lines: block tags become line breaks, table cells a tab (label ⇥ value). */
export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|header|footer|blockquote)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \u00a0]+/g, ' ')
    .replace(/ *\t[ \t]*/g, '\t')
    .replace(/\n\s*\n+/g, '\n');
}

/**
 * The readable text of a mail: the HTML part flattened (its table rows keep "label ⇥ value"), then the plain part.
 * Both are read because either can be the better one; the first labelled value found wins.
 */
export function mailText(mail: Pick<TgtgMail, 'text' | 'html'>): string {
  const plain = decodeEntities((mail.text ?? '').replace(/\r/g, ''));
  const html = mail.html ? htmlToText(mail.html) : '';
  return [html, plain].filter((x) => x.trim()).join('\n');
}

const linesOf = (text: string) => text.split('\n').map((l) => l.replace(/^[\s>*•·\-]+/, '').replace(/\s+$/, '')).filter((l) => l.trim());

// ---------------------------------------------------------------- labels

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');

const LABELS = {
  code: ['order id', 'order number', 'order no.', 'order no', 'order #', 'order reference', 'order ref', 'order code', 'reservation id', 'reservation code', 'reservation number', 'reservation reference', 'booking id', 'booking reference', 'booking code', 'pickup code', 'confirmation code', 'confirmation number',
    'numéro de commande', 'n° de commande', 'no de commande', 'no. de commande', 'numéro de réservation', 'n° de réservation', 'référence de commande', 'référence de réservation', 'référence', 'code de commande', 'code de réservation', 'id de commande', 'commande n°', 'commande no', 'commande #', 'code'],
  customer: ['customer name', 'customer', 'reserved by', 'ordered by', 'first name', 'name', 'nom du client', 'prénom du client', 'client', 'réservé par', 'commandé par', 'prénom', 'nom'],
  quantity: ['quantity', 'qty', 'number of bags', 'number of surprise bags', 'bags', 'quantité', 'nombre de paniers', 'nombre de paniers surprises', 'nombre', 'paniers'],
  item: ['surprise bag', 'bag type', 'bag', 'item', 'product', 'offer', 'panier surprise', 'type de panier', 'panier', 'article', 'produit', 'offre'],
  price: ['total paid', 'amount paid', 'price paid', 'paid', 'total', 'price', 'amount', 'total payé', 'montant payé', 'prix payé', 'montant', 'prix', 'payé'],
  pickup: ['pickup window', 'pickup time', 'pick-up window', 'pick-up time', 'pick up time', 'pickup slot', 'collection window', 'collection time', 'pickup', 'pick-up', 'pick up', 'collection', 'collect between', 'collect',
    'heure de collecte', 'créneau de collecte', 'fenêtre de collecte', 'heure de ramassage', 'heure de retrait', 'heure de cueillette', 'créneau', 'collecte', 'ramassage', 'retrait', 'cueillette', 'à récupérer', 'à collecter'],
  pickupDate: ['pickup date', 'pick-up date', 'collection date', 'date', 'date de collecte', 'date de retrait', 'date de ramassage', 'jour'],
  store: ['store name', 'store', 'shop', 'location', 'business', 'outlet', 'nom du magasin', 'magasin', 'commerce', 'boutique', 'établissement', 'point de vente', 'succursale'],
  address: ['store address', 'address', 'adresse du magasin', 'adresse'],
} as const;

type LabelKey = keyof typeof LABELS;

/** Longest labels first, so "order number" wins over "order" and "nom du client" over "nom". */
const LABEL_RE: Record<LabelKey, { same: RegExp; alone: RegExp }> = Object.fromEntries(
  (Object.keys(LABELS) as LabelKey[]).map((k) => {
    const alt = [...LABELS[k]].sort((a, b) => b.length - a.length).map(esc).join('|');
    return [k, {
      // "Label: value", "Label – value", "Label ⇥ value" (a table row), "Label    value"
      same: new RegExp(`^\\s*(?:${alt})\\s*(?:\\(s\\))?\\s*(?:[:：]|\\t|\\s[–—-]\\s|\\s{2,})\\s*(.+)$`, 'i'),
      // "Label" or "Label:" alone on its line: the value is on the next line
      alone: new RegExp(`^\\s*(?:${alt})\\s*(?:\\(s\\))?\\s*[:：]?\\s*$`, 'i'),
    }];
  }),
) as Record<LabelKey, { same: RegExp; alone: RegExp }>;

/** Every value given for a label, in order of appearance. */
export function labelled(lines: string[], key: LabelKey): string[] {
  const out: string[] = [];
  const re = LABEL_RE[key];
  for (let i = 0; i < lines.length; i += 1) {
    const m = re.same.exec(lines[i]);
    if (m) { out.push(m[1].split('\t').map((x) => x.trim()).filter(Boolean)[0] ?? m[1].trim()); continue; }
    if (re.alone.test(lines[i]) && lines[i + 1] && !isAnyLabelLine(lines[i + 1])) out.push(lines[i + 1].trim());
  }
  return out.filter(Boolean);
}

function isAnyLabelLine(line: string): boolean {
  return (Object.keys(LABEL_RE) as LabelKey[]).some((k) => LABEL_RE[k].alone.test(line));
}

// ---------------------------------------------------------------- kind and language

const CANCEL_RE = /\b(cancell?ed|cancell?ation|cancel|annul(?:é|ée|ées|és|ation|er|e)|a\s+annulé)(?![\p{L}\d])/iu;
const ORDER_RE = /\b(new\s+order|new\s+reservation|order\s+confirm\w*|reservation\s+confirm\w*|(?:has\s+|just\s+)?reserved|booked|nouvelle\s+commande|nouvelle\s+réservation|confirmation\s+de\s+(?:commande|réservation)|a\s+réservé|vient\s+de\s+réserver|réservation\s+confirmée|commande\s+confirmée)(?![\p{L}\d])/iu;
const BAG_RE = /surprise\s*bag|magic\s*bag|panier|sac\s+surprise|\bbag(s)?\b/i;
/** Words of a reservation e-mail (a TGTG mail with none of them — newsletter, payout — is not an order e-mail). */
const ORDERISH_RE = /surprise\s*bag|magic\s*bag|panier|sac\s+surprise|\border\b|commande|r[ée]serv/i;

export function mailKind(subject: string, text: string): TgtgMailKind {
  if (CANCEL_RE.test(subject)) return 'cancel';
  if (ORDER_RE.test(subject)) return 'order';
  // Subject says neither: read the opening of the e-mail only (footers often say "you can cancel…").
  const head = text.slice(0, 600);
  if (CANCEL_RE.test(head) && !ORDER_RE.test(head.split(CANCEL_RE)[0] ?? '')) return 'cancel';
  if (ORDER_RE.test(head)) return 'order';
  return 'unknown';
}

export function mailLang(subject: string, text: string): 'fr' | 'en' {
  const s = `${subject}\n${text.slice(0, 1500)}`.toLowerCase();
  const fr = (s.match(/\b(bonjour|commande|panier|réserv\w*|collecte|client|merci|annul\w*|vient|à|le|la|les|des|votre)\b/g) ?? []).length;
  const en = (s.match(/\b(hello|hi|order|bag|reserved|pickup|customer|thanks|cancel\w*|just|the|your|has)\b/g) ?? []).length;
  return fr > en ? 'fr' : 'en';
}

// ---------------------------------------------------------------- values

/** "3K7Q9XPT", "#AB-12345" → the code; prefers a token with a digit. */
export function codeFrom(value: string): string | undefined {
  const tokens = value.replace(/^#/, '').match(/#?[A-Z0-9][A-Z0-9-]{3,39}/gi) ?? [];
  const clean = tokens.map((t) => t.replace(/^#/, '').replace(/-+$/, '').toUpperCase()).filter((t) => t.length >= 4);
  return clean.find((t) => /\d/.test(t)) ?? clean.find((t) => /^[A-Z]{6,}$/.test(t) && !/^(ORDER|COMMANDE|NUMBER|NUMERO)$/.test(t));
}

/** "$11.98", "11,98 $", "CA$ 5.99", "5.99 CAD" → 11.98. */
export function moneyFrom(value: string): number | undefined {
  const m = /(?:CA?\$|\$|CAD)\s*(\d{1,4}(?:[.,]\d{2})?)|(\d{1,4}(?:[.,]\d{2}))\s*(?:\$|CAD|CA\$|dollars?)/i.exec(value)
    ?? /^\s*(\d{1,4}[.,]\d{2})\s*$/.exec(value);
  if (!m) return undefined;
  const n = Number.parseFloat((m[1] ?? m[2]).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

function quantityFrom(value: string): number | undefined {
  const m = /(\d{1,2})/.exec(value);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 50 ? n : undefined;
}

const NOT_A_NAME = /^(someone|somebody|a|an|the|customer|client|un|une|le|la|quelqu|your|votre|you|vous|we|nous|order|commande|great|bonne|good|hi|hello|bonjour)$/i;

function nameFrom(value: string): string | undefined {
  const v = value.replace(/["“”]/g, '').trim();
  const first = v.split(/\s+/)[0]?.replace(/[,.;:!]+$/, '');
  if (!first || first.length > 30 || !/^[\p{L}][\p{L}'’-]*$/u.test(first) || NOT_A_NAME.test(first)) return undefined;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// ---------------------------------------------------------------- pickup window

const MONTHS: Array<[RegExp, number]> = [
  [/^jan(?:uary|vier|v)?\.?$/i, 1], [/^f[eé]v(?:rier)?\.?$|^feb(?:ruary)?\.?$/i, 2], [/^mar(?:ch|s)?\.?$/i, 3], [/^apr(?:il)?\.?$|^avr(?:il)?\.?$/i, 4],
  [/^ma[iy]$/i, 5], [/^jui?n$|^june?$/i, 6], [/^juil(?:let)?\.?$|^jul(?:y)?\.?$/i, 7], [/^ao[uû]t?$|^aug(?:ust)?\.?$/i, 8],
  [/^sep(?:t|tembre|tember)?\.?$/i, 9], [/^oct(?:obre|ober)?\.?$/i, 10], [/^nov(?:embre|ember)?\.?$/i, 11], [/^d[eé]c(?:embre|ember)?\.?$/i, 12],
];
const MONTH_WORD = '(jan(?:uary|vier|v)?|f[eé]v(?:rier)?|feb(?:ruary)?|mar(?:ch|s)?|apr(?:il)?|avr(?:il)?|ma[iy]|jui?n|june?|juil(?:let)?|jul(?:y)?|ao[uû]t?|aug(?:ust)?|sep(?:t|tembre|tember)?|oct(?:obre|ober)?|nov(?:embre|ember)?|d[eé]c(?:embre|ember)?)\\.?';
const WEEKDAYS: Array<[RegExp, number]> = [
  [/\b(sunday|sun|dimanche|dim)\b/i, 0], [/\b(monday|mon|lundi|lun)\b/i, 1], [/\b(tuesday|tue|tues|mardi|mar)\b/i, 2], [/\b(wednesday|wed|mercredi|mer)\b/i, 3],
  [/\b(thursday|thu|thurs|jeudi|jeu)\b/i, 4], [/\b(friday|fri|vendredi|ven)\b/i, 5], [/\b(saturday|sat|samedi|sam)\b/i, 6],
];

const monthNum = (w: string) => MONTHS.find(([re]) => re.test(w.replace(/\.$/, '')))?.[1];

interface Ymd { y: number; m: number; d: number }

function addDays(day: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** The local date a pickup text names, relative to the e-mail date. null = no date in the text. */
export function dateFrom(value: string, ref: Ymd): Ymd | null {
  const v = value.toLowerCase();
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  const withYear = (d: number, mo: number, y?: string): Ymd => {
    if (y) return { y: +y, m: mo, d };
    // No year: the one that puts the date closest to the e-mail (December e-mail for a January pickup → next year).
    const cands = [ref.y - 1, ref.y, ref.y + 1].map((yy) => ({ y: yy, m: mo, d }));
    const refMs = Date.UTC(ref.y, ref.m - 1, ref.d);
    return cands.sort((a, b) => Math.abs(Date.UTC(a.y, a.m - 1, a.d) - refMs) - Math.abs(Date.UTC(b.y, b.m - 1, b.d) - refMs))[0];
  };
  m = new RegExp(`\\b(\\d{1,2})(?:er|st|nd|rd|th)?\\s+${MONTH_WORD}(?:\\s+(\\d{4}))?`, 'i').exec(v);
  if (m && monthNum(m[2])) return withYear(+m[1], monthNum(m[2])!, m[3]);
  m = new RegExp(`\\b${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?(?:\\s+(\\d{4}))?`, 'i').exec(v);
  if (m && monthNum(m[1])) return withYear(+m[2], monthNum(m[1])!, m[3]);
  m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(v);
  if (m) {
    // Day first (Canada / Europe), unless that is impossible.
    let d = +m[1]; let mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return withYear(d, mo, m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : undefined);
  }
  if (/\b(today|aujourd['’]hui|ce soir|tonight|this evening)\b/i.test(v)) return ref;
  if (/\b(tomorrow|demain)\b/i.test(v)) return addDays(ref, 1);
  const wd = WEEKDAYS.find(([re]) => re.test(v));
  if (wd) {
    const refWd = new Date(Date.UTC(ref.y, ref.m - 1, ref.d)).getUTCDay();
    return addDays(ref, (wd[1] - refWd + 7) % 7);
  }
  return null;
}

/** Every clock time in a text, in minutes after midnight: "17:00", "17 h 30", "17h", "5:30 PM", "5 pm". */
export function timesFrom(value: string): number[] {
  const out: Array<{ at: number; h: number; min: number; ampm?: string }> = [];
  const re = /\b(\d{1,2})\s*(?:(?::|h(?![a-zà-ÿ]))\s*(\d{2})?)\s*(a\.?m\.?|p\.?m\.?)?|\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/gi;
  const clean = value.replace(/\d{4}-\d{2}-\d{2}T?/g, ' ');
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const h = Number(m[1] ?? m[4]);
    const min = Number(m[2] ?? 0);
    const ampm = (m[3] ?? m[5])?.toLowerCase().replace(/\./g, '');
    if (h > 23 || min > 59) continue;
    out.push({ at: m.index, h, min, ampm });
  }
  // "5:00 - 5:30 PM": a meridiem written once applies to the time before it too.
  for (let i = out.length - 2; i >= 0; i -= 1) if (!out[i].ampm && out[i + 1].ampm && out[i].h <= 12) out[i].ampm = out[i + 1].ampm;
  return out.map((t) => {
    let h = t.h;
    if (t.ampm === 'pm' && h < 12) h += 12;
    if (t.ampm === 'am' && h === 12) h = 0;
    return h * 60 + t.min;
  });
}

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/** Pickup window → UTC ISO start / end (local time zone), plus a short local label. */
export function pickupWindow(pickupText: string, dateText: string, refMs: number, lang: 'fr' | 'en', tz = foodhubTimeZone()): { start?: string; end?: string; label?: string; warnings: string[] } {
  const warnings: string[] = [];
  const p = localParts(refMs, tz);
  const ref: Ymd = { y: p.year, m: p.month, d: p.day };
  const times = timesFrom(pickupText);
  if (!times.length) return { warnings: ['pickup window not found'] };
  let day = dateFrom(pickupText, ref) ?? (dateText ? dateFrom(dateText, ref) : null);
  if (!day) { day = ref; warnings.push('pickup date not written — the e-mail day is used'); }
  const [startMin, endMinRaw] = times;
  const start = localWallToUtcMs(day.y, day.m, day.d, Math.floor(startMin / 60), startMin % 60, tz);
  let end: number | undefined;
  if (endMinRaw !== undefined) {
    const endDay = endMinRaw <= startMin ? addDays(day, 1) : day;
    end = localWallToUtcMs(endDay.y, endDay.m, endDay.d, Math.floor(endMinRaw / 60), endMinRaw % 60, tz);
  } else warnings.push('end of the pickup window not found');
  const dayLabel = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(start));
  return { start: new Date(start).toISOString(), end: end !== undefined ? new Date(end).toISOString() : undefined, label: `${dayLabel} ${hm(startMin)}${endMinRaw !== undefined ? `–${hm(endMinRaw)}` : ''}`, warnings };
}

// ---------------------------------------------------------------- the e-mail

const SENTENCE_RESERVED_EN = /\b([\p{Lu}][\p{L}'’-]+)(?:\s+[\p{Lu}]\.?)?\s+(?:has\s+)?(?:just\s+)?(?:reserved|ordered|bought|booked|purchased)\s+(\d{1,2}|an?|one)?\s*([^.\n]*)/u;
const SENTENCE_RESERVED_FR = /\b([\p{Lu}][\p{L}'’-]+)(?:\s+[\p{Lu}]\.?)?\s+(?:vient\s+de|a)\s+(?:réserver|réservé|commander|commandé|acheter|acheté)\s+(\d{1,2}|un|une)?\s*([^.\n]*)/u;
const SENTENCE_CANCEL = /\b([\p{Lu}][\p{L}'’-]+)(?:\s+[\p{Lu}]\.?)?\s+(?:has\s+)?(?:cancell?ed|a\s+annulé|vient\s+d['’]annuler)(?![\p{L}])/u;
const QTY_BAGS = /\b(\d{1,2})\s*(?:[x×]\s*)?(?:surprise\s+bags?|magic\s+bags?|bags?|paniers?(?:\s+surprises?)?|sacs?(?:\s+surprises?)?)\b/i;
const QTY_TIMES = /\b(\d{1,2})\s*[x×]\s+\S/i;
const CODE_IN_TEXT = /\b(?:order|reservation|booking|commande|réservation)\s*(?:#|n°|no\.?|number|numéro|id|code|ref(?:erence)?|référence)?\s*[:#]?\s*#?([A-Z0-9][A-Z0-9-]{4,39})\b/i;
const HASH_CODE = /#\s?([A-Z0-9][A-Z0-9-]{3,39})\b/;
const GREETING = /^(?:hi|hello|hey|dear|bonjour|salut|allô)\s+([^,!\n]{2,60})[,!]/im;

function cleanStore(s: string | undefined): string | undefined {
  const v = (s ?? '').replace(/["“”«»]/g, '').replace(/\s+/g, ' ').replace(/[.,;:!]+$/, '').trim();
  if (!v || v.length > 80 || /^(team|équipe|there|vous|you|partner|partenaire)$/i.test(v)) return undefined;
  return v;
}

/** One TGTG e-mail → what it says. Pure. */
export function parseTgtgMail(mail: TgtgMail, opts: { tz?: string; now?: number } = {}): TgtgMailParse {
  const subject = decodeEntities(String(mail.subject ?? '')).replace(/\s+/g, ' ').trim();
  const text = mailText(mail);
  const lines = linesOf(text);
  const kind = mailKind(subject, text);
  const lang = mailLang(subject, text);
  const problems: string[] = [];
  const warnings: string[] = [];
  const refMs = Number.isFinite(Date.parse(mail.date ?? '')) ? Date.parse(mail.date!) : (opts.now ?? Date.now());

  // Reservation code: labelled line, then "order #…" in the subject / text, then a lone "#CODE".
  const code = labelled(lines, 'code').map(codeFrom).find(Boolean)
    ?? codeFrom(CODE_IN_TEXT.exec(subject)?.[1] ?? '') ?? codeFrom(CODE_IN_TEXT.exec(text)?.[1] ?? '')
    ?? codeFrom(HASH_CODE.exec(subject)?.[1] ?? '') ?? codeFrom(HASH_CODE.exec(text)?.[1] ?? '');

  const sentence = SENTENCE_RESERVED_FR.exec(text) ?? SENTENCE_RESERVED_EN.exec(text);
  const cancelSentence = SENTENCE_CANCEL.exec(text);
  const firstName = labelled(lines, 'customer').map(nameFrom).find(Boolean)
    ?? nameFrom(sentence?.[1] ?? '') ?? nameFrom(cancelSentence?.[1] ?? '');

  let quantity = labelled(lines, 'quantity').map(quantityFrom).find(Boolean);
  if (quantity === undefined && sentence?.[2]) quantity = /^\d+$/.test(sentence[2]) ? Number(sentence[2]) : 1;
  quantity ??= quantityFrom(QTY_BAGS.exec(subject)?.[1] ?? '') ?? quantityFrom(QTY_BAGS.exec(text)?.[1] ?? '') ?? quantityFrom(QTY_TIMES.exec(text)?.[1] ?? '');

  const itemLine = labelled(lines, 'item').find((v) => !/^\d+([.,]\d+)?\s*\$?$/.test(v));
  let bagName = itemLine?.replace(/^\d{1,2}\s*[x×]\s*/i, '').replace(/\s*[x×]\s*\d{1,2}$/i, '').trim();
  if (!bagName && sentence?.[3]) {
    const s = sentence[3].replace(/^[x×]\s*/i, '').replace(/\s+(?:at|chez|from|de|à|au|for|pour)\s+.*$/i, '').trim();
    if (BAG_RE.test(s)) bagName = s;
  }
  if (bagName && bagName.length > 80) bagName = bagName.slice(0, 80);

  let pricePaid = labelled(lines, 'price').map(moneyFrom).find((n) => n !== undefined);
  if (pricePaid === undefined) {
    const m = /(?:paid|payé|pay[ée]e?s?|for a total of|pour un total de)\s*:?\s*([^\n]{0,30})/i.exec(text);
    if (m) pricePaid = moneyFrom(m[1]);
  }

  const pickupText = labelled(lines, 'pickup').join(' ')
    || (/(?:between|entre|from|de)\s+\d{1,2}\s*[:h]\s*\d{0,2}[^\n]{0,60}/i.exec(text)?.[0] ?? '');
  const dateText = labelled(lines, 'pickupDate').join(' ');
  const win = pickupText ? pickupWindow(`${pickupText}`, dateText, refMs, lang, opts.tz) : { warnings: ['pickup window not found'] as string[] };
  warnings.push(...win.warnings);

  const storeName = cleanStore(labelled(lines, 'store')[0])
    ?? cleanStore(/\b(?:at|chez|from|de\s+chez)\s+([A-Z][^\n.,!]{1,60})/.exec(sentence?.[0] ?? '')?.[1])
    ?? cleanStore(subject.split(/\s+[–—|-]\s+/).slice(1).reverse().find((part) => !ORDER_RE.test(part) && !CANCEL_RE.test(part) && !/#|\d+\s*[x×]/.test(part)))
    ?? cleanStore(GREETING.exec(text)?.[1]);
  const storeAddress = labelled(lines, 'address')[0]?.slice(0, 120);

  if (kind === 'unknown') problems.push(ORDERISH_RE.test(`${subject} ${text.slice(0, 2000)}`) ? 'not recognised as a new reservation or a cancellation' : 'not an order e-mail');
  if (!code) problems.push('reservation code not found');
  if (kind === 'order') {
    if (!storeName) problems.push('store name not found');
    if (quantity === undefined) { quantity = 1; warnings.push('number of bags not written — 1 assumed'); }
    if (pricePaid === undefined) warnings.push('price paid not found');
  }

  return {
    kind, lang, code, firstName, quantity, bagName: bagName || (lang === 'fr' ? 'Panier Surprise' : 'Surprise Bag'), pricePaid,
    pickupStart: 'start' in win ? win.start : undefined, pickupEnd: 'end' in win ? win.end : undefined, pickupLabel: 'label' in win ? win.label : undefined,
    storeName, storeAddress, problems, warnings,
  };
}

// ---------------------------------------------------------------- sender

/** TGTG_EMAIL_FROM_ALLOW: domains or full addresses, comma separated. Default: Too Good To Go's own domains. */
export function allowedSenders(): string[] {
  const raw = process.env.TGTG_EMAIL_FROM_ALLOW?.trim();
  const list = (raw ? raw : 'toogoodtogo.com,toogoodtogo.ca,toogoodtogo.fr,toogoodtogo.org,tgtg.com').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return list;
}

export function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from) ?? /([^\s<>"']+@[^\s<>"']+)/.exec(from);
  return (m?.[1] ?? from).trim().toLowerCase();
}

/** Is this e-mail from Too Good To Go (or an address the owner allowed)? Checks From, then Sender / Reply-To. */
export function senderAllowed(mail: Pick<TgtgMail, 'from' | 'senders'>, allow = allowedSenders()): boolean {
  return [mail.from, ...(mail.senders ?? [])].filter(Boolean).map(addressOf).some((addr) => allow.some((a) => (a.includes('@') ? addr === a : addr.endsWith(`@${a}`) || addr.endsWith(`.${a}`))));
}
