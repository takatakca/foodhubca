// Small wording helpers for Home, Orders and Alerts (premium pass A1): proper plurals instead of "(s)", a readable order
// number, and the incident timeline in the screen's language. Pure functions, no React: tested in tests/live-words.test.ts.

export type Lang = 'fr' | 'en';

/**
 * "1 commande", "3 commandes", "0 commande" (French keeps 0 and 1 singular; English only 1). The number is written in the
 * screen's locale ("1 234"). `many` defaults to `one` + "s".
 */
export function plural(lang: Lang, n: number, one: string, many = `${one}s`): string {
  const singular = lang === 'fr' ? Math.abs(n) < 2 : Math.abs(n) === 1;
  return `${n.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')} ${singular ? one : many}`;
}

/** FR + EN plurals at once, for `t(…, …)` call sites. */
export function plurals(n: number, fr: [string, string?], en: [string, string?]): [string, string] {
  return [plural('fr', n, fr[0], fr[1]), plural('en', n, en[0], en[1])];
}

/**
 * The number shown for an order: the platform's short number when there is one, else the start of the platform id
 * without a trailing separator ("dd-demo-12", never "dd-demo-"). Short ids are shown whole.
 */
export function orderNumber(o: { displayId?: string | null; externalOrderId: string }): string {
  if (o.displayId && o.displayId.trim()) return o.displayId.trim();
  const id = o.externalOrderId.trim();
  if (id.length <= 12) return id;
  return id.slice(0, 8).replace(/[-_.:\s]+$/, '') || id.slice(0, 8);
}

const EXACT: Record<string, [string, string]> = {
  Sent: ['Envoyé', 'Sent'],
  Calling: ['Appel lancé', 'Calling'],
  Posted: ['Publié', 'Posted'],
  'Simulation — not sent': ['Simulation : rien n’a été envoyé', 'Simulation: nothing was sent'],
  'Invalid email address.': ['Adresse courriel invalide.', 'Invalid email address.'],
  'Invalid phone number.': ['Numéro de téléphone invalide.', 'Invalid phone number.'],
};

/** Messages that name a missing set-up: said in owner words (no variable names), with where to fix it. */
const NOT_SET_UP: Array<[RegExp, [string, string]]> = [
  [/^SMS is not set up/i, ['Les textos ne sont pas encore branchés (Réglages → Canaux).', 'Text messages are not connected yet (Settings → Channels).']],
  [/^Phone calls are not set up/i, ['Les appels ne sont pas encore branchés (Réglages → Canaux).', 'Phone calls are not connected yet (Settings → Channels).']],
  [/^Team chat is not set up/i, ['Le clavardage d’équipe n’est pas encore branché (Réglages → Canaux).', 'Team chat is not connected yet (Settings → Channels).']],
];

/**
 * One line of an incident's timeline, in the screen's language. The watch engine writes some lines as "Français. /
 * English." and the senders answer in English ("Sent", "Network error: …"): the French screen never shows English.
 */
export function incidentStepText(lang: Lang, message: string): string {
  const m = message.trim();
  const pick = (pair: [string, string]) => (lang === 'fr' ? pair[0] : pair[1]);
  const exact = EXACT[m];
  if (exact) return pick(exact);
  for (const [re, pair] of NOT_SET_UP) if (re.test(m)) return pick(pair);
  // "Français. / English." written by the engine.
  const both = /^(.+?[.!?»])\s+\/\s+(.+)$/.exec(m);
  if (both) return lang === 'fr' ? both[1] : both[2];
  const net = /^Network error:\s*(.*)$/i.exec(m);
  if (net) return lang === 'fr' ? `Erreur réseau : ${net[1]}` : m;
  const http = /^(Twilio|Chat webhook) HTTP (\d{3})(?::\s*(.*))?$/i.exec(m);
  if (http) {
    const who = /twilio/i.test(http[1]) ? (lang === 'fr' ? 'Le service de textos et d’appels' : 'The text and call service') : (lang === 'fr' ? 'Le clavardage d’équipe' : 'Team chat');
    return lang === 'fr' ? `${who} a répondu par une erreur (${http[2]}).` : `${who} answered with an error (${http[2]}).`;
  }
  return m;
}
