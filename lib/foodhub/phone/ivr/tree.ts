// ON2GO phone menu — the menu tree, its types, defaults and checks. No server imports: the settings page uses it too.
// Settings storage lives in config.ts (which re-exports everything here).
import type { PhoneLang } from '../calls';

export type IvrLang = PhoneLang;
export const IVR_LANGS: IvrLang[] = ['fr', 'en', 'es'];
export type Texts = Record<IvrLang, string>;

export type PlatformId = 'ubereats' | 'doordash' | 'skip';
export const PLATFORM_IDS: PlatformId[] = ['ubereats', 'doordash', 'skip'];
export const PLATFORM_NAME: Record<PlatformId, string> = { ubereats: 'Uber Eats', doordash: 'DoorDash', skip: 'SkipTheDishes' };

/** Conversations the AI handles itself: it explains, looks up our own orders, texts a link, opens a ticket, then hands off or takes a message. */
export type AiFlow = 'online_problem' | 'card_charge' | 'billing' | 'merchant' | 'courier' | 'customer_service' | 'custom';
export const AI_FLOWS: AiFlow[] = ['online_problem', 'card_charge', 'billing', 'merchant', 'courier', 'customer_service', 'custom'];
export type LinkKey = 'merchant' | 'courier' | 'help' | 'billing' | 'order';
export const LINK_KEYS: LinkKey[] = ['merchant', 'courier', 'help', 'billing', 'order'];

export type IvrAction =
  | { kind: 'menu' }
  | { kind: 'ai'; flow: AiFlow; link?: LinkKey }
  | { kind: 'order' }
  | { kind: 'platform'; platform?: PlatformId }
  | { kind: 'handoff' }
  | { kind: 'voicemail' };
export type ActionKind = IvrAction['kind'];

export interface IvrNode {
  /** Stable id, also the branch name the AI routes to (route_to). */
  id: string;
  /** Keypad digit among its siblings: 1–9; 0 only for "talk to a person". */
  digit: string;
  enabled: boolean;
  /** Short label read in the keypad menu: "Pour {label}, faites le {digit}." */
  label: Texts;
  /** Said when the caller enters this option (a submenu or flow intro). Empty = nothing extra. */
  prompt: Partial<Texts>;
  /** Speech hints for the recognizer, comma separated, any language. */
  hints: string;
  /** For the AI (English): when to route here. */
  ai: string;
  action: IvrAction;
  children?: IvrNode[];
}

export interface PlatformSupport {
  /** Official customer-support phone per caller language (E.164). Empty = the platform has no public phone line. */
  phones: Partial<Record<IvrLang, string>>;
  /** Official help page, texted to the caller (only this platform's own page). */
  helpUrl: string;
}

export interface IvrSettings {
  enabled: boolean;
  /** 'ai' (default) = the AI talks right after the greeting, keypad as fallback. 'keypad' = classic menu only. */
  mode: 'ai' | 'keypad';
  /** Other Twilio numbers answered by this menu (FOODHUB_IVR_NUMBER is always one). */
  numbers: string[];
  greeting: Texts;
  marketing: Texts;
  askHelp: Texts;
  /** Recorded audio (https URL of an MP3/WAV) played instead of the voice, per language. */
  audio: { greeting: Partial<Texts>; voicemail: Partial<Texts> };
  voices: Texts;
  links: Record<LinkKey, string>;
  platforms: Record<PlatformId, PlatformSupport>;
  /** AI phone line (Settings → AI phone) used for "place an order". Empty = the line of the called number, else the first line on. */
  orderLineId: string;
  /** "Talk to a person" rings this number (else FOODHUB_IVR_HANDOFF_NUMBER, else FOODHUB_MAIN_PHONE). Empty = voicemail. */
  handoffNumber: string;
  /** Voicemails and tickets are emailed here (else FOODHUB_VOICEMAIL_EMAIL, else FOODHUB_OWNER_EMAIL). */
  voicemailEmail: string;
  /** Live transcription of voicemails (Twilio <Transcription>, fr-CA / en-US / es-US). */
  transcribeVoicemail: boolean;
  /** Seconds the menu waits for a word or a key. */
  timeout: number;
  tree: IvrNode[];
  updatedAt?: string;
}

