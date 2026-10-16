// Console call simulator (dry run): plays a whole phone call through the REAL Twilio handlers — the ON2GO menu
// (ivr/engine.ts) or an AI ordering line (voice.ts) — with the caller's words or keys typed by the owner, and shows what
// the caller would hear at each step. Everything that would leave Food Hub (texts, emails, team chat, robo-calls) is
// recorded instead of sent (dry-run.ts); the call is flagged "simulated", so an order is never sent to Clover, the
// kitchen or a payment link, and tickets / platform references are not saved. Only the AI itself (Anthropic) is called
// for real when its key is set — that is what is being tested.
import crypto from 'node:crypto';
import { runDry, type DryRunSend } from '../../dry-run';
import { endCall } from '../calls';
import { getIvrSettings, ivrNumbers } from '../ivr/config';
import { endIvrCall } from '../ivr/records';
import { IVR_PATH, ivrDialDone, ivrStart, ivrTurn, ivrWait } from '../ivr/engine';
import { getPhoneSettings } from '../settings';
import { VOICE_PATH } from '../twilio';
import { callerTurn, dialDone, startCall, waitTurn } from '../voice';

export interface SimInput { speech?: string; digits?: string }
export interface SimStep {
  /** What the caller did to get here ("(call starts)", words, "(keys 2)", "(Twilio redirect)"). */
  caller: string;
  /** Sentences the caller hears, in order (recorded audio files are shown as "[audio]"). */
  said: string[];
  /** What happens next. */
  next: 'listen' | 'redirect' | 'dial' | 'voicemail' | 'hangup' | 'none';
  /** Masked number a <Dial> would ring. */
  dial?: string;
  /** Speech recognition of the <Gather>: language and model. */
  listen?: { language: string; model: string; hints: boolean };
}
export interface SimResult { callSid: string; target: string; steps: SimStep[]; sent: DryRunSend[]; ended: SimStep['next'] | 'max_steps' | 'no_more_input' }

const MAX_STEPS = 40;

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => unxml(tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? '');
const mask = (n: string) => (n.length <= 6 ? n : `${n.slice(0, 2)}${'•'.repeat(n.length - 6)}${n.slice(-4)}`);

