// Voices and speech recognition of the phone lines (ON2GO menu and the AI ordering agent). No server imports: the
// settings pages read the lists from here too.
//
// Three languages, one per caller: Québec French (fr-CA, the default), English (en-US: Twilio has no en-CA voice or
// en-CA model in its current tables, and en-US works for Canadian callers) and Spanish (es-US, the US-Hispanic model:
// Mexican, Cuban and other Latin-American speakers; there is no es-CU locale anywhere).
//
// Voices: only names from Twilio's text-to-speech list are accepted (a typo, or a withdrawn beta voice, would break
// every <Say>). Defaults are the stable neural voices; Google Chirp3-HD and Polly Generative voices are offered after
// a listening test (they cost about 4x more and are in public beta at Twilio).
//
// Recognition (Twilio <Gather speechModel>): googlev2_telephony_short for short answers (menu, yes / no, order
// numbers) — Google honours hints there in all three languages; googlev2_telephony for free conversation (better for
// long sentences; Google ignores hints there for fr-CA and es-US, so none are sent).
import type { PhoneLang } from './calls';

export type VoiceGender = 'female' | 'male';
export interface VoiceOption { id: string; lang: PhoneLang; gender: VoiceGender; tier: 'standard' | 'neural' | 'generative'; label: string; /** <Say language> when it differs from the call's (es-MX voices). */ sayLanguage?: string }

const chirp = (lang: PhoneLang, locale: string): VoiceOption[] => [
  ...['Aoede', 'Kore', 'Leda', 'Zephyr'].map((n) => ({ id: `Google.${locale}-Chirp3-HD-${n}`, lang, gender: 'female' as const, tier: 'generative' as const, label: `Google Chirp3-HD ${n}` })),
  ...['Charon', 'Fenrir', 'Orus', 'Puck'].map((n) => ({ id: `Google.${locale}-Chirp3-HD-${n}`, lang, gender: 'male' as const, tier: 'generative' as const, label: `Google Chirp3-HD ${n}` })),
];

export const VOICE_OPTIONS: VoiceOption[] = [
  // Québec French (fr-CA)
  { id: 'Polly.Gabrielle-Neural', lang: 'fr', gender: 'female', tier: 'neural', label: 'Polly Gabrielle (Québec)' },
  { id: 'Polly.Liam-Neural', lang: 'fr', gender: 'male', tier: 'neural', label: 'Polly Liam (Québec)' },
  // Older standard voice, kept so a line saved with it keeps it (the neural voices sound better).
  { id: 'Polly.Chantal', lang: 'fr', gender: 'female', tier: 'standard', label: 'Polly Chantal (Québec, standard)' },
  { id: 'Google.fr-CA-Neural2-A', lang: 'fr', gender: 'female', tier: 'neural', label: 'Google Neural2 A' },
  { id: 'Google.fr-CA-Neural2-C', lang: 'fr', gender: 'female', tier: 'neural', label: 'Google Neural2 C' },
  { id: 'Google.fr-CA-Neural2-B', lang: 'fr', gender: 'male', tier: 'neural', label: 'Google Neural2 B' },
  { id: 'Google.fr-CA-Neural2-D', lang: 'fr', gender: 'male', tier: 'neural', label: 'Google Neural2 D' },
  ...chirp('fr', 'fr-CA'),
  // English (en-US)
  { id: 'Polly.Joanna-Neural', lang: 'en', gender: 'female', tier: 'neural', label: 'Polly Joanna' },
  { id: 'Polly.Danielle-Neural', lang: 'en', gender: 'female', tier: 'neural', label: 'Polly Danielle' },
  { id: 'Polly.Ruth-Neural', lang: 'en', gender: 'female', tier: 'neural', label: 'Polly Ruth' },
  { id: 'Polly.Matthew-Neural', lang: 'en', gender: 'male', tier: 'neural', label: 'Polly Matthew' },
  { id: 'Polly.Stephen-Neural', lang: 'en', gender: 'male', tier: 'neural', label: 'Polly Stephen' },
  ...['Danielle', 'Joanna', 'Ruth', 'Tiffany'].map((n) => ({ id: `Polly.${n}-Generative`, lang: 'en' as const, gender: 'female' as const, tier: 'generative' as const, label: `Polly ${n} (generative)` })),
  ...['Matthew', 'Stephen'].map((n) => ({ id: `Polly.${n}-Generative`, lang: 'en' as const, gender: 'male' as const, tier: 'generative' as const, label: `Polly ${n} (generative)` })),
  ...chirp('en', 'en-US'),
  // Spanish (es-US; Mia and Andrés are Mexican voices, es-MX)
  { id: 'Polly.Lupe-Neural', lang: 'es', gender: 'female', tier: 'neural', label: 'Polly Lupe' },
  { id: 'Polly.Pedro-Neural', lang: 'es', gender: 'male', tier: 'neural', label: 'Polly Pedro' },
  { id: 'Polly.Lupe-Generative', lang: 'es', gender: 'female', tier: 'generative', label: 'Polly Lupe (generative)' },
  { id: 'Polly.Pedro-Generative', lang: 'es', gender: 'male', tier: 'generative', label: 'Polly Pedro (generative)' },
  { id: 'Polly.Mia-Neural', lang: 'es', gender: 'female', tier: 'neural', label: 'Polly Mia (México)', sayLanguage: 'es-MX' },
  { id: 'Polly.Andres-Neural', lang: 'es', gender: 'male', tier: 'neural', label: 'Polly Andrés (México)', sayLanguage: 'es-MX' },
  { id: 'Google.es-US-Neural2-A', lang: 'es', gender: 'female', tier: 'neural', label: 'Google Neural2 A' },
  { id: 'Google.es-US-Neural2-B', lang: 'es', gender: 'male', tier: 'neural', label: 'Google Neural2 B' },
  ...chirp('es', 'es-US'),
];

