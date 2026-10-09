// ON2GO phone menu (IVR) — the settings: greeting, languages, the menu tree, links, platform support lines.
//
// One Twilio number (FOODHUB_IVR_NUMBER, the ON2GO main line) answers with a recorded/neural greeting, then the AI
// talks with the caller ("Comment puis-je vous aider ?") and routes to a branch of this tree with a tool call. The
// keypad is the silent fallback: digits work at any time, 0 = a person, and after two misunderstandings the caller
// hears the short keypad menu built from this tree. Stored in fh_kv; edited in Settings → Expansion → AI phone →
// "Menu téléphonique". Phone numbers of people never live in git: the hand-off number and the voicemail email come
// from these settings or from env.
import { logActivity, type Actor } from '../../activity';
import { normalizeEmail, normalizePhone } from '../../notify';
import { getRepo } from '../../repo';
import {
  DEFAULT_IVR, DEFAULT_LINKS, DEFAULT_PLATFORMS, DEFAULT_TREE, IVR_LANGS, LINK_KEYS, OWNER_GREETING, PLATFORM_IDS, PLATFORM_NAME, URL_OK, validateTree, walk,
  type IvrAction, type IvrLang, type IvrNode, type IvrSettings, type PlatformId, type PlatformSupport, type Texts,
} from './tree';

export * from './tree';

const KEY = 'ivr_settings_v1';

function cleanTexts(raw: unknown, fallback: Texts, max = 400): Texts {
  const r = (raw ?? {}) as Partial<Texts>;
  return { fr: String(r.fr ?? fallback.fr).trim().slice(0, max) || fallback.fr, en: String(r.en ?? fallback.en).trim().slice(0, max) || fallback.en, es: String(r.es ?? fallback.es).trim().slice(0, max) || fallback.es };
}

function cleanPartial(raw: unknown, max = 400, test?: (s: string) => boolean): Partial<Texts> {
  const r = (raw ?? {}) as Partial<Texts>;
  const out: Partial<Texts> = {};
  for (const l of IVR_LANGS) {
    const v = String(r[l] ?? '').trim().slice(0, max);
    if (v && (!test || test(v))) out[l] = v;
  }
  return out;
}

function cleanNode(raw: any): IvrNode {
  const kind = raw?.action?.kind;
  const action: IvrAction = kind === 'ai' ? { kind, flow: raw.action.flow, ...(raw.action.link ? { link: raw.action.link } : {}) }
    : kind === 'platform' ? { kind, ...(raw.action.platform ? { platform: raw.action.platform } : {}) }
      : { kind } as IvrAction;
  return {
    id: String(raw?.id ?? '').trim(),
    digit: String(raw?.digit ?? '').trim(),
    enabled: raw?.enabled !== false,
    label: { fr: String(raw?.label?.fr ?? '').trim().slice(0, 160), en: String(raw?.label?.en ?? '').trim().slice(0, 160), es: String(raw?.label?.es ?? '').trim().slice(0, 160) },
    prompt: cleanPartial(raw?.prompt, 400),
    hints: String(raw?.hints ?? '').slice(0, 500),
    ai: String(raw?.ai ?? '').slice(0, 400),
    action,
    ...(Array.isArray(raw?.children) ? { children: raw.children.map(cleanNode) } : {}),
  };
}

const VOICE = /^(Polly|Google)\.[A-Za-z0-9-]{3,60}$/;

