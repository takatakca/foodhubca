// "Ready for test calls?" — one list of everything the two phone assistants (the ON2GO menu and the AI ordering lines)
// need, checked on this server, in plain words for the owner (Settings → Expansion → AI phone). Read-only: nothing here
// sends a text, calls Clover's write APIs or changes a setting. With `probe`, the pages the menu texts to callers are
// opened once (GET) and the result is kept (link-health.ts): a dead page is then never texted.
// Numbers and emails are masked; no secret value is ever returned (only whether it is set).
import { getCatalog } from '../catalog';
import { publicBaseUrl } from '../config';
import { kitchenHasNoRegister, merchantFor } from '../delivery/clover-direct';
import { paylinkReadiness } from '../delivery/paylink';
import { featureOn } from '../expansion/features';
import { describeHours, getHours } from '../hours';
import { callConfigured, emailConfigured, maskEmail, maskPhone, smsConfigured } from '../notify';
import { ecommConfigured, hcoWebhookSecret } from '../pos/clover-checkout';
import { cloverApp, cloverPhoneAppEnabled } from '../pos/clover-apps';
import { getRepo } from '../repo';
import { getAiHealth } from './ai-health';
import { phoneAgentConfigured, phoneModel } from './agent';
import { buildPhoneMenu, upsellGroups } from './cart';
import { kitchenPhoneGate, phoneGateWords } from './gate';
import { getIvrSettings, handoffTarget, LINK_KEYS, voicemailEmailTarget } from './ivr/config';
import { getLinkHealth, probeLink, saveLinkHealth } from './link-health';
import { getPhoneSettings, lineKitchens } from './settings';

export type CheckLevel = 'ok' | 'warn' | 'stop' | 'info';
/** `fr` / `en` are plain sentences for the owner; setting names and raw reasons go in `tech` (« Détails techniques »). */
export interface ReadinessCheck { id: string; level: CheckLevel; fr: string; en: string; group: 'basics' | 'ai' | 'lines' | 'payment' | 'menu'; tech?: string }
export interface PhoneReadiness { at: string; ready: boolean; checks: ReadinessCheck[] }

const c = (group: ReadinessCheck['group'], id: string, level: CheckLevel, fr: string, en: string, tech?: string): ReadinessCheck => ({ group, id, level, fr, en, ...(tech ? { tech } : {}) });

/**
 * Why the AI breaker is open, in plain words. The breaker keeps the API's own words ("authentication refused (401): …",
 * ai-health.ts classifyAiError); those go to « Détails techniques », this sentence to the owner.
 */
export function aiPauseWords(reason: string | null | undefined): { fr: string; en: string } {
  const r = String(reason ?? '');
  if (/^authentication/i.test(r)) return { fr: 'la clé de l’IA est refusée', en: 'the AI key is refused' };
  if (/^permission/i.test(r)) return { fr: 'la clé de l’IA n’a pas accès au modèle choisi', en: 'the AI key has no access to the chosen model' };
  if (/^billing/i.test(r)) return { fr: 'le crédit de l’IA est épuisé', en: 'the AI credit has run out' };
  if (/^model/i.test(r)) return { fr: 'le modèle d’IA choisi n’existe pas ou est refusé', en: 'the chosen AI model does not exist or is refused' };
  if (/^rate limit/i.test(r)) return { fr: 'trop de demandes à l’IA en même temps', en: 'too many AI requests at once' };
  if (/^server error/i.test(r)) return { fr: 'le service d’IA a des erreurs de son côté', en: 'the AI service is having errors on its side' };
  if (/^network/i.test(r)) return { fr: 'le service d’IA ne répond pas (réseau ou délai dépassé)', en: 'the AI service is not answering (network or timeout)' };
  return { fr: 'plusieurs échecs de suite', en: 'several failures in a row' };
}