export const DEFAULT_VOICES: Record<PhoneLang, string> = { fr: 'Polly.Gabrielle-Neural', en: 'Polly.Joanna-Neural', es: 'Polly.Lupe-Neural' };

/** Last resort when a <Say> must work whatever the settings (error answers). */
export const FALLBACK_VOICES = DEFAULT_VOICES;

export function voicesFor(lang: PhoneLang): VoiceOption[] {
  return VOICE_OPTIONS.filter((v) => v.lang === lang);
}

export function voiceOption(id: string | null | undefined): VoiceOption | null {
  return VOICE_OPTIONS.find((v) => v.id === id) ?? null;
}

/** A stored voice, kept only when it is a known voice of that language. */
export function cleanVoice(lang: PhoneLang, raw: unknown, fallback = DEFAULT_VOICES[lang]): string {
  const v = voiceOption(String(raw ?? ''));
  return v && v.lang === lang ? v.id : fallback;
}

export const SPEECH_LANGUAGE: Record<PhoneLang, string> = { fr: 'fr-CA', en: 'en-US', es: 'es-US' };

/** <Say language> for a voice: the call's language, or the voice's own (an es-MX voice). */
export function sayLanguage(lang: PhoneLang, voice: string): string {
  return voiceOption(voice)?.sayLanguage ?? SPEECH_LANGUAGE[lang];
}

export const SPEECH_MODELS = ['googlev2_telephony', 'googlev2_telephony_short', 'phone_call', 'deepgram_nova-3', 'deepgram_nova-2'] as const;
export const DEFAULT_SPEECH = { conversation: 'googlev2_telephony', short: 'googlev2_telephony_short' } as const;

/**
 * Does this model use hints for this language? Google V2 "telephony" adapts only in en-US; "telephony_short" in
 * fr-CA, es-US and en-US. Twilio's generic models and Deepgram nova-3 (keyterms) use them.
 */
export function hintsSupported(model: string, language: string): boolean {
  if (model === 'googlev2_telephony') return language === 'en-US';
  if (model === 'googlev2_telephony_short') return ['fr-CA', 'es-US', 'en-US', 'es-MX'].includes(language);
  if (model.startsWith('googlev2_')) return true;
  return true;
}

/** What a step listens for: short answers use the short model, free speech the conversation model. */
export type ListenKind = 'short' | 'digits' | 'conversation';

export interface SpeechPlan { language: string; model: string; hints?: string; timeout: number }

/**
 * The <Gather> recognition of one step. Hints are the caller's language words only (at most 50 terms of 100
 * characters), and only when the model honours them; the order-number step adds Google's alphanumeric class.
 */
export function speechPlan(lang: PhoneLang, kind: ListenKind, s: { speechModel: string; speechModelShort?: string; speechTimeout: number }, hints?: string): SpeechPlan {
  const language = SPEECH_LANGUAGE[lang];
  const model = kind === 'conversation' ? s.speechModel : s.speechModelShort || DEFAULT_SPEECH.short;
  const timeout = kind === 'digits' ? Math.max(3, s.speechTimeout) : s.speechTimeout;
  let terms = (hints ?? '').split(',').map((h) => h.trim()).filter((h) => h && h.length <= 100);
  if (kind === 'digits' && model.startsWith('google')) terms = ['$OOV_CLASS_ALPHANUMERIC_SEQUENCE', ...terms];
  terms = [...new Set(terms)].slice(0, 50);
  return { language, model, timeout, ...(terms.length && hintsSupported(model, language) ? { hints: terms.join(', ') } : {}) };
}

/** True for a word list in the caller's language: hint terms in other languages only add noise for the recognizer. */
const OTHER_LANG_WORDS: Record<PhoneLang, RegExp> = {
  fr: /\b(order|problem|courier|driver|someone|person|pedido|problema|repartidor|alguien|persona|ayuda)\b/i,
  en: /\b(commande|problème|livreur|quelqu|personne|anglais|pedido|problema|repartidor|alguien|persona|ayuda)\b/i,
  es: /\b(commande|problème|livreur|quelqu|personne|anglais|order|problem|courier|driver|someone|person)\b/i,
};

/** Hints kept for one language: brand, platform and language names stay (the caller may say "English" or "español"). */
export function hintsForLang(raw: string, lang: PhoneLang): string {
  return raw.split(',').map((h) => h.trim()).filter((h) => h && !OTHER_LANG_WORDS[lang].test(h)).join(', ');
}