/** Settings as stored, completed with the defaults; throws a readable error on an invalid tree or value. */
export function cleanIvrSettings(raw: Partial<IvrSettings> | null | undefined, strict = false): IvrSettings {
  const s = raw ?? {};
  const tree = Array.isArray(s.tree) && s.tree.length ? s.tree.map(cleanNode) : DEFAULT_TREE;
  const errors = validateTree(tree);
  if (errors.length) {
    if (strict) throw new Error(`Phone menu: ${errors.slice(0, 3).join(' ')}`);
  }
  const voices = { ...DEFAULT_IVR.voices };
  for (const l of IVR_LANGS) if (VOICE.test(String(s.voices?.[l] ?? ''))) voices[l] = String(s.voices![l]);
  const links = { ...DEFAULT_LINKS };
  for (const k of LINK_KEYS) {
    const v = String(s.links?.[k] ?? '').trim();
    if (v) { if (URL_OK(v)) links[k] = v; else if (strict) throw new Error(`Link "${k}": use a full https:// address.`); }
  }
  const platforms = {} as Record<PlatformId, PlatformSupport>;
  for (const p of PLATFORM_IDS) {
    const r = s.platforms?.[p];
    const phones: Partial<Record<IvrLang, string>> = {};
    for (const l of IVR_LANGS) {
      const raw = r ? r.phones?.[l] : DEFAULT_PLATFORMS[p].phones[l];
      if (!raw) continue;
      const n = normalizePhone(raw);
      if (n) phones[l] = n; else if (strict) throw new Error(`${PLATFORM_NAME[p]} (${l}): not a phone number.`);
    }
    const help = String(r?.helpUrl ?? '').trim();
    platforms[p] = { phones, helpUrl: help && URL_OK(help) ? help : DEFAULT_PLATFORMS[p].helpUrl };
  }
  const handoff = String(s.handoffNumber ?? '').trim();
  const handoffN = handoff ? normalizePhone(handoff) : '';
  if (handoff && !handoffN && strict) throw new Error('Hand-off number: not a phone number.');
  const email = String(s.voicemailEmail ?? '').trim();
  const emailN = email ? normalizeEmail(email) : '';
  if (email && !emailN && strict) throw new Error('Voicemail email: not an email address.');
  const numbers = (Array.isArray(s.numbers) ? s.numbers : []).map((n) => normalizePhone(n)).filter((n): n is string => Boolean(n)).slice(0, 10);
  return {
    enabled: s.enabled !== false,
    mode: s.mode === 'keypad' ? 'keypad' : 'ai',
    numbers: [...new Set(numbers)],
    greeting: cleanTexts(s.greeting, OWNER_GREETING),
    marketing: cleanTexts(s.marketing, DEFAULT_IVR.marketing),
    askHelp: cleanTexts(s.askHelp, DEFAULT_IVR.askHelp, 200),
    audio: { greeting: cleanPartial(s.audio?.greeting, 300, URL_OK), voicemail: cleanPartial(s.audio?.voicemail, 300, URL_OK) },
    voices,
    links,
    platforms,
    orderLineId: String(s.orderLineId ?? '').slice(0, 40),
    handoffNumber: handoffN || '',
    voicemailEmail: emailN || '',
    transcribeVoicemail: s.transcribeVoicemail !== false,
    timeout: Math.min(15, Math.max(3, Math.round(Number(s.timeout) || DEFAULT_IVR.timeout))),
    tree: errors.length ? DEFAULT_TREE : tree,
    updatedAt: s.updatedAt,
  };
}

export async function getIvrSettings(): Promise<IvrSettings> {
  const raw = await getRepo().getKv<Partial<IvrSettings>>(KEY).catch(() => null);
  return cleanIvrSettings(raw);
}

export async function saveIvrSettings(patch: Partial<IvrSettings>, actor: Actor): Promise<IvrSettings> {
  const cur = await getIvrSettings();
  const next = cleanIvrSettings({ ...cur, ...patch }, true);
  await getRepo().setKv(KEY, { ...next, updatedAt: new Date().toISOString() });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'ivr_settings', status: 'success',
    summary: `ON2GO phone menu: ${next.enabled ? 'on' : 'off'}, ${next.mode === 'ai' ? 'AI first' : 'keypad only'}, ${walk(next.tree).filter((n) => n.enabled).length} option(s)` });
  return getIvrSettings();
}

/** The numbers that answer with this menu: FOODHUB_IVR_NUMBER (the ON2GO main line) + the ones in Settings. */
export function ivrNumbers(s: Pick<IvrSettings, 'numbers'>): string[] {
  const env = normalizePhone(process.env.FOODHUB_IVR_NUMBER);
  return [...new Set([...(env ? [env] : []), ...s.numbers])];
}

export function isIvrNumber(s: Pick<IvrSettings, 'numbers'>, to: string | null | undefined): boolean {
  const n = normalizePhone(to);
  return Boolean(n && ivrNumbers(s).includes(n));
}

/** "Talk to a person": Settings, else env. Null = straight to voicemail. */
export function handoffTarget(s: Pick<IvrSettings, 'handoffNumber'>): string | null {
  return normalizePhone(s.handoffNumber) ?? normalizePhone(process.env.FOODHUB_IVR_HANDOFF_NUMBER) ?? normalizePhone(process.env.FOODHUB_MAIN_PHONE) ?? null;
}

export function voicemailEmailTarget(s: Pick<IvrSettings, 'voicemailEmail'>): string | null {
  return normalizeEmail(s.voicemailEmail) ?? normalizeEmail(process.env.FOODHUB_VOICEMAIL_EMAIL) ?? normalizeEmail(process.env.FOODHUB_OWNER_EMAIL) ?? null;
}

/** Official help link for a platform in the caller's language (DoorDash has a page per language). */
export function platformHelpUrl(s: Pick<IvrSettings, 'platforms'>, p: PlatformId, lang: IvrLang): string {
  const url = s.platforms[p]?.helpUrl || DEFAULT_PLATFORMS[p].helpUrl;
  if (p === 'doordash' && /help\.doordash\.com/.test(url) && !/[?&]language=/.test(url)) return `${url}${url.includes('?') ? '&' : '?'}language=${({ fr: 'fr_CA', en: 'en_CA', es: 'es_US' } as const)[lang]}`;
  return url;
}

export function platformPhone(s: Pick<IvrSettings, 'platforms'>, p: PlatformId, lang: IvrLang): string | null {
  const phones = s.platforms[p]?.phones ?? {};
  return phones[lang] ?? phones.en ?? phones.fr ?? null;
}