export async function phoneReadiness(opts: { probe?: boolean; now?: number } = {}): Promise<PhoneReadiness> {
  const now = opts.now ?? Date.now();
  const out: ReadinessCheck[] = [];
  const base = publicBaseUrl();

  // ---- basics: Twilio, public address
  out.push(callConfigured()
    ? c('basics', 'twilio', 'ok', 'Twilio branché (appels et textos).', 'Twilio connected (calls and texts).')
    : c('basics', 'twilio', 'stop', 'Twilio n’est pas branché : aucun appel ni texto ne passe. Votre technicien le branche sur le serveur.', 'Twilio is not connected: no call or text goes through. Your technician connects it on the server.', 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM'));
  if (!smsConfigured()) out.push(c('basics', 'sms', 'warn', 'Textos non configurés : aucun lien ni confirmation ne peut être texté.', 'Texts not set up: no link or confirmation can be texted.'));
  out.push(/^https:\/\/[^\s/]+/.test(base)
    ? c('basics', 'public_url', 'ok', `Adresse publique : ${base}`, `Public address: ${base}`)
    : c('basics', 'public_url', 'stop', `L’adresse publique doit commencer par https (actuellement ${base}) : Twilio et Clover signent cette adresse.`, `The public address must start with https (now ${base}): Twilio and Clover sign that address.`, 'FOODHUB_PUBLIC_URL'));
  const testCallers = String(process.env.FOODHUB_PHONE_TEST_CALLERS ?? '').split(/[,;\s]+/).filter(Boolean).length;
  out.push(testCallers
    ? c('basics', 'test_callers', 'info', `${testCallers} numéro(s) de test : leurs commandes ne vont ni à Clover ni en cuisine.`, `${testCallers} test number(s): their orders never reach Clover or the kitchen.`)
    : c('basics', 'test_callers', 'info', 'Aucun numéro de test : un vrai appel de test passe une vraie commande.', 'No test number: a real test call places a real order.', 'FOODHUB_PHONE_TEST_CALLERS'));

  // ---- AI
  if (!phoneAgentConfigured()) {
    out.push(c('ai', 'ai_key', 'warn', 'Clé de l’IA manquante : le menu fonctionne au clavier et les commandes vont à une personne.', 'AI key missing: the menu runs on the keypad and orders go to a person.', 'ANTHROPIC_API_KEY'));
  } else {
    const h = await getAiHealth();
    if (h.openUntil && now < h.openUntil) {
      const min = Math.ceil((h.openUntil - now) / 60_000);
      const why = aiPauseWords(h.reason);
      out.push(c('ai', 'ai_breaker', 'stop', `IA en pause encore ${min} min : ${why.fr}. Vérifiez la clé et le crédit Anthropic.`, `AI paused for ${min} more min: ${why.en}. Check the Anthropic key and credit.`, h.reason));
    } else {
      out.push(c('ai', 'ai_key', 'ok', `IA prête (${phoneModel()})${h.lastOkAt ? '' : ' — pas encore utilisée'}.`, `AI ready (${phoneModel()})${h.lastOkAt ? '' : ' — not used yet'}.`));
    }
  }

  // ---- ON2GO menu
  const ivr = await getIvrSettings();
  if (ivr.enabled) {
    const handoff = handoffTarget(ivr);
    out.push(handoff
      ? c('basics', 'ivr_handoff', 'ok', `Menu ON2GO : transfert à une personne au ${maskPhone(handoff)}.`, `ON2GO menu: hand-off to a person at ${maskPhone(handoff)}.`)
      : c('basics', 'ivr_handoff', 'warn', 'Menu ON2GO : aucun numéro de transfert — « parler à quelqu’un » va à la boîte vocale.', 'ON2GO menu: no hand-off number — "talk to someone" goes to voicemail.'));
    const email = voicemailEmailTarget(ivr);
    out.push(email && emailConfigured()
      ? c('basics', 'ivr_voicemail', 'ok', `Messages vocaux envoyés à ${maskEmail(email)}.`, `Voicemails emailed to ${maskEmail(email)}.`)
      : c('basics', 'ivr_voicemail', 'warn', `Messages vocaux : ${email ? 'aucun service de courriel configuré' : 'aucune adresse'} — ils iront au clavardage d’équipe et restent dans Appels.`, `Voicemails: ${email ? 'no email provider' : 'no address'} — they go to the team chat and stay in Calls.`));
    const urls = [...new Set(LINK_KEYS.map((k) => ivr.links[k]).filter(Boolean))];
    let health = await getLinkHealth();
    if (opts.probe) {
      const res = Object.fromEntries(await Promise.all(urls.map(async (u) => [u, await probeLink(u)] as const)));
      await saveLinkHealth(res);
      health = { ...health, ...res };
    }
    const dead = urls.filter((u) => health[u] && !health[u].ok);
    const unchecked = urls.filter((u) => !health[u]);
    if (dead.length) out.push(c('basics', 'ivr_links', 'warn', `Liens texté(s) qui ne répondent pas (jamais textés) : ${dead.join(', ')}`, `Texted links that do not answer (never texted): ${dead.join(', ')}`));
    else if (unchecked.length) out.push(c('basics', 'ivr_links', 'info', `${unchecked.length} lien(s) jamais vérifié(s) : lancez « Vérifier les liens ».`, `${unchecked.length} link(s) never checked: run "Check the links".`));
    else out.push(c('basics', 'ivr_links', 'ok', 'Les pages textées aux clients répondent.', 'The pages texted to callers answer.'));
  } else {
    out.push(c('basics', 'ivr_off', 'info', 'Menu ON2GO éteint : les appels vont directement aux lignes de commande.', 'ON2GO menu off: calls go straight to the ordering lines.'));
  }

  // ---- ordering lines, kitchen by kitchen
  const phone = await getPhoneSettings();
  const phoneOn = await featureOn('phone');
  const enabled = phone.lines.filter((l) => l.enabled);
  if (!phoneOn) out.push(c('lines', 'phone_feature', 'warn', 'Commandes par téléphone (IA) éteintes (Réglages → Expansion) : les appels de commande vont à une personne.', 'AI phone ordering is off (Settings → Expansion): ordering calls go to a person.'));
  if (!enabled.length) out.push(c('lines', 'lines', 'warn', 'Aucune ligne de commande active.', 'No ordering line on.'));
  const locations = (await getCatalog()).locations;
  const hours = await getHours();
  const stores = await getRepo().listStores().catch(() => []);
  const seen = new Set<string>();
  for (const line of enabled) {
    for (const k of lineKitchens(line)) {
      const key = `${line.id}|${k.locationCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const where = `${line.name} · ${locations.find((l) => l.code === k.locationCode)?.name ?? k.locationCode}`;
      const h = describeHours(hours, k.brands, k.locationCode, now);
      const unset = k.brands.filter((b) => describeHours(hours, [b], k.locationCode, now).state === 'unknown');
      if (h.state === 'unknown' || unset.length) {
        out.push(c('lines', `hours_${key}`, 'stop', `${where} : heures non saisies pour ${unset.join(', ') || k.brands.join(', ')} — l’assistant ne prend aucune commande pour elles (Réglages → Heures).`, `${where}: hours not set for ${unset.join(', ') || k.brands.join(', ')} — the assistant takes no order for them (Settings → Hours).`));
      } else {
        out.push(c('lines', `hours_${key}`, 'ok', `${where} : heures saisies (${h.state === 'open' ? 'ouvert' : 'fermé'} en ce moment).`, `${where}: hours set (${h.state} right now).`));
      }
      const menu = await buildPhoneMenu(k).catch(() => null);
      const items = menu?.items.size ?? 0;
      const upsell = menu ? [...menu.items.values()].filter((e) => upsellGroups(e).length).length : 0;
      out.push(items
        ? c('menu', `menu_${key}`, 'ok', `${where} : ${items} plat(s) au menu${upsell ? `, ${upsell} avec Duo / Trio / Combo` : ''}.`, `${where}: ${items} item(s) on the menu${upsell ? `, ${upsell} with Duo / Trio / Combo` : ''}.`)
        : c('menu', `menu_${key}`, 'stop', `${where} : aucun plat disponible au menu.`, `${where}: no item available on the menu.`));
      if (kitchenHasNoRegister(k.locationCode)) {
        out.push(c('lines', `register_${key}`, 'info', `${where} : pas de caisse Clover — les commandes restent sur l’écran cuisine de Food Hub.`, `${where}: no Clover register — orders stay on Food Hub's kitchen screen.`));
      } else {
        const mapped = stores.some((st) => st.locationCode === k.locationCode && st.cloverMerchantId);
        const mid = await merchantFor(k.brands[0] ?? '', k.locationCode).catch(() => null);
        out.push(mapped
          ? c('lines', `register_${key}`, 'ok', `${where} : billet Clover sur la caisse de cette cuisine.`, `${where}: Clover ticket on this kitchen's register.`)
          : mid
            ? c('lines', `register_${key}`, 'warn', `${where} : aucune boutique Clover liée à cette cuisine — le billet irait au marchand par défaut. Liez la cuisine (Boutiques) ou demandez à votre technicien de la marquer « sans caisse ».`, `${where}: no Clover store mapped to this kitchen — the ticket would go to the default merchant. Map it (Stores) or ask your technician to mark it “no register”.`, 'FOODHUB_CLOVER_NO_REGISTER')
            : c('lines', `register_${key}`, 'info', `${where} : aucun marchand Clover — les commandes restent dans Food Hub.`, `${where}: no Clover merchant — orders stay in Food Hub.`));
      }
      if (cloverPhoneAppEnabled()) {
        // TAKATAK Phone is checked on every call: a kitchen that is neither ours nor entitled sends its calls to a person.
        const g = await kitchenPhoneGate(k, 'call', { now, budgetMs: 1_500 });
        const app = cloverApp('phone').name;
        // The answer in plain words; the raw code and the merchant number are for the technician (« Détails techniques »).
        const w = phoneGateWords(g.reason);
        const raw = [g.reason, g.merchantId && `merchant ${g.merchantId}`].filter(Boolean).join(' · ');
        out.push(g.ok
          ? c('lines', `phone_app_${key}`, 'ok', `${where} : ${app} OK (${w.fr}).`, `${where}: ${app} OK (${w.en}).`, raw)
          : c('lines', `phone_app_${key}`, 'stop', `${where} : ${app} refusé, car ${w.fr}. L’IA ne répond pas, les appels vont à une personne. Si c’est un de nos restaurants, demandez à votre technicien d’ajouter ce marchand à la liste de nos restaurants.`, `${where}: ${app} refused because ${w.en}. The AI does not answer, calls go to a person. If it is one of our restaurants, ask your technician to add this merchant to our restaurants list.`, `PHONE_OWN_MERCHANTS · ${raw}`));
      }
      if (phone.payment.mode !== 'counter' && ecommConfigured()) {
        const pay = await paylinkReadiness(k.brands[0] ?? '', k.locationCode);
        out.push(pay.ok
          ? c('payment', `pay_${key}`, 'ok', `${where} : lien de paiement Clover par texto prêt.`, `${where}: Clover payment link by text ready.`)
          : c('payment', `pay_${key}`, 'warn', `${where} : pas de lien de paiement — paiement au comptoir / rappel.`, `${where}: no payment link — pay at the counter / call back.`, pay.reason));
      }
    }
  }

  // ---- payment link (Clover Hosted Checkout)
  if (!ecommConfigured()) {
    out.push(c('payment', 'hco', 'info', 'Lien de paiement Clover non configuré : paiement au comptoir, comme avant.', 'Clover payment link not set up: pay at the counter, as before.', 'CLOVER_ECOMM_PRIVATE_KEY'));
  } else {
    out.push(hcoWebhookSecret()
      ? c('payment', 'hco_webhook', 'ok', `Webhook Hosted Checkout : ${base}/api/foodhub/webhooks/clover-checkout (secret configuré).`, `Hosted Checkout webhook: ${base}/api/foodhub/webhooks/clover-checkout (secret set).`)
      : c('payment', 'hco_webhook', 'warn', 'Secret du webhook de paiement Clover manquant : les paiements sont vus par la vérification toutes les 20 s seulement.', 'Clover payment webhook secret missing: payments are only seen by the 20-second check.', 'CLOVER_HCO_WEBHOOK_SECRET'));
    if (phone.payment.mode === 'counter') out.push(c('payment', 'pay_mode', 'info', 'Mode de paiement des lignes : au comptoir (le lien n’est pas offert).', 'Lines payment mode: at the counter (the link is not offered).'));
  }

  const ready = !out.some((x) => x.level === 'stop');
  return { at: new Date(now).toISOString(), ready, checks: out };
}
