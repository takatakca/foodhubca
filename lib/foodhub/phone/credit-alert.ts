// Low-credit alert for the phone: "one ping, not a stream".
// When the AI provider (Anthropic: credit balance too low / billing error, seen by the circuit breaker in ai-health.ts)
// or Twilio (balance too low / account suspended, seen when a text or a call is sent) says it is out of credit, the
// owner gets ONE alert for the incident — the team chat, plus an email to FOODHUB_OWNER_EMAIL when email is set up
// (the channels that already exist). Nothing more is sent while the incident lasts, however many calls fail. The alert
// re-arms only once the provider works again (the next successful AI request / text), so a later incident pings again.
// The fallback is already in place and named in the alert: while the AI is out, the ordering line goes to a person and
// the ON2GO menu runs on the keypad — never a dead line.
// State in fh_kv (shared by every request); the ping itself is claimed with one atomic insert per incident, so two
// servers never both send it.
import { dryRun } from '../dry-run';
import { normalizeEmail, emailConfigured, postToChat, sendEmail } from '../notify';
import { getRepo } from '../repo';

export type CreditProvider = 'anthropic' | 'twilio';

const KV = 'phone_credit_alert_v1';
const CLAIM = (p: CreditProvider, incident: number) => `phone_credit_alert_claim:${p}:${incident}`;

export interface CreditIncident {
  /** An incident is open (alerted once; no other ping until recovery). */
  open: boolean;
  /** Incident number (goes up at each recovery: re-arms the ping). */
  incident: number;
  since?: string;
  reason?: string;
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

async function readState(): Promise<CreditState> {
  return (await getRepo().getKv<CreditState>(KV).catch(() => null)) ?? {};
}

function message(p: CreditProvider, reason: string) {
  const title = p === 'anthropic'
    ? 'Phone AI paused — crédit IA épuisé · AI credit too low: Recharger les crédits / Top up'
    : 'Téléphone — solde Twilio trop bas · Twilio balance too low: Recharger les crédits / Top up';
  const fr = p === 'anthropic'
    ? `L’IA du téléphone (Anthropic) n’a plus de crédit (${reason}). Action : rechargez les crédits Anthropic (console Anthropic → Billing). En attendant, rien n’est perdu : la ligne de commande passe à une personne et le menu ON2GO fonctionne au clavier. L’IA reprend seule dès que le crédit revient.`
    : `Twilio refuse faute de solde (${reason}). Action : rechargez le compte Twilio (console Twilio → Billing). En attendant, les textos (lien de paiement) ne partent pas : le paiement se fait au comptoir. Sans solde, Twilio peut aussi couper les appels entrants.`;
  const en = p === 'anthropic'
    ? `The phone AI (Anthropic) is out of credit (${reason}). Action: top up the Anthropic credits (Anthropic console → Billing). Meanwhile nothing is lost: the ordering line goes to a person and the ON2GO menu runs on the keypad. The AI comes back by itself once credit is back.`
    : `Twilio refuses for lack of balance (${reason}). Action: top up the Twilio account (Twilio console → Billing). Meanwhile texts (payment links) do not go out: payment is taken at the counter. With no balance Twilio may also stop incoming calls.`;
  return { title, fr, en };
}

/**
 * The provider says it is out of credit. Sends the ONE alert of this incident (true) or nothing (false: already
 * alerted, a dry run, or another server sent it). Never throws.
 */
export async function noteLowCredit(p: CreditProvider, reason: string, now = Date.now()): Promise<boolean> {
  if (dryRun()) return false;
  try {
    const st = await readState();
    const cur: CreditIncident = st[p] ?? { open: false, incident: 0 };
    if (cur.open) return false; // one ping per incident
    if (!(await getRepo().claimKv(CLAIM(p, cur.incident), { at: new Date(now).toISOString() }))) return false; // another server pinged
    const at = new Date(now).toISOString();
    await getRepo().setKv(KV, { ...(await readState()), [p]: { ...cur, open: true, since: at, alertedAt: at, reason: reason.slice(0, 200) } });
    const m = message(p, reason.slice(0, 200));
    await postToChat({ title: m.title, text: `${m.fr}\n${m.en}`, severity: 'critical' }, { purpose: `phone_credit_low_${p}` }).catch(() => undefined);
    const owner = normalizeEmail(process.env.FOODHUB_OWNER_EMAIL);
    if (owner && emailConfigured()) {
      await sendEmail({ to: owner, subject: `${NAME[p]} : Recharger les crédits · Top up`, text: `${m.fr}\n\n${m.en}` }, { purpose: `phone_credit_low_${p}` }).catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}

/** The provider works again: the incident is closed and the next one will ping. Cheap when nothing is open. Never throws. */
export async function noteCreditRecovered(p: CreditProvider, now = Date.now()): Promise<boolean> {
  try {
    const st = await readState();
    const cur = st[p];
    if (!cur?.open) return false;
    await getRepo().setKv(KV, { ...st, [p]: { open: false, incident: cur.incident + 1, recoveredAt: new Date(now).toISOString() } });
    return true;
  } catch {
    return false;
  }
}

export async function creditIncidents(): Promise<CreditState> {
  return readState();
}
