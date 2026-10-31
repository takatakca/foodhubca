// Built-in (rule-based) page summaries, next steps and answers: what the panel shows when ANTHROPIC_API_KEY is not set,
// and the safety net when Claude is unreachable. Pure functions over the page snapshot — easy to test, no I/O.
import type { NextStep, PageBrief, PageSnapshot } from './types';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const has = (s: PageSnapshot, k: string) => typeof s.numbers[k] === 'number';
export const moneyFr = (n: number) => `${n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;
export const moneyEn = (n: number) => `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

const step = (fr: string, en: string, askFr: string, askEn: string, href?: string): NextStep => ({ fr, en, askFr, askEn, ...(href ? { href } : {}) });

/** The next steps of a page, most useful first (signals first, then what the page is for). Always 3 or 4. */
export function ruleSteps(s: PageSnapshot): NextStep[] {
  const out: NextStep[] = [];
  for (const sig of s.signals.slice(0, 2)) out.push(step(`Examiner : ${sig.fr}`, `Investigate: ${sig.en}`, sig.questionFr, sig.questionEn));
  const byPage: Record<string, NextStep[]> = {
    home: [
      step('Analyser mes ventes de la semaine', 'Analyze my sales this week', 'Analyse mes ventes des 7 derniers jours par plateforme et par marque.', 'Analyze my sales for the last 7 days by platform and brand.'),
      step('Voir ce qui freine mes magasins', 'See what is holding my stores back', 'Qu’est-ce qui freine mes magasins en ce moment (pauses, annulations, retards, avis) ?', 'What is holding my stores back right now (pauses, cancellations, late orders, reviews)?'),
      step('Mes meilleurs articles', 'My top items', 'Quels sont mes 10 meilleurs articles cette semaine, toutes plateformes ?', 'What are my top 10 items this week, across every platform?'),
    ],
    orders: [
      step('Comprendre les annulations', 'Understand the cancellations', 'Pourquoi des commandes ont été annulées cette semaine ?', 'Why were orders cancelled this week?'),
      step('Commandes manquées', 'Missed orders', 'Combien de commandes ont été manquées (jamais acceptées) cette semaine ?', 'How many orders were missed (never accepted) this week?'),
      step('Ajuster le temps de préparation', 'Adjust the prep time', 'Faut-il changer le temps de préparation ? Propose-le si oui.', 'Should I change the prep time? Propose it if so.'),
    ],
    order: [
      step('Expliquer cette commande', 'Explain this order', 'Que s’est-il passé avec cette commande ?', 'What happened with this order?'),
      step('Problèmes de commandes cette semaine', 'Order issues this week', 'Quels problèmes de commandes cette semaine (annulées, en retard, manquées) ?', 'What order issues this week (cancelled, late, missed)?'),
      step('Ventes du jour', 'Today’s sales', 'Combien on a vendu aujourd’hui, par plateforme ?', 'How much did we sell today, by platform?'),
    ],
    menu: [
      step('Changer un prix', 'Change a price', 'Je veux changer le prix d’un article sur certaines plateformes.', 'I want to change an item’s price on some platforms.'),
      step('Articles qui se vendent le moins', 'Slowest items', 'Quels articles se vendent le moins ce mois-ci ?', 'Which items sell the least this month?'),
      step('Mettre un article en rupture', '86 an item', 'Je veux mettre un article en rupture (86).', 'I want to 86 an item.'),
    ],
    menu86: [
      step('Remettre des articles en vente', 'Bring items back', 'Quels articles en rupture puis-je remettre en vente ?', 'Which sold-out items can I bring back?'),
      step('Ventes perdues par les ruptures', 'Sales lost to 86', 'Combien les ruptures m’ont coûté cette semaine ?', 'How much did sold-out items cost me this week?'),
      step('Mettre un article en rupture', '86 an item', 'Je veux mettre un article en rupture (86).', 'I want to 86 an item.'),
    ],
    stores: [
      step('Temps hors ligne', 'Downtime', 'Combien de temps mes magasins ont été hors ligne cette semaine, et pourquoi ?', 'How long were my stores offline this week, and why?'),
      step('Mettre un magasin en pause', 'Pause a store', 'Je veux mettre un magasin en pause.', 'I want to pause a store.'),
      step('Temps de préparation', 'Prep time', 'Quels sont les temps de préparation par cuisine ? Faut-il les changer ?', 'What are the prep times per kitchen? Should they change?'),
    ],
    insights: [
      step('Ventes par plateforme', 'Sales by platform', 'Compare mes ventes par plateforme ce mois-ci contre le mois dernier.', 'Compare my sales by platform this month vs last month.'),
      step('Meilleures marques', 'Best brands', 'Quelles marques vendent le plus et le moins cette semaine ?', 'Which brands sell the most and the least this week?'),
      step('Heures fortes', 'Busy hours', 'Quelles sont mes heures les plus fortes ?', 'What are my busiest hours?'),
    ],
    reviews: [
      step('Avis négatifs à répondre', 'Negative reviews to answer', 'Quels avis négatifs n’ont pas de réponse ?', 'Which negative reviews have no reply?'),
      step('Ce que les clients reprochent', 'What customers complain about', 'Quels thèmes reviennent dans les avis négatifs ?', 'Which themes come back in negative reviews?'),
      step('Préparer une promotion', 'Prepare a promotion', 'Propose un brouillon de promotion pour regagner des clients.', 'Draft a promotion to win customers back.'),
    ],
    money: [
      step('Argent à récupérer', 'Money to recover', 'Combien les plateformes me doivent et pourquoi ?', 'How much do the platforms owe me and why?'),
      step('Résumé des paiements', 'Payouts summary', 'Résume mes paiements des plateformes ce mois-ci.', 'Summarize my platform payouts this month.'),
      step('Ventes par plateforme', 'Sales by platform', 'Compare mes ventes par plateforme ce mois-ci.', 'Compare my sales by platform this month.'),
    ],
    alerts: [
      step('Quoi faire en premier', 'What to do first', 'Par quelle alerte commencer et que faire ?', 'Which alert should I handle first, and how?'),
      step('Alertes de la semaine', 'This week’s alerts', 'Quelles alertes reviennent le plus souvent ?', 'Which alerts come back most often?'),
      step('État des magasins', 'Store status', 'Quel est l’état de mes magasins sur chaque plateforme ?', 'What is the status of my stores on each platform?'),
    ],
    autopilot: [
      step('Que fait l’autopilote ?', 'What does Autopilot do?', 'Qu’est-ce que l’autopilote a fait récemment ?', 'What has Autopilot done recently?'),
      step('Ce qu’il faudrait automatiser', 'What to automate', 'Quelles tâches répétitives pourrais-je automatiser ?', 'Which repetitive tasks could I automate?'),
      step('État des magasins', 'Store status', 'Quel est l’état de mes magasins sur chaque plateforme ?', 'What is the status of my stores on each platform?'),
    ],
  };
  const fallback = byPage.home;
  for (const st of byPage[s.page] ?? fallback) { if (out.length >= 4) break; out.push(st); }
  return out.slice(0, 4);
}