/** The owner's wording (2026-10-09). "Numéro un au Canada" is a superlative: see SAFER_GREETING. */
export const OWNER_GREETING: Texts = {
  fr: 'Bienvenue au service ON2GO, votre service de livraison numéro un au Canada.',
  en: 'Welcome to ON2GO, your number one delivery service in Canada.',
  es: 'Bienvenido al servicio ON2GO, su servicio de entrega número uno en Canadá.',
};
/** A claim that needs no proof under the Competition Act (shown as the safer choice in Settings). */
export const SAFER_GREETING: Texts = {
  fr: 'Bienvenue au service ON2GO, votre service de livraison local au Québec.',
  en: 'Welcome to ON2GO, your local delivery service in Québec.',
  es: 'Bienvenido al servicio ON2GO, su servicio de entrega local en Quebec.',
};

const t3 = (fr: string, en: string, es: string): Texts => ({ fr, en, es });

/** The default tree: the DoorDash-style ecosystem, local. Ids are the AI's branch names. */
export const DEFAULT_TREE: IvrNode[] = [
  {
    id: 'online_order', digit: '1', enabled: true, action: { kind: 'menu' },
    label: t3('une commande en ligne ON2GO, Clover ou sur le site d’un de nos restaurants', 'an online order from ON2GO, Clover or one of our restaurant websites', 'un pedido en línea de ON2GO, Clover o del sitio de uno de nuestros restaurantes'),
    prompt: { fr: 'Commande en ligne.', en: 'Online orders.', es: 'Pedidos en línea.' },
    hints: 'commande en ligne, site web, Clover, online order, website, pedido en línea',
    ai: 'Anything about an order placed with us directly (ON2GO, Clover online ordering, one of our restaurant websites). Prefer a child branch.',
    children: [
      {
        id: 'online_problem', digit: '1', enabled: true, action: { kind: 'ai', flow: 'online_problem', link: 'help' },
        label: t3('un problème avec votre commande en ligne', 'a problem with your online order', 'un problema con su pedido en línea'),
        prompt: {}, hints: 'problème, en retard, manquant, pas reçu, problem, late, missing, wrong, problema, tarde, falta',
        ai: 'The caller has a problem with an order placed with us online (late, missing item, wrong item, status).',
      },
      {
        id: 'place_order', digit: '2', enabled: true, action: { kind: 'order' },
        label: t3('passer une commande', 'place an order', 'hacer un pedido'),
        prompt: {}, hints: 'commander, passer une commande, order, place an order, pedir, hacer un pedido',
        ai: 'The caller wants to order food now (pickup or delivery). The ordering assistant takes over.',
      },
      {
        id: 'card_charge', digit: '3', enabled: true, action: { kind: 'ai', flow: 'card_charge', link: 'help' },
        label: t3('des frais sur votre carte pour une commande en ligne', 'a charge on your card for an online order', 'un cargo en su tarjeta por un pedido en línea'),
        prompt: {}, hints: 'frais, carte, transaction, charge, card, cargo, tarjeta',
        ai: 'The caller sees a charge on their card or bank statement about an online order and wants to know what it is.',
      },
    ],
  },
  {
    id: 'platform_order', digit: '2', enabled: true, action: { kind: 'menu' },
    label: t3('une commande Uber Eats, DoorDash ou SkipTheDishes', 'an Uber Eats, DoorDash or SkipTheDishes order', 'un pedido de Uber Eats, DoorDash o SkipTheDishes'),
    prompt: { fr: 'Commande d’une plateforme.', en: 'Delivery app orders.', es: 'Pedidos de una aplicación.' },
    hints: 'Uber Eats, DoorDash, SkipTheDishes, Skip, plateforme, application, app, aplicación',
    ai: 'The order was placed on Uber Eats, DoorDash or SkipTheDishes. Route to the platform child, or here when the platform is not known yet.',
    children: [
      {
        id: 'platform_ubereats', digit: '1', enabled: true, action: { kind: 'platform', platform: 'ubereats' },
        label: t3('Uber Eats', 'Uber Eats', 'Uber Eats'), prompt: {}, hints: 'Uber, Uber Eats', ai: 'Order placed on Uber Eats.',
      },
      {
        id: 'platform_doordash', digit: '2', enabled: true, action: { kind: 'platform', platform: 'doordash' },
        label: t3('DoorDash', 'DoorDash', 'DoorDash'), prompt: {}, hints: 'DoorDash, Door Dash', ai: 'Order placed on DoorDash.',
      },
      {
        id: 'platform_skip', digit: '3', enabled: true, action: { kind: 'platform', platform: 'skip' },
        label: t3('SkipTheDishes', 'SkipTheDishes', 'SkipTheDishes'), prompt: {}, hints: 'Skip, SkipTheDishes, Skip the dishes', ai: 'Order placed on SkipTheDishes.',
      },
    ],
  },
  {
    id: 'billing', digit: '3', enabled: true, action: { kind: 'ai', flow: 'billing', link: 'billing' },
    label: t3('la facturation', 'billing', 'facturación'), prompt: {},
    hints: 'facture, facturation, reçu, billing, invoice, receipt, factura, recibo',
    ai: 'Invoices, receipts, a business account, a merchant invoice or statement from ON2GO.',
  },
  {
    id: 'merchant', digit: '4', enabled: true, action: { kind: 'ai', flow: 'merchant', link: 'merchant' },
    label: t3('devenir restaurant partenaire', 'become a partner restaurant', 'ser restaurante asociado'), prompt: {},
    hints: 'marchand, restaurant partenaire, mon restaurant, merchant, partner, my restaurant, restaurante asociado, comerciante',
    ai: 'A restaurant or shop owner who wants to sell with ON2GO (merchant sign-up).',
  },
  {
    id: 'courier', digit: '5', enabled: true, action: { kind: 'ai', flow: 'courier', link: 'courier' },
    label: t3('devenir livreur', 'become a courier', 'ser repartidor'), prompt: {},
    hints: 'livreur, livreuse, devenir livreur, courier, driver, repartidor',
    ai: 'Someone who wants to deliver for ON2GO (courier sign-up).',
  },
  {
    id: 'customer_service', digit: '6', enabled: true, action: { kind: 'ai', flow: 'customer_service', link: 'help' },
    label: t3('le service à la clientèle', 'customer service', 'servicio al cliente'), prompt: {},
    hints: 'service à la clientèle, question, renseignement, customer service, information, servicio al cliente, información',
    ai: 'Any other question for ON2GO (hours, restaurants, delivery area, feedback).',
  },
  {
    id: 'voicemail', digit: '7', enabled: true, action: { kind: 'voicemail' },
    label: t3('laisser un message', 'leave a message', 'dejar un mensaje'), prompt: {},
    hints: 'message, boîte vocale, voicemail, leave a message, mensaje',
    ai: 'The caller wants to leave a message.',
  },
  {
    id: 'person', digit: '0', enabled: true, action: { kind: 'handoff' },
    label: t3('parler à quelqu’un', 'talk to someone', 'hablar con alguien'), prompt: {},
    hints: 'parler à quelqu’un, une personne, agent, someone, a person, representative, persona, alguien',
    ai: 'The caller asks for a person, or the matter needs a person (complaint, refund, anything you cannot do).',
  },
];

