// Claude as a supervisor: explains incidents in plain words and answers questions about the business.
// It reads a compact snapshot of Food Hub data and never takes an action — the locked rule is
// "AI does not approve money, post entries, delete data, or resolve financial issues automatically".
// Without ANTHROPIC_API_KEY everything falls back to the built-in explanations below.
import { timedFetch } from '../env-utils';
import type { Incident, IncidentKind } from './types';

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
}

export async function askClaude(system: string, user: string, maxTokens = 500): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await timedFetch(`${(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: aiModel(), max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const text = (body?.content ?? []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n').trim();
    return text || null;
  } catch {
    return null;
  }
}

/** Built-in explanation + what to do, per incident kind (French first). */
export const PLAYBOOK: Record<IncidentKind, { fr: string; en: string; doFr: string[]; doEn: string[] }> = {
  order_unaccepted: {
    fr: 'La plateforme attend une réponse. Sans réponse avant l’échéance, Uber annule la commande et Skip l’envoie à la tablette Skip.',
    en: 'The platform is waiting for an answer. Without one before the deadline, Uber cancels the order and Skip sends it to the Skip tablet.',
    doFr: ['Ouvrir la commande et appuyer sur Accepter', 'Si la cuisine ne peut pas la faire : Refuser avec une raison (NIP gérant)'],
    doEn: ['Open the order and tap Accept', 'If the kitchen cannot make it: Reject with a reason (manager PIN)'],
  },
  order_unseen: {
    fr: 'La commande a été acceptée automatiquement mais personne ne l’a vue à l’écran de cuisine. Elle n’est peut-être pas en préparation.',
    en: 'The order was auto-accepted but nobody looked at the kitchen screen. It may not be in preparation.',
    doFr: ['Vérifier la tablette de cuisine (son, écran allumé)', 'Appuyer sur « Vu » pour confirmer que la cuisine la prépare'],
    doEn: ['Check the kitchen tablet (sound, screen on)', 'Tap “Seen” to confirm the kitchen is making it'],
  },
  order_late: {
    fr: 'La commande a dépassé son heure « prête à ». Le livreur risque d’attendre et le client d’annuler.',
    en: 'The order passed its ready-by time. The courier may wait and the customer may cancel.',
    doFr: ['Marquer Prête dès qu’elle l’est', 'Ajouter +5 / +10 min si besoin', 'Prévenir le client par texto si la plateforme partage son numéro'],
    doEn: ['Mark Ready as soon as it is', 'Add +5 / +10 min if needed', 'Text the customer if the platform shares the number'],
  },
  courier_waiting: {
    fr: 'Le livreur est au comptoir et la commande n’est pas prête. Les plateformes pénalisent les longues attentes.',
    en: 'The courier is at the counter and the order is not ready. Platforms penalize long waits.',
    doFr: ['Prioriser cette commande', 'Marquer Prête puis Remise au livreur'],
    doEn: ['Prioritize this order', 'Mark Ready, then Picked up'],
  },
  pos_failed: {
    fr: 'Clover n’a pas reçu la commande : elle ne s’imprime pas en cuisine et n’est pas dans la caisse.',
    en: 'Clover did not receive the order: it does not print in the kitchen and is not in the register.',
    doFr: ['Appuyer sur « Renvoyer à Clover »', 'Si Clover est en panne : préparer depuis l’écran TAKATAK'],
    doEn: ['Tap “Send to Clover” again', 'If Clover is down: cook from the TAKATAK screen'],
  },
  store_unmapped: {
    fr: 'Une commande vient d’un magasin de plateforme que personne n’a relié à une marque et une succursale. TAKATAK ne l’accepte pas tout seul (mauvaise marque ou mauvaise cuisine possibles) et elle n’est peut-être pas dans la bonne caisse Clover. Sans réponse avant l’échéance, la plateforme l’annule.',
    en: 'An order came from a platform store nobody linked to a brand and a location. TAKATAK does not accept it by itself (wrong brand or wrong kitchen are possible) and it may not be in the right Clover register. Without an answer before the deadline, the platform cancels it.',
    doFr: ['Relier ce magasin dans Magasins → Branchement des magasins', 'Puis ouvrir la commande : Envoyer à Clover, puis Accepter ou Refuser'],
    doEn: ['Link this store in Stores → Store connections', 'Then open the order: Send to Clover, then Accept or Reject'],
  },
  store_offline: {
    fr: 'La plateforme a mis le magasin en pause pendant les heures d’ouverture — aucune commande n’entre.',
    en: 'The platform paused the store during opening hours — no orders are coming in.',
    doFr: ['Rouvrir depuis Magasins', 'Si la plateforme refuse : vérifier la tablette de la plateforme ou appeler son soutien'],
    doEn: ['Resume it from Stores', 'If the platform refuses: check the platform tablet or call its support'],
  },
  store_deactivated: {
    fr: 'La plateforme a désactivé ce magasin. Souvent : trop de commandes refusées/annulées, tablette hors ligne, ou problème de compte.',
    en: 'The platform deactivated this store. Usually: too many rejected/cancelled orders, tablet offline, or an account issue.',
    doFr: ['Appeler le soutien marchand de la plateforme', 'Vérifier les courriels de la plateforme'],
    doEn: ['Call the platform merchant support', 'Check the platform’s emails'],
  },
  device_offline: {
    fr: 'La tablette de cuisine ne répond plus (éteinte, batterie vide ou pas de Wi-Fi). Les nouvelles commandes ne sonnent pas en cuisine.',
    en: 'The kitchen tablet stopped answering (off, empty battery or no Wi-Fi). New orders do not ring in the kitchen.',
    doFr: ['Rallumer la tablette et la brancher', 'Vérifier le Wi-Fi', 'Rouvrir TAKATAK — elle se reconnecte seule'],
    doEn: ['Turn the tablet on and plug it in', 'Check the Wi-Fi', 'Reopen TAKATAK — it reconnects by itself'],
  },
  device_muted: {
    fr: 'La tablette est allumée mais le son est coupé ou l’écran TAKATAK n’est pas affiché : personne n’entendra les commandes.',
    en: 'The tablet is on but the sound is off or the TAKATAK screen is hidden: nobody will hear new orders.',
    doFr: ['Toucher l’écran pour réactiver le son', 'Remettre TAKATAK au premier plan'],
    doEn: ['Tap the screen to turn sound on', 'Bring TAKATAK back to the front'],
  },
  cancel_spike: {
    fr: 'Plusieurs annulations dans la dernière heure. Les plateformes baissent le classement des magasins qui annulent souvent.',
    en: 'Several cancellations in the last hour. Platforms rank stores that cancel often lower.',
    doFr: ['Regarder les raisons d’annulation', 'Mettre en rupture (86) les articles manquants', 'Activer le mode occupé si la cuisine est débordée'],
    doEn: ['Look at the cancellation reasons', '86 the missing items', 'Turn on busy mode if the kitchen is overloaded'],
  },
  sync_stale: {
    fr: 'Les statuts des magasins ne se sont pas mis à jour depuis plus de 15 minutes.',
    en: 'Store statuses have not refreshed for more than 15 minutes.',
    doFr: ['Garder un écran TAKATAK ouvert ou programmer /api/foodhub/cron/sync'],
    doEn: ['Keep a TAKATAK screen open or schedule /api/foodhub/cron/sync'],
  },
  webhook_unreadable: {
    fr: 'Une plateforme a envoyé un message que TAKATAK n’a pas su lire. Il est conservé — rien n’est perdu.',
    en: 'A platform sent a message TAKATAK could not read. It is kept — nothing is lost.',
    doFr: ['Envoyer le message conservé à votre développeur (Réglages → Canaux)'],
    doEn: ['Send the kept message to your developer (Settings → Channels)'],
  },
  platform_silent: {
    fr: 'Aucune commande de cette plateforme depuis des heures alors que ses magasins sont ouverts : le branchement (webhook, clés, magasin désactivé) est peut-être cassé.',
    en: 'No order from this platform for hours while its stores are open: the connection (webhook, keys, deactivated store) may be broken.',
    doFr: ['Vérifier la tablette de la plateforme : des commandes y arrivent-elles ?', 'Voir Réglages → Plateformes et Clover → Boîte de réception des webhooks', 'Vérifier que les magasins sont actifs chez la plateforme'],
    doEn: ['Check the platform tablet: are orders arriving there?', 'See Settings → Platforms & Clover → Webhook inbox', 'Check the stores are active on the platform'],
  },
  menu_failed: {
    fr: 'Une publication de menu, un 86 ou une pause n’a pas été acceptée par une plateforme.',
    en: 'A menu publish, an 86 or a pause was not accepted by a platform.',
    doFr: ['Voir le détail dans Réglages → Canaux', 'Réessayer'],
    doEn: ['See the details in Settings → Channels', 'Try again'],
  },
  payout_gap: {
    fr: 'Les relevés montrent de l’argent que les plateformes vous doivent (commandes non payées, payées en moins, frais d’erreur).',
    en: 'Statements show money the platforms owe you (unpaid orders, short payments, error charges).',
    doFr: ['Ouvrir Argent → Litiges', 'Contester chaque cas auprès de la plateforme'],
    doEn: ['Open Money → Disputes', 'Dispute each case with the platform'],
  },
  customer_issue: {
    fr: 'Un client a annulé ou un article a été signalé manquant.',
    en: 'A customer cancelled or an item was reported missing.',
    doFr: ['Vérifier la commande', 'Mettre l’article en rupture s’il manque'],
    doEn: ['Check the order', '86 the item if it is missing'],
  },
};

const SYSTEM = `You are the TAKATAK Watchtower, the operations supervisor for a Montréal multi-brand delivery kitchen group (Uber Eats, DoorDash, SkipTheDishes, Too Good To Go, Clover POS).
Rules: you only explain and suggest. You never claim to have accepted, cancelled, refunded, paused or changed anything. Money decisions belong to the owner.
Write for a busy kitchen manager on a phone: French (Québec) first, short, concrete. Max 3 sentences, then up to 3 actions as a dash list.`;

export async function explainIncident(i: Incident, context: Record<string, unknown>): Promise<string | null> {
  return askClaude(SYSTEM, `Incident: ${i.title} (${i.kind}, ${i.severity}).\nDetails: ${i.detail ?? ''}\nContext (JSON): ${JSON.stringify(context).slice(0, 3000)}\nExplain what is happening and what to do now.`, 350);
}

export const COPILOT_SYSTEM = `You are the TAKATAK co-pilot inside the restaurant group's operations console (Montréal; brands sold on Uber Eats, DoorDash, SkipTheDishes, Too Good To Go; Clover POS).
You answer from the JSON snapshot you are given — never invent numbers; say when the data is not there.
You never take actions or claim you did; you tell the person which button to press (Orders, Kitchen, Stores, Menus, Alerts, Insights, Money, Settings).
Answer in the user's language (French by default), in at most 6 short lines. Money in CAD with 2 decimals.`;
