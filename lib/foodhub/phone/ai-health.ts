// Health of the phone AI (Anthropic): a circuit breaker so a dead key, an empty credit balance or a wrong model never
// makes every caller hear "je n'ai pas compris" while each turn fails.
//   - fatal errors (they repeat for every caller): 401 authentication, 403 permission, 404 model, 400 bad request
//     (credit balance too low is a 400), 402 billing → the breaker opens for FOODHUB_PHONE_AI_PAUSE_MIN (10) minutes;
//   - transient errors (429 rate limit, 5xx / 529 overloaded, network, timeout): 3 within 5 minutes → 2 minutes.
// While open, the ON2GO menu works in keypad mode (greeting "Pour le français, faites le 1"), the ordering line goes to a
// person, and nothing is sent to the AI. The team chat gets ONE critical alert per trip. State in fh_kv (shared by every
// request of the server, survives a restart).
import Anthropic from '@anthropic-ai/sdk';
import { postToChat } from '../notify';
import { getRepo } from '../repo';

const KV = 'phone_ai_health_v1';
const TRANSIENT_WINDOW_MS = 5 * 60_000;
const TRANSIENT_TRIP = 3;

export type AiErrorKind = 'fatal' | 'transient';

export interface AiHealth {
  /** Breaker open until (epoch ms); 0 = closed. */
  openUntil: number;
  kind?: AiErrorKind;
  reason?: string;
  at?: number;
  /** Recent transient failures (epoch ms). */
  transient: number[];
  /** Trip already announced in the team chat (its `at`). */
  alertedFor?: number;
  lastOkAt?: number;
}

const EMPTY: AiHealth = { openUntil: 0, transient: [] };

const pauseMs = () => Math.max(1, Number(process.env.FOODHUB_PHONE_AI_PAUSE_MIN) || 10) * 60_000;

/** What kind of failure: the SDK's typed errors first, then the HTTP status / error type. */
export function classifyAiError(e: unknown): { kind: AiErrorKind; reason: string } {
  const msg = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number })?.status;
  const type = String((e as { error?: { error?: { type?: string } } })?.error?.error?.type ?? (e as { type?: string })?.type ?? '');
  const short = msg.replace(/\s+/g, ' ').slice(0, 160);
  if (e instanceof Anthropic.AuthenticationError || status === 401) return { kind: 'fatal', reason: `authentication refused (401): ${short}` };
  if (e instanceof Anthropic.PermissionDeniedError || status === 403) return { kind: 'fatal', reason: `permission denied (403): ${short}` };
  if (e instanceof Anthropic.NotFoundError || status === 404) return { kind: 'fatal', reason: `model or endpoint not found (404): ${short}` };
  if (status === 402 || type === 'billing_error' || /credit balance|billing/i.test(msg)) return { kind: 'fatal', reason: `billing / credit (${status ?? 'billing'}): ${short}` };
  if (e instanceof Anthropic.BadRequestError || status === 400) return { kind: 'fatal', reason: `request refused (400): ${short}` };
  if (e instanceof Anthropic.RateLimitError || status === 429) return { kind: 'transient', reason: `rate limited (429): ${short}` };
  if (e instanceof Anthropic.InternalServerError || (status && status >= 500)) return { kind: 'transient', reason: `server error (${status}): ${short}` };
  return { kind: 'transient', reason: `network / timeout: ${short}` };
}

export async function getAiHealth(): Promise<AiHealth> {
  const raw = await getRepo().getKv<AiHealth>(KV).catch(() => null);
  return { ...EMPTY, ...(raw ?? {}), transient: Array.isArray(raw?.transient) ? raw!.transient : [] };
}

async function save(h: AiHealth): Promise<void> {
  await getRepo().setKv(KV, h).catch(() => undefined);
}

/** The AI key is set and the breaker is closed. */
export async function phoneAiUsable(now = Date.now()): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  const h = await getAiHealth();
  return !(h.openUntil && now < h.openUntil);
}

/** Records a failed AI request; trips the breaker (and alerts the team once) when it should. Never throws. */
export async function noteAiFailure(e: unknown, now = Date.now()): Promise<{ tripped: boolean; kind: AiErrorKind; reason: string }> {
  const c = classifyAiError(e);
  try {
    const h = await getAiHealth();
    const recent = [...h.transient.filter((t) => now - t < TRANSIENT_WINDOW_MS), now];
    let next: AiHealth = { ...h, transient: c.kind === 'transient' ? recent : h.transient };
    const trip = c.kind === 'fatal' || recent.length >= TRANSIENT_TRIP;
    if (trip && !(h.openUntil && now < h.openUntil)) {
      next = { ...next, openUntil: now + (c.kind === 'fatal' ? pauseMs() : 2 * 60_000), kind: c.kind, reason: c.reason, at: now, transient: [] };
    }
    if (trip && next.at && next.alertedFor !== next.at) {
      next = { ...next, alertedFor: next.at };
      await save(next);
      await postToChat({
        title: '🤖 Phone AI paused — the ON2GO line runs on the keypad',
        text: `The AI (Anthropic) failed: ${c.reason}. For ${Math.round((next.openUntil - now) / 60_000)} min the menu uses the keypad and orders go to a person. Check the Anthropic key and credit, then Settings → AI phone → « Vérifier avant les tests ».`,
        severity: 'critical',
      }, { purpose: 'phone_ai_down' }).catch(() => undefined);
      return { tripped: true, ...c };
    }
    await save(next);
    return { tripped: trip, ...c };
  } catch {
    return { tripped: false, ...c };
  }
}

/** A request worked: transient failures start over (written only when something changes). */
export async function noteAiSuccess(now = Date.now()): Promise<void> {
  try {
    const h = await getAiHealth();
    if (!h.transient.length && h.lastOkAt && now - h.lastOkAt < 10 * 60_000) return;
    await save({ ...h, transient: [], lastOkAt: now });
  } catch { /* never blocks a call */ }
}

/** Owner action and tests: close the breaker. */
export async function resetAiHealth(): Promise<void> {
  await save({ ...EMPTY });
}