/** Reads one TwiML answer: what is said, then what Twilio would do next. */
export function readTwiml(xml: string): { said: string[]; next: SimStep['next']; action?: string; redirect?: string; dial?: string; listen?: SimStep['listen'] } {
  const said: string[] = [];
  for (const m of xml.matchAll(/<Say\b[^>]*>([\s\S]*?)<\/Say>|<Play\b[^>]*>[\s\S]*?<\/Play>/g)) said.push(m[1] !== undefined ? unxml(m[1]).trim() : '[audio]');
  const gather = xml.match(/<Gather\b[^>]*>/)?.[0];
  if (gather) return { said, next: 'listen', action: attr(gather, 'action'), listen: { language: attr(gather, 'language'), model: attr(gather, 'speechModel'), hints: /\shints="/.test(gather) } };
  const redirect = xml.match(/<Redirect\b[^>]*>([\s\S]*?)<\/Redirect>/)?.[1];
  if (redirect) return { said, next: 'redirect', redirect: unxml(redirect).trim() };
  const dial = xml.match(/<Dial\b[^>]*>([\s\S]*?)<\/Dial>/);
  if (dial) return { said, next: 'dial', action: attr(dial[0].match(/<Dial\b[^>]*>/)![0], 'action'), dial: mask(unxml(dial[1]).trim()) };
  if (/<Record\b/.test(xml)) return { said, next: 'voicemail' };
  if (/<Hangup\s*\/>/.test(xml)) return { said, next: 'hangup' };
  return { said, next: 'none' };
}

/** The handler Twilio would call for a URL of ours (path + query). */
async function dispatch(url: string, params: URLSearchParams): Promise<Response | null> {
  const u = new URL(url, 'https://sim.local');
  const q = u.searchParams;
  const p = u.pathname;
  if (p === `${IVR_PATH}/turn`) return ivrTurn(params);
  if (p === `${IVR_PATH}/wait`) return ivrWait(params, Number(q.get('n')) || 1);
  if (p === `${IVR_PATH}/dial-done`) return ivrDialDone(params, q);
  if (p === `${VOICE_PATH}/turn`) return callerTurn(params);
  if (p === `${VOICE_PATH}/wait`) return waitTurn(params, Number(q.get('n')) || 1);
  if (p === `${VOICE_PATH}/dial-done`) return dialDone(params);
  return null;
}

export interface SimOptions {
  /** "ivr" = the ON2GO menu; otherwise the id of an AI ordering line. */
  target: string;
  /** Caller ID shown to the handlers (texts to it are recorded, never sent). Default: a fictional 555 number. */
  from?: string;
  inputs: SimInput[];
  /** What a <Dial> gets: answered (the call ends there) or nobody (the "nobody answered" path runs). */
  dial?: 'answered' | 'nobody';
}

/** Plays the call. Never sends anything; throws only on an unknown target. */
export async function simulateCall(opts: SimOptions): Promise<SimResult> {
  const callSid = `SIMCA${crypto.randomBytes(8).toString('hex')}`;
  const from = opts.from?.trim() || '+15555550123';
  let to = '';
  if (opts.target === 'ivr') {
    const s = await getIvrSettings();
    to = ivrNumbers(s)[0] ?? '';
  } else {
    const line = (await getPhoneSettings()).lines.find((l) => l.id === opts.target);
    if (!line) throw new Error('Unknown phone line.');
    to = line.number;
  }
  const base = { CallSid: callSid, From: from, To: to, AccountSid: 'ACsimulator', CallStatus: 'in-progress', Direction: 'inbound' };
  const ctx = { sent: [] as DryRunSend[] };
  const steps: SimStep[] = [];
  let ended: SimResult['ended'] = 'max_steps';
  await runDry(ctx, async () => {
    let res = opts.target === 'ivr' ? await ivrStart(new URLSearchParams(base), { simulated: true }) : await startCall(new URLSearchParams(base), { simulated: true });
    let caller = '(call starts)';
    const inputs = [...opts.inputs];
    for (let i = 0; i < MAX_STEPS; i++) {
      const r = readTwiml(await res.text());
      steps.push({ caller, said: r.said, next: r.next, ...(r.dial ? { dial: r.dial } : {}), ...(r.listen ? { listen: r.listen } : {}) });
      let url: string | undefined;
      let params = new URLSearchParams(base);
      if (r.next === 'listen' && r.action) {
        const input = inputs.shift();
        if (!input) { ended = 'no_more_input'; return; }
        const speech = String(input.speech ?? '').trim().slice(0, 500);
        const digits = String(input.digits ?? '').replace(/[^0-9*#]/g, '').slice(0, 30);
        params = new URLSearchParams({ ...base, ...(speech ? { SpeechResult: speech, Confidence: '0.9' } : {}), ...(digits ? { Digits: digits } : {}) });
        caller = speech || (digits ? `(keys ${digits})` : '(silence)');
        url = r.action;
      } else if (r.next === 'redirect' && r.redirect) {
        caller = '(Twilio continues)';
        url = r.redirect;
      } else if (r.next === 'dial' && opts.dial === 'nobody' && r.action) {
        params = new URLSearchParams({ ...base, DialCallStatus: 'no-answer' });
        caller = '(nobody answers)';
        url = r.action;
      } else {
        ended = r.next;
        return;
      }
      const next = await dispatch(url, params);
      if (!next) { ended = 'none'; return; }
      res = next;
    }
  });
  // The simulated call is closed (it never shows as an active call).
  await endIvrCall(callSid).catch(() => null);
  await endCall(callSid).catch(() => null);
  return { callSid, target: opts.target, steps, sent: ctx.sent, ended };
}