/**
 * Official platform support, checked 2026-10-09 on each platform's own help pages:
 *  - DoorDash: help.doordash.com/consumers/s/contactsupport — fr_CA "Appelez-nous au 855-643-8439", en_CA / en_US
 *    "Call Us at 855-431-0459", es_US "Llámanos al 855-834-8733"; chat and call 24/7.
 *  - Uber Eats: help.uber.com/ubereats — "we don't offer a customer service phone number for Uber Eats" (help in the app).
 *  - SkipTheDishes: skipthedishes.com/faq — "Need Help?" in the app or website, live chat (no customer phone line published).
 */
export const DEFAULT_PLATFORMS: Record<PlatformId, PlatformSupport> = {
  ubereats: { phones: {}, helpUrl: 'https://help.uber.com/ubereats' },
  doordash: { phones: { fr: '+18556438439', en: '+18554310459', es: '+18558348733' }, helpUrl: 'https://help.doordash.com/consumers/s/contactsupport' },
  skip: { phones: {}, helpUrl: 'https://www.skipthedishes.com/faq' },
};

/** ON2GO pages texted to callers. Placeholders until the pages are live (owner edits them in Settings). */
export const DEFAULT_LINKS: Record<LinkKey, string> = {
  merchant: 'https://on2go.ca/marchands',
  courier: 'https://on2go.ca/livreurs',
  help: 'https://on2go.ca/aide',
  billing: 'https://on2go.ca/aide',
  order: 'https://on2go.ca',
};

export const DEFAULT_IVR: IvrSettings = {
  enabled: true,
  mode: 'ai',
  numbers: [],
  greeting: OWNER_GREETING,
  marketing: t3(
    'Poulet grillé, pitas, tacos, déjeuners : vos restos du quartier, livrés chauds jusqu’à tard le soir.',
    'Grilled chicken, pitas, tacos, breakfast: your neighbourhood restaurants, delivered hot until late at night.',
    'Pollo asado, pitas, tacos, desayunos: sus restaurantes del barrio, entregados calientes hasta tarde en la noche.',
  ),
  askHelp: t3('Comment puis-je vous aider ?', 'How can I help you?', '¿Cómo puedo ayudarle?'),
  audio: { greeting: {}, voicemail: {} },
  voices: t3('Polly.Gabrielle-Neural', 'Polly.Joanna-Neural', 'Polly.Lupe-Neural'),
  links: DEFAULT_LINKS,
  platforms: DEFAULT_PLATFORMS,
  orderLineId: '',
  handoffNumber: '',
  voicemailEmail: '',
  transcribeVoicemail: true,
  timeout: 6,
  tree: DEFAULT_TREE,
};