/** Summary of the page in both languages, from the snapshot's numbers only (never invented). */
export function ruleSummary(s: PageSnapshot): { fr: string; en: string } {
  if (s.page === 'kitchen') return { fr: 'Écran cuisine : l’assistant reste discret ici.', en: 'Kitchen screen: the assistant stays out of the way here.' };
  const fr: string[] = []; const en: string[] = [];
  if (has(s, 'salesToday')) {
    fr.push(`Aujourd’hui : ${moneyFr(num(s.numbers.salesToday))} sur ${num(s.numbers.ordersToday)} commande(s), ${num(s.numbers.preparing)} en préparation.`);
    en.push(`Today: ${moneyEn(num(s.numbers.salesToday))} from ${num(s.numbers.ordersToday)} order(s), ${num(s.numbers.preparing)} being prepared.`);
  }
  if (has(s, 'storesTotal') && num(s.numbers.storesTotal) > 0) {
    fr.push(`Magasins : ${num(s.numbers.storesOnline)} en ligne sur ${num(s.numbers.storesTotal)}${num(s.numbers.storesPaused) ? `, ${num(s.numbers.storesPaused)} en pause` : ''}${num(s.numbers.storesDeactivated) ? `, ${num(s.numbers.storesDeactivated)} désactivé(s)` : ''}.`);
    en.push(`Stores: ${num(s.numbers.storesOnline)} online of ${num(s.numbers.storesTotal)}${num(s.numbers.storesPaused) ? `, ${num(s.numbers.storesPaused)} paused` : ''}${num(s.numbers.storesDeactivated) ? `, ${num(s.numbers.storesDeactivated)} deactivated` : ''}.`);
  }
  if (has(s, 'sales7d')) {
    const ch = s.numbers.sales7dChangePct;
    fr.push(`7 derniers jours : ${moneyFr(num(s.numbers.sales7d))}, ${num(s.numbers.orders7d)} commandes${typeof ch === 'number' ? ` (${ch >= 0 ? '+' : ''}${ch} % vs la semaine d’avant)` : ''}.`);
    en.push(`Last 7 days: ${moneyEn(num(s.numbers.sales7d))}, ${num(s.numbers.orders7d)} orders${typeof ch === 'number' ? ` (${ch >= 0 ? '+' : ''}${ch}% vs the week before)` : ''}.`);
  }
  if (has(s, 'itemsSoldOut')) { fr.push(`${num(s.numbers.itemsSoldOut)} article(s) en rupture.`); en.push(`${num(s.numbers.itemsSoldOut)} item(s) sold out.`); }
  if (has(s, 'avgStars') || has(s, 'reviews')) {
    const avg = s.numbers.avgStars;
    fr.push(`${num(s.numbers.reviews)} avis${typeof avg === 'number' ? `, moyenne ${avg.toFixed(1).replace('.', ',')} ★` : ''}.`);
    en.push(`${num(s.numbers.reviews)} reviews${typeof avg === 'number' ? `, average ${avg.toFixed(1)} ★` : ''}.`);
  }
  if (has(s, 'moneyToRecover')) { fr.push(`${moneyFr(num(s.numbers.moneyToRecover))} à récupérer des plateformes.`); en.push(`${moneyEn(num(s.numbers.moneyToRecover))} to recover from the platforms.`); }
  if (has(s, 'autopilotTotal')) { fr.push(`Autopilote : ${num(s.numbers.autopilotOn)} automatisation(s) sur ${num(s.numbers.autopilotTotal)} en marche.`); en.push(`Autopilot: ${num(s.numbers.autopilotOn)} of ${num(s.numbers.autopilotTotal)} automations on.`); }
  if (num(s.numbers.openAlerts)) { fr.push(`${num(s.numbers.openAlerts)} alerte(s) ouverte(s)${num(s.numbers.criticalAlerts) ? `, dont ${num(s.numbers.criticalAlerts)} critique(s)` : ''}.`); en.push(`${num(s.numbers.openAlerts)} open alert(s)${num(s.numbers.criticalAlerts) ? `, ${num(s.numbers.criticalAlerts)} critical` : ''}.`); }
  if (!fr.length) return { fr: `Vous êtes sur ${s.titleFr}. Posez une question sur vos ventes, vos commandes, vos menus ou vos magasins.`, en: `You are on ${s.titleEn}. Ask about your sales, orders, menus or stores.` };
  if (!s.signals.length) { fr.push('Rien d’urgent en ce moment.'); en.push('Nothing urgent right now.'); }
  return { fr: fr.join(' '), en: en.join(' ') };
}

