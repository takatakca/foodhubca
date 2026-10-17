// Low-credit alert for the phone: "one ping, not a stream".
// When the AI provider (Anthropic: credit balance too low / billing error, seen by the circuit breaker in ai-health.ts)
// or Twilio (balance too low / account suspended, seen when a text or a call is sent) says it is out of credit, the
// owner gets ONE alert for the incident — the team chat, plus an email to FOODHUB_OWNER_EMAIL when email is set up
// (the channels that already exist). Nothing more is sent once it was delivered, however many calls fail. A send that
// reached nobody (chat down, no email) is tried again on the next failure, at most once per 10 minutes. The alert
// re-arms only once the provider works again (the next successful AI request / text), so a later incident pings again.
// The fallback is named in the alert: while the AI is out, the ordering line goes to a person and the ON2GO menu runs on
// the keypad. A line with no hand-off number (and no kitchen phone) has no person to go to: the alert names it.
// State in fh_kv, ONE key per provider (a write for Twilio never touches Anthropic's incident). The incident is saved
// as open BEFORE the ping is claimed, so a failed write never burns the ping (recovery can always re-arm it); each
// send is claimed with one atomic insert per incident and 10-minute slot, so two servers never both send it.
import { dryRun } from '../dry-run';
import { normalizeEmail, emailConfigured, postToChat, sendEmail } from '../notify';
import { getRepo } from '../repo';

export type CreditProvider = 'anthropic' | 'twilio';

const PROVIDERS: CreditProvider[] = ['anthropic', 'twilio'];
const KV = (p: CreditProvider) => `phone_credit_alert_v2:${p}`;
const SEND_CLAIM = (p: CreditProvider, incident: number, slot: number) => `phone_credit_alert_send:${p}:${incident}:${slot}`;
/** A send that reached nobody is tried again at most this often. */
const RETRY_MS = 10 * 60_000;

export interface CreditIncident {
  /** An incident is open (no other ping until recovery once alerted). */
  open: boolean;
  /** Incident number (goes up at each recovery: re-arms the ping). */
  incident: number;
  since?: string;
  reason?: string;
  /** The alert reached the owner (the chat or the email took it). Absent while open = tried again. */
  alertedAt?: string;
  recoveredAt?: string;
}
type CreditState = Partial<Record<CreditProvider, CreditIncident>>;

const NAME: Record<CreditProvider, string> = { anthropic: 'Anthropic (IA / AI)', twilio: 'Twilio' };

/** Twilio's answer means "no money left" (not a bad number, not a bad key). */
export function twilioLowBalance(status: number, body: { code?: unknown; message?: unknown } | null | undefined): boolean {
  const msg = String(body?.message ?? '');
  // 20005: account not active (suspended, usually for an unpaid balance).
  if (Number(body?.code) === 20005) return true;
  return (status === 400 || status === 401 || status === 402 || status === 403)
    && /insufficient (?:funds|balance)|balance (?:is )?(?:too )?low|low balance|out of (?:credit|funds)|account (?:is )?suspended|recharge|top[- ]?up/i.test(msg);
}

async function readOne(p: CreditProvider): Promise<CreditIncident | null> {
  return (await getRepo().getKv<CreditIncident>(KV(p))) ?? null;
}

/**
 * Turned-on ordering lines with no person to hand a call to: no hand-off number on the line and no kitchen phone
 * (Settings → Business) for one of its kitchens. Such a call hears "nobody is available" and is hung up.
 */
export async function linesWithoutHandoff(): Promise<string[]> {
  try {
    const [{ getPhoneSettings, lineKitchens }, { getCatalog }] = await Promise.all([import('./settings'), import('../catalog')]);
    const [settings, catalog] = await Promise.all([getPhoneSettings(), getCatalog()]);
    const phoneOf = (code: string) => catalog.locations.find((l) => l.code === code)?.phone;
    return settings.lines
      .filter((l) => l.enabled && !l.handoffNumber && lineKitchens(l).some((k) => !phoneOf(k.locationCode)))
      .map((l) => l.name);
  } catch {
    return [];
  }
}

