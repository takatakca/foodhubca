// Activity log text for the reader (premium A3). The server writes each entry once, in English; the French screen
// shows the common entries in French, and screen diagnostics (failed calls, crashes) sit behind a « Technique » filter
// so the owner reads what happened in the business, not the plumbing.
import type { ActivityEntry } from '@/lib/foodhub/types';

type Rule = [RegExp, (m: RegExpMatchArray) => string];

const ROLE_FR: Record<string, string> = { owner: 'propriétaire', manager: 'gérant', operator: 'employé', menu: 'éditeur de menu', analyst: 'analyste' };
const role = (r: string) => ROLE_FR[r] ?? r;

const RULES: Rule[] = [
  [/^(.+) signed in with the recovery password \((\w+)\)$/, (m) => `${m[1]} s’est connecté avec le mot de passe de secours (${role(m[2])})`],
  [/^(.+) signed in with a one-tap link \((.+)\)$/, (m) => `${m[1]} s’est connecté avec un lien de connexion (${m[2]})`],
  [/^(.+) signed in with a code \((.+)\)$/, (m) => `${m[1]} s’est connecté avec un code (${m[2]})`],
  [/^Wrong sign-in code for (.+)$/, (m) => `Mauvais code de connexion pour ${m[1]}`],
  [/^Failed recovery sign-in for (.+)$/, (m) => `Connexion de secours refusée pour ${m[1]}`],
  [/^(.+?) on Uber Eats is now online(.*)$/, (m) => `${m[1]} est maintenant en ligne sur Uber Eats${m[2]}`],
  [/^(.+?) on Uber Eats is now paused(.*)$/, (m) => `${m[1]} est maintenant en pause sur Uber Eats${m[2]}`],
  [/^(.+?) on SkipTheDishes back online(.*)$/, (m) => `${m[1]} est de nouveau en ligne sur SkipTheDishes${m[2]}`],
  [/^(.+?) on SkipTheDishes taken offline by Skip(.*)$/, (m) => `${m[1]} a été mis hors ligne par SkipTheDishes${m[2]}`],
  [/^Uber Eats order (\w+) for (.+) never arrived by webhook — found on Uber and processed$/, (m) => `Commande Uber Eats ${m[1]} pour ${m[2]} : jamais reçue automatiquement, retrouvée sur Uber et traitée`],
  [/^(.+) reached Clover on automatic try (\d+)(.*)$/, (m) => `${m[1]} est arrivée dans Clover au ${m[2]}ᵉ essai automatique${m[3].includes('already had it') ? ' (Clover l’avait déjà : reliée, pas envoyée deux fois)' : ''}`],
  [/^Kitchen tablet "(.+)" enrolled at (.+)$/, (m) => `Tablette de cuisine « ${m[1]} » enregistrée à ${m[2]}`],
  [/^Kitchen tablet "(.+)" removed — it must be enrolled again$/, (m) => `Tablette de cuisine « ${m[1]} » retirée : elle devra être enregistrée de nouveau`],
  [/^Kitchen tablet "(.+)" updated$/, (m) => `Tablette de cuisine « ${m[1]} » modifiée`],
  [/^Wrong PIN on tablet "(.+)"$/, (m) => `Mauvais NIP sur la tablette « ${m[1]} »`],
  [/^Back in stock in Food Hub only \(no mapped stores\): (.+)$/, (m) => `De retour en stock dans Food Hub seulement (aucun magasin relié) : ${m[1]}`],
  [/^86'd in Food Hub only \(no mapped stores\): (.+)$/, (m) => `En rupture dans Food Hub seulement (aucun magasin relié) : ${m[1]}`],
  [/^Owner account created for (.+)$/, (m) => `Compte propriétaire créé pour ${m[1]}`],
  [/^Scheduled menu publish for (.+) cancelled$/, (m) => `Publication programmée du menu de ${m[1]} annulée`],
  [/^Scheduled menu publish for (.+) was interrupted — publish again$/, (m) => `Publication programmée du menu de ${m[1]} interrompue : publiez de nouveau`],
  [/^Reconciliation: (\d+) new case\(s\) to check, (\d+) closed by later payouts$/, (m) => `Rapprochement : ${m[1]} ${Number(m[1]) === 1 ? 'nouveau cas' : 'nouveaux cas'} à vérifier, ${m[2]} ${Number(m[2]) === 1 ? 'réglé' : 'réglés'} par des paiements suivants`],
  [/^(.+) sent a support report from (.+?): (.*)$/, (m) => `${m[1]} a envoyé un signalement depuis ${m[2] === 'the console' ? 'la console' : m[2]} : ${m[3]}`],
];

/** The entry's text in the reader's language: French for the known templates, the original otherwise. */
export function activitySummary(summary: string, lang: 'fr' | 'en'): string {
  if (lang !== 'fr') return summary;
  for (const [re, fr] of RULES) {
    const m = summary.match(re);
    if (m) return fr(m);
  }
  return summary;
}

/**
 * A screen diagnostic (a failed call or a crash reported by a screen): shown only under « Technique ». Support reports
 * written by a person are not technical: they stay in the main list.
 */
export function isTechnical(e: Pick<ActivityEntry, 'action' | 'summary'>): boolean {
  if (e.action === 'screen_problem') return true;
  return /^\d+ problem\(s\) on /.test(e.summary) || /→ network error|\bHTTP \d{3}\b|\bGET \/api\/|\bPOST \/api\//.test(e.summary);
}