export function ruleBrief(s: PageSnapshot): PageBrief {
  const sum = ruleSummary(s);
  return { summaryFr: sum.fr, summaryEn: sum.en, steps: s.page === 'kitchen' ? [] : ruleSteps(s), signals: s.page === 'kitchen' ? [] : s.signals.slice(0, 3), source: 'rules' };
}

/** A built-in answer to a question (no AI): the closest page facts and a pointer to the right screen. */
export function ruleAnswer(question: string, s: PageSnapshot, lang: 'fr' | 'en'): string {
  const t = question.toLowerCase();
  const fr = lang === 'fr';
  const any = (...w: string[]) => w.some((x) => t.includes(x));
  const intro = fr ? 'L’IA n’est pas configurée (ANTHROPIC_API_KEY) : voici ce que Food Hub sait déjà.' : 'AI is not set up (ANTHROPIC_API_KEY): here is what Food Hub already knows.';
  let body: string;
  if (any('vente', 'sales', 'chiffre', 'revenue', 'combien', 'how much', 'analy')) {
    body = fr
      ? `Aujourd’hui : ${moneyFr(num(s.numbers.salesToday))}, ${num(s.numbers.ordersToday)} commande(s). Le détail par plateforme, marque et période est dans Statistiques → Ventes.`
      : `Today: ${moneyEn(num(s.numbers.salesToday))}, ${num(s.numbers.ordersToday)} order(s). The breakdown by platform, brand and period is in Insights → Sales.`;
  } else if (any('prix', 'price')) {
    body = fr ? 'Les prix se changent dans Menus → l’article → Prix (par plateforme), puis Publier.' : 'Prices are changed in Menus → the item → Price (per platform), then Publish.';
  } else if (any('pause', 'fermer', 'close', 'magasin', 'store', 'resume', 'rouvrir')) {
    body = fr
      ? `Magasins : ${num(s.numbers.storesOnline)} en ligne sur ${num(s.numbers.storesTotal)}, ${num(s.numbers.storesPaused)} en pause. Pause / reprise dans Magasins.`
      : `Stores: ${num(s.numbers.storesOnline)} online of ${num(s.numbers.storesTotal)}, ${num(s.numbers.storesPaused)} paused. Pause / resume in Stores.`;
  } else if (any('annul', 'cancel', 'manqu', 'missed', 'retard', 'late')) {
    body = fr
      ? `Aujourd’hui : ${num(s.numbers.cancelledToday)} annulée(s), ${num(s.numbers.lateOrders)} en retard. Les raisons sont dans Statistiques → Opérations.`
      : `Today: ${num(s.numbers.cancelledToday)} cancelled, ${num(s.numbers.lateOrders)} late. Reasons are in Insights → Operations.`;
  } else if (any('86', 'rupture', 'sold out')) {
    body = fr ? 'Les ruptures se gèrent dans Menus → Ruptures (86).' : 'Sold-out items are managed in Menus → Sold out (86).';
  } else {
    body = fr ? ruleSummary(s).fr : ruleSummary(s).en;
  }
  return `${intro}\n${body}`;
}