// ---------------------------------------------------------------------------------------------------------------
// Tree helpers and validation

export function walk(tree: IvrNode[]): IvrNode[] {
  return tree.flatMap((n) => [n, ...(n.children ? walk(n.children) : [])]);
}

export function findNode(tree: IvrNode[], id: string | null | undefined): IvrNode | null {
  if (!id) return null;
  return walk(tree).find((n) => n.id === id) ?? null;
}

/** The node and its parent ('' = the root). */
export function parentOf(tree: IvrNode[], id: string): IvrNode | null {
  for (const n of walk(tree)) if (n.children?.some((c) => c.id === id)) return n;
  return null;
}

/** Enabled options of one menu level ('' = main menu). */
export function levelOf(tree: IvrNode[], menuId: string | null | undefined): IvrNode[] {
  const nodes = menuId ? findNode(tree, menuId)?.children ?? [] : tree;
  return nodes.filter((n) => n.enabled);
}

/** The first enabled node doing this (the AI and the keypad fallback find branches by what they do, not by id). */
export function nodeFor(tree: IvrNode[], pred: (a: IvrAction) => boolean): IvrNode | null {
  return walk(tree).find((n) => n.enabled && pred(n.action)) ?? null;
}

const ID = /^[a-z][a-z0-9_]{1,39}$/;
export const URL_OK = (u: string) => /^https:\/\/[^\s"<>]{3,300}$/.test(u);

/** Every problem with a tree (empty = valid). Used on save and in tests. */
export function validateTree(tree: IvrNode[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const check = (nodes: IvrNode[], depth: number, where: string) => {
    if (!Array.isArray(nodes) || !nodes.length) { errors.push(`${where}: no option.`); return; }
    if (nodes.length > 10) errors.push(`${where}: at most 10 options.`);
    const digits = new Set<string>();
    for (const n of nodes) {
      const at = `${where} › ${n?.id || '?'}`;
      if (!n || typeof n !== 'object') { errors.push(`${where}: bad option.`); continue; }
      if (!ID.test(String(n.id))) errors.push(`${at}: id must be lowercase letters, digits or _ (2–40).`);
      else if (ids.has(n.id)) errors.push(`${at}: id used twice.`);
      ids.add(n.id);
      const kind = n.action?.kind;
      if (!/^[0-9]$/.test(String(n.digit))) errors.push(`${at}: the key must be one digit.`);
      else if (n.digit === '0' && kind !== 'handoff') errors.push(`${at}: 0 is kept for "talk to someone".`);
      else if (n.enabled && digits.has(n.digit)) errors.push(`${at}: key ${n.digit} is used twice on this menu.`);
      if (n.enabled) digits.add(n.digit);
      for (const l of IVR_LANGS) if (!String(n.label?.[l] ?? '').trim()) errors.push(`${at}: label missing (${l}).`);
      if (String(n.hints ?? '').length > 500) errors.push(`${at}: speech hints too long (500 max).`);
      if (String(n.ai ?? '').length > 400) errors.push(`${at}: AI note too long (400 max).`);
      switch (kind) {
        case 'menu':
          if (depth >= 2) errors.push(`${at}: a submenu cannot hold another submenu.`);
          else if (!n.children?.length) errors.push(`${at}: a submenu needs options.`);
          else check(n.children, depth + 1, at);
          if (n.enabled && n.children && !n.children.some((c) => c.enabled)) errors.push(`${at}: every option of this submenu is off.`);
          break;
        case 'ai': {
          const a = n.action as Extract<IvrAction, { kind: 'ai' }>;
          if (!AI_FLOWS.includes(a.flow)) errors.push(`${at}: unknown AI flow.`);
          if (a.link && !LINK_KEYS.includes(a.link)) errors.push(`${at}: unknown link.`);
          break;
        }
        case 'platform': {
          const a = n.action as Extract<IvrAction, { kind: 'platform' }>;
          if (a.platform && !PLATFORM_IDS.includes(a.platform)) errors.push(`${at}: unknown platform.`);
          break;
        }
        case 'order': case 'handoff': case 'voicemail': break;
        default: errors.push(`${at}: unknown action.`);
      }
      if (kind !== 'menu' && n.children?.length) errors.push(`${at}: only a submenu has options.`);
    }
  };
  check(tree, 1, 'Menu');
  return errors;
}