function message(p: CreditProvider, reason: string, deadLines: string[]) {
  const title = p === 'anthropic'
    ? 'Phone AI paused — crédit IA épuisé · AI credit too low: Recharger les crédits / Top up'
    : 'Téléphone — solde Twilio trop bas · Twilio balance too low: Recharger les crédits / Top up';
  const dead = deadLines.join(', ');
  const fr = p === 'anthropic'
    ? `L’IA du téléphone (Anthropic) n’a plus de crédit (${reason}). Action : rechargez les crédits Anthropic (console Anthropic → Billing). En attendant, la ligne de commande passe à une personne et le menu ON2GO fonctionne au clavier.${deadLines.length ? ` ATTENTION, aucun repli pour : ${dead} — pas de numéro de transfert ni de téléphone de cuisine, les appels y sont raccrochés (« personne n’est disponible ») et seul le numéro à rappeler arrive dans le chat. Ajoutez un numéro de transfert (Réglages → Téléphone IA).` : ' Rien n’est perdu.'} L’IA reprend seule dès que le crédit revient.`
    : `Twilio refuse faute de solde (${reason}). Action : rechargez le compte Twilio (console Twilio → Billing). En attendant, les textos (lien de paiement) ne partent pas : le paiement se fait au comptoir. Sans solde, Twilio peut aussi couper les appels entrants.`;
  const en = p === 'anthropic'
    ? `The phone AI (Anthropic) is out of credit (${reason}). Action: top up the Anthropic credits (Anthropic console → Billing). Meanwhile the ordering line goes to a person and the ON2GO menu runs on the keypad.${deadLines.length ? ` WARNING, no fallback for: ${dead} — no hand-off number and no kitchen phone, so their calls are hung up ("nobody is available") and only the number to call back reaches the chat. Add a hand-off number (Settings → AI phone).` : ' Nothing is lost.'} The AI comes back by itself once credit is back.`
    : `Twilio refuses for lack of balance (${reason}). Action: top up the Twilio account (Twilio console → Billing). Meanwhile texts (payment links) do not go out: payment is taken at the counter. With no balance Twilio may also stop incoming calls.`;
  return { title, fr, en };
}

/**
 * The provider says it is out of credit. Sends the ONE alert of this incident (true: a channel took it) or nothing
 * (false: already delivered, a dry run, another server is sending it in this 10-minute slot, or nobody took it — then
 * the next failure tries again). Never throws.
 */
export async function noteLowCredit(p: CreditProvider, reason: string, now = Date.now()): Promise<boolean> {
  if (dryRun()) return false;
  try {
    const repo = getRepo();
    const at = new Date(now).toISOString();
    const why = reason.slice(0, 200);
    let cur = await readOne(p);
    // Saved as open FIRST: whatever happens next, the incident exists and recovery re-arms the ping.
    if (!cur?.open) {
      cur = { open: true, incident: cur?.incident ?? 0, since: at, reason: why };
      await repo.setKv(KV(p), cur);
    }
    if (cur.alertedAt) return false; // one ping per incident
    if (!(await repo.claimKv(SEND_CLAIM(p, cur.incident, Math.floor(now / RETRY_MS)), { at }))) return false; // another server is on it
    const m = message(p, cur.reason || why, p === 'anthropic' ? await linesWithoutHandoff() : []);
    const chat = await postToChat({ title: m.title, text: `${m.fr}\n${m.en}`, severity: 'critical' }, { purpose: `phone_credit_low_${p}` }).catch(() => null);
    let delivered = Boolean(chat?.ok);
    const owner = normalizeEmail(process.env.FOODHUB_OWNER_EMAIL);
    if (owner && emailConfigured()) {
      const mail = await sendEmail({ to: owner, subject: `${NAME[p]} : Recharger les crédits · Top up`, text: `${m.fr}\n\n${m.en}` }, { purpose: `phone_credit_low_${p}` }).catch(() => null);
      delivered = delivered || Boolean(mail?.ok);
    }
    if (!delivered) return false;
    const latest = await readOne(p).catch(() => null);
    if (latest?.open && latest.incident === cur.incident) await repo.setKv(KV(p), { ...latest, alertedAt: at }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** The provider works again: the incident is closed and the next one will ping. One read when nothing is open. Never throws. */
export async function noteCreditRecovered(p: CreditProvider, now = Date.now()): Promise<boolean> {
  try {
    const cur = await readOne(p);
    if (!cur?.open) return false;
    await getRepo().setKv(KV(p), { open: false, incident: cur.incident + 1, recoveredAt: new Date(now).toISOString() });
    return true;
  } catch {
    return false;
  }
}

export async function creditIncidents(): Promise<CreditState> {
  const out: CreditState = {};
  for (const p of PROVIDERS) {
    const v = await readOne(p).catch(() => null);
    if (v) out[p] = v;
  }
  return out;
}
