// The phone call, end to end, as Twilio drives it:
//   incoming → greeting (Québec French; "For English, press 2" and "Para español, marque el 3" each in its own voice)
//   → each caller sentence → AI turn → say + listen again
//   → order placed and goodbye, or hand-off to a person (<Dial> the line's hand-off number / the kitchen phone).
// A turn the AI has not finished within ~9 s says "one moment" and continues on /voice/wait (Twilio's 15 s limit).
// Nobody answers the hand-off → the caller hears that we will call back, and the team chat gets the number to call.
// The same turn runs in the console ("Try the agent", and the call simulator), where an order is never sent anywhere;
// a call from a test number (FOODHUB_PHONE_TEST_CALLERS) is real but its order is a test too.
// A line with several kitchens (brand@kitchen groups) starts the call with no kitchen: the agent asks the caller and
// calls choose_kitchen; from then on the call works on that kitchen only (menu, hours, hand-off phone, Clover ticket).
// TAKATAK Phone (the Clover app, gate.ts) is checked once when the call comes in: refused, the call goes to a person.
import { getCatalog } from '../catalog';
import { featureOn } from '../expansion/features';
import { postToChat } from '../notify';
import { phoneAiUsable } from './ai-health';
import { runAgentTurn, phoneAgentConfigured } from './agent';
import { buildPhoneMenu, noKitchenMenu } from './cart';
import { linePhoneGate, phoneGateNote } from './gate';
import { endCall, getCall, isTestCaller, markAiEnded, maskNumber, saveCall, say, type PhoneCall, type PhoneLang, type TurnReply } from './calls';
import { meterEndedCall } from './metering';
import { languageRequest, LANG_DIGIT } from './ivr/words';
import { getPhoneSettings, isMultiKitchen, kitchenView, lineForNumber, type PhoneLine, type PhoneSettings } from './settings';
import { personaFor } from './style';
import { dialXml, gatherInner, gatherXml, GREETING, LANG_OFFER, NO_AGENT, NOBODY, sayXml, twiml, VOICE_PATH, WAIT } from './twilio';
import { hintsForLang } from './voices';

const TURN_BUDGET_MS = 9_000;
const SILENT_BYE = {
  fr: 'Je ne vous entends pas. N’hésitez pas à nous rappeler. Bonne journée !',
  en: 'I can’t hear you. Please feel free to call us back. Goodbye!',
  es: 'No le escucho. No dude en volver a llamarnos. ¡Hasta luego!',
};
const STILL_HERE = { fr: 'Je suis toujours là. Qu’est-ce que je peux vous préparer ?', en: 'I’m still here. What can I get for you?', es: 'Aquí sigo. ¿Qué le preparamos?' };
const inflight = (): Map<string, Promise<TurnReply>> => {
  const g = globalThis as unknown as { __fhPhoneTurns?: Map<string, Promise<TurnReply>> };
  g.__fhPhoneTurns ??= new Map();
  return g.__fhPhoneTurns;
};

async function handoffNumber(line: PhoneLine): Promise<string | null> {
  if (line.handoffNumber) return line.handoffNumber;
  return (await getCatalog()).locations.find((l) => l.code === line.locationCode)?.phone ?? null;
}

/** The kitchen side of a line for this call: the line itself (one kitchen), the caller's kitchen, or null (not chosen yet). */
export function callKitchen(line: PhoneLine, call: Pick<PhoneCall, 'locationCode'>): PhoneLine | null {
  if (!isMultiKitchen(line)) return line;
  return call.locationCode ? kitchenView(line, call.locationCode) : null;
}

/** The voices of this call: the ON2GO menu's when the call came from it (no voice change mid-call), else the line settings'. */
export function callVoices(call: Pick<PhoneCall, 'voices'> | null | undefined, settings: PhoneSettings): PhoneSettings {
  return call?.voices ? { ...settings, ...call.voices } : settings;
}

/**
 * The call's line as configured (`line`, every kitchen) and as worked now (`work`: the caller's kitchen, or the whole
 * line while a multi-kitchen line waits for the caller's choice).
 */
async function lineOf(call: PhoneCall): Promise<{ line: PhoneLine; work: PhoneLine; kitchen: PhoneLine | null; settings: PhoneSettings } | null> {
  const settings = callVoices(call, await getPhoneSettings());
  const line = settings.lines.find((l) => l.id === call.lineId);
  if (!line) return null;
  const kitchen = callKitchen(line, call);
  return { line, work: kitchen ?? line, kitchen, settings };
}

/** Speech hints of a conversation: the line's brands, plus the language words (only in the caller's language). */
export function lineHints(line: PhoneLine, lang: PhoneLang): string {
  return hintsForLang(['English', 'español', 'français', ...line.brands].join(', '), lang);
}

/** What Twilio must do with the agent's reply. */
async function render(call: PhoneCall, reply: TurnReply, line: PhoneLine, settings: PhoneSettings): Promise<Response> {
  if (reply.next === 'listen') return twiml(gatherXml(reply.say, settings, reply.lang, `${VOICE_PATH}/turn`, lineHints(line, reply.lang)));
  if (reply.next === 'hangup') {
    await endCall(call.id);
    return twiml(`${sayXml(reply.say, settings, reply.lang)}<Hangup/>`);
  }
  // From here a person takes over (or nobody can): the AI's minutes stop now (hold and the person are never billed).
  if (call.aiStartedAt && !call.aiEndedAt) {
    const at = new Date().toISOString();
    call = { ...call, aiEndedAt: at };
    await markAiEnded(call.id, at);
  }
  const to = await handoffNumber(line);
  if (!to) {
    await missedHandoff(call, line, 'no hand-off number');
    // An order confirmation said in this turn is still heard before "nobody is available".
    return twiml(`${sayXml([reply.confirm, NOBODY[reply.lang]].filter(Boolean).join(' '), settings, reply.lang)}<Hangup/>`);
  }
  await saveCall({ ...say(call, 'system', `Transferred to ${maskNumber(to)}${call.handoffReason ? ` — ${call.handoffReason}` : ''}`), status: 'handoff' });
  return twiml(`${sayXml(reply.say, settings, reply.lang)}${dialXml(to, line.number, `${VOICE_PATH}/dial-done`)}`);
}

async function missedHandoff(call: PhoneCall, line: PhoneLine, why: string): Promise<void> {
  await saveCall({ ...say(call, 'system', `Nobody took the call (${why}) — call the customer back`), status: 'handoff_missed' });
  await postToChat({
    title: `📞 ${line.name}: call back ${call.from && call.from !== 'anonymous' ? call.from : '(hidden number)'}`,
    text: `The AI phone agent handed a call to a person and nobody answered (${why}).${call.handoffReason ? ` Reason: ${call.handoffReason}.` : ''}${call.cart.length ? ` Cart: ${call.cart.map((l) => `${l.quantity}× ${l.name}`).join(', ')}.` : ''}`,
    severity: 'warning',
  }, { purpose: 'phone_handoff_missed' });
}

/** The direct line's greeting: Québec French, then the English and Spanish options, each in its own voice. */
function greetingXml(line: PhoneLine, settings: PhoneSettings): string {
  const persona = personaFor(settings.persona, settings.voiceFr);
  const inner = `${sayXml(GREETING.fr(line.name, persona), settings, 'fr')}${sayXml(LANG_OFFER.en, settings, 'en')}${sayXml(LANG_OFFER.es, settings, 'es')}`;
  return gatherInner(inner, settings, 'fr', `${VOICE_PATH}/turn`, lineHints(line, 'fr'));
}

/** Twilio "A call comes in". `simulated`: the console call simulator (nothing is sent, no order fired). */
export async function startCall(params: URLSearchParams, opts: { simulated?: boolean } = {}): Promise<Response> {
  const sid = params.get('CallSid') || `call-${Date.now()}`;
  const from = params.get('From') || 'anonymous';
  const to = params.get('To') || '';
  const line = await lineForNumber(to);
  const settings = await getPhoneSettings();
  if (!line) return twiml(`${sayXml(NOBODY.fr, settings, 'fr')}<Hangup/>`);
  const test = opts.simulated || isTestCaller(from);
  const call: PhoneCall = {
    // A multi-kitchen line starts with no kitchen: the agent asks the caller (choose_kitchen).
    id: sid, lineId: line.id, lineName: line.name, locationCode: isMultiKitchen(line) ? '' : line.locationCode, brands: line.brands, from, to, lang: 'fr', status: 'active',
    startedAt: new Date().toISOString(), turns: 0, transcript: [], messages: [], cart: [], customer: {}, updatedAt: new Date().toISOString(), ...(test ? { simulated: true } : {}),
  };
  // Switch off, line off, no AI key, the AI paused, or TAKATAK Phone not active for the kitchen's Clover merchant:
  // never lose the call — straight to a person (the line's hand-off number, else the kitchen phone).
  const aiOk = phoneAgentConfigured() && (await phoneAiUsable());
  let why = !line.enabled ? 'line turned off' : !phoneAgentConfigured() ? 'ANTHROPIC_API_KEY not set' : !aiOk ? 'phone AI paused (it was failing)' : !(await featureOn('phone')) ? 'phone ordering turned off' : '';
  if (!why) {
    // The Clover app check: none at all without CLOVER_PHONE_APP_ID, our own merchants always pass. It answers within
    // 2.5 s even when Clover hangs, and lets a live call through on the grace rules (pos/clover-entitlement.ts).
    const gate = await linePhoneGate(line, 'call');
    if (!gate.ok) why = phoneGateNote(gate);
  }
  if (why) {
    const saved = await saveCall({ ...say(call, 'system', `AI agent not used (${why})`), handoffReason: why });
    return render(saved, { say: NO_AGENT.fr, next: 'handoff', lang: 'fr' }, line, settings);
  }
  const greeting = `${GREETING.fr(line.name, personaFor(settings.persona, settings.voiceFr))} ${LANG_OFFER.en} ${LANG_OFFER.es}`;
  // The AI answers from here: its minutes start (TAKATAK Phone bills the minutes the AI is on the line).
  await saveCall({ ...say(call, 'agent', greeting), aiStartedAt: new Date().toISOString() });
  return twiml(greetingXml(line, settings));
}

async function computeTurn(callId: string, text: string): Promise<TurnReply> {
  const call = await getCall(callId);
  if (!call) return { say: NOBODY.fr, next: 'hangup', lang: 'fr' };
  const ls = await lineOf(call);
  if (!ls) return { say: NO_AGENT[call.lang], next: 'handoff', lang: call.lang };
  const menu = ls.kitchen ? await buildPhoneMenu(ls.kitchen) : noKitchenMenu();
  const started = new Date().toISOString();
  const r = await runAgentTurn(call, text, { line: ls.work, configured: ls.line, menu, settings: ls.settings, simulate: Boolean(call.simulated) });
  // The call may have moved on while the AI was thinking (the wait ran out and a person took it, or the caller hung up).
  // Never write the older copy back over it: that would erase the hand-off and the end of the AI's minutes. Only an
  // order this turn placed is kept on the call.
  const cur = await getCall(callId);
  if (cur && cur.status !== 'active') {
    await saveCall({ ...say(cur, 'system', 'Late AI turn not used (the call had already moved on)'), ...(r.call.orderId && !cur.orderId ? { orderId: r.call.orderId, orderNumber: r.call.orderNumber } : {}) });
    return r.reply;
  }
  await saveCall({ ...r.call, ...(cur?.aiEndedAt ? { aiEndedAt: cur.aiEndedAt } : {}), pending: { turn: r.call.turns, startedAt: started, reply: r.reply } });
  return r.reply;
}

/** Runs the AI turn, but answers Twilio within the budget: "one moment" + redirect when the AI is slower. */
async function turnWithBudget(call: PhoneCall, text: string, settings: PhoneSettings, before: PhoneLine): Promise<Response> {
  const job = computeTurn(call.id, text).finally(() => { if (inflight().get(call.id) === job) inflight().delete(call.id); });
  inflight().set(call.id, job);
  const reply = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), TURN_BUDGET_MS))]);
  if (!reply) return twiml(`${sayXml(WAIT[call.lang], settings, call.lang)}<Redirect method="POST">${VOICE_PATH}/wait?n=1</Redirect>`);
  // The reply is consumed here: the record saved (and used below) no longer carries it.
  const done = await saveCall({ ...((await getCall(call.id)) ?? call), pending: undefined });
  // The turn may have chosen the kitchen: a hand-off then rings that kitchen.
  return render(done, reply, (await lineOf(done))?.work ?? before, settings);
}

/** A low recognition confidence is passed to the AI so it confirms instead of guessing. */
export function withConfidence(speech: string, confidence: string | null): string {
  const c = Number(confidence);
  return speech && Number.isFinite(c) && c > 0 && c < 0.4 ? `${speech} [speech recognition unsure: confirm what matters]` : speech;
}

/**
 * A language switch on the ordering line. Keys 2 / 3 only answer the greeting (turn 0); later they answer the AI.
 * Words: any explicit request on the greeting ("English, I want a chicken"); later only a request said on its own.
 */
export function languageChoice(turns: number, digits: string, speech: string): { lang: PhoneLang; rest: string } | null {
  if (digits === '2' || digits === '3') return turns === 0 ? { lang: LANG_DIGIT[digits], rest: '' } : null;
  if (!speech) return null;
  const asked = languageRequest(speech);
  if (!asked) return null;
  return turns === 0 || !asked.rest ? asked : null;
}

/** Twilio <Gather> action: the caller said something (or pressed a key, or nothing). */
export async function callerTurn(params: URLSearchParams): Promise<Response> {
  const call = await getCall(params.get('CallSid') || '');
  const base = await getPhoneSettings();
  if (!call) return twiml(`${sayXml(NOBODY.fr, base, 'fr')}<Hangup/>`);
  const ls = await lineOf(call);
  const settings = callVoices(call, base);
  if (!ls) return twiml(`${sayXml(NOBODY[call.lang], settings, call.lang)}<Hangup/>`);
  const digits = params.get('Digits') || '';
  const speech = (params.get('SpeechResult') || '').trim();
  // Language choice: keys 2 / 3 on the greeting, or "English", "español" — no AI needed. The rest of the sentence goes
  // on to the AI. Mid-order, keys answer the AI ("how many?") and only a request said on its own switches.
  const asked = languageChoice(call.turns, digits, speech);
  if (asked && asked.lang !== call.lang) {
    const switched = await saveCall({ ...call, lang: asked.lang });
    if (asked.rest) return turnWithBudget(switched, asked.rest, settings, ls.work);
    const greeting = GREETING[asked.lang](ls.line.name, personaFor(settings.persona, settings.voiceFr));
    await saveCall(say(switched, 'agent', greeting));
    return twiml(gatherXml(greeting, settings, asked.lang, `${VOICE_PATH}/turn`, lineHints(ls.line, asked.lang)));
  }
  if (digits === '0') return render(await saveCall({ ...call, handoffReason: 'Caller pressed 0' }), { say: NO_AGENT[call.lang].replace(/^\S+\.\s*/, ''), next: 'handoff', lang: call.lang }, ls.work, settings);
  if (!speech && !digits) {
    const silent = call.transcript.slice(-2).every((t) => t.who === 'caller' && t.text === '(silence)');
    const updated = await saveCall(say(call, 'caller', '(silence)'));
    if (silent) return render(updated, { say: SILENT_BYE[call.lang], next: 'hangup', lang: call.lang }, ls.work, settings);
    return twiml(gatherXml(STILL_HERE[call.lang], settings, call.lang, `${VOICE_PATH}/turn`, lineHints(ls.line, call.lang)));
  }
  return turnWithBudget(call, speech ? withConfidence(speech, params.get('Confidence')) : `(pressed ${digits})`, settings, ls.work);
}

/** Twilio <Redirect> after "one moment": the AI turn is still running (here, or already saved by another instance). */
export async function waitTurn(params: URLSearchParams, n: number): Promise<Response> {
  const base = await getPhoneSettings();
  const call = await getCall(params.get('CallSid') || '');
  if (!call) return twiml(`${sayXml(NOBODY.fr, base, 'fr')}<Hangup/>`);
  const settings = callVoices(call, base);
  const ls = await lineOf(call);
  if (!ls) return twiml(`${sayXml(NOBODY[call.lang], settings, call.lang)}<Hangup/>`);
  const job = inflight().get(call.id);
  const reply = job ? await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), TURN_BUDGET_MS))]) : (await getCall(call.id))?.pending?.reply ?? null;
  if (reply) {
    const done = await saveCall({ ...((await getCall(call.id)) ?? call), pending: undefined });
    return render(done, reply, (await lineOf(done))?.work ?? ls.work, settings);
  }
  if (n < 3 && job) return twiml(`<Pause length="1"/><Redirect method="POST">${VOICE_PATH}/wait?n=${n + 1}</Redirect>`);
  return render(call, { say: NO_AGENT[call.lang].replace(/^\S+\.\s*/, ''), next: 'handoff', lang: call.lang }, ls.work, settings);
}

/** Twilio <Dial> action: did a person take the call? */
export async function dialDone(params: URLSearchParams): Promise<Response> {
  const base = await getPhoneSettings();
  const call = await getCall(params.get('CallSid') || '');
  const status = params.get('DialCallStatus') || '';
  if (!call) return twiml('<Hangup/>');
  if (status === 'completed' || status === 'answered') {
    await endCall(call.id, 'handoff');
    return twiml('<Hangup/>');
  }
  const ls = await lineOf(call);
  if (ls) await missedHandoff(call, ls.work, `hand-off ${status || 'not answered'}`);
  await endCall(call.id, 'handoff_missed');
  return twiml(`${sayXml(NOBODY[call.lang], callVoices(call, base), call.lang)}<Hangup/>`);
}

/**
 * Twilio call status callback (the number's "Call status changes" URL). Returns the call ID once the call is over, so
 * the route meters its AI minutes after answering Twilio (meterEndedCall); null otherwise.
 */
export async function callStatus(params: URLSearchParams): Promise<string | null> {
  const id = params.get('CallSid') || '';
  if (!id) return null;
  const st = params.get('CallStatus') || '';
  if (!['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(st)) return null;
  // Twilio's own duration ("0" is a real answer: the call was never answered).
  const raw = params.get('CallDuration');
  const duration = raw !== null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  const ended = await endCall(id, undefined, duration);
  return ended ? id : null;
}

export { meterEndedCall };

/** Console "Try the agent": same agent, same menu and rules — orders are never sent anywhere. */
export async function simulateTurn(lineId: string, sessionId: string | null, text: string): Promise<{ call: PhoneCall; reply: TurnReply }> {
  const settings = await getPhoneSettings();
  const line = settings.lines.find((l) => l.id === lineId);
  if (!line) throw new Error('Unknown phone line.');
  let call = sessionId ? await getCall(sessionId) : null;
  if (call && !call.simulated) throw new Error('Not a test session.');
  if (!call) {
    const greeting = GREETING.fr(line.name, personaFor(settings.persona, settings.voiceFr));
    call = await saveCall(say({
      id: `sim-${Date.now().toString(36)}`, lineId: line.id, lineName: line.name, locationCode: isMultiKitchen(line) ? '' : line.locationCode, brands: line.brands, from: 'console', to: line.number, lang: 'fr',
      status: 'active', startedAt: new Date().toISOString(), turns: 0, transcript: [], messages: [], cart: [], customer: {}, simulated: true, updatedAt: new Date().toISOString(),
    }, 'agent', greeting));
    if (!text.trim()) return { call, reply: { say: greeting, next: 'listen', lang: 'fr' } };
  }
  if (call.status !== 'active') throw new Error('This test call has ended — start a new one.');
  // The same language rules as a real call: "English", "español", or keys 2 / 3 typed as the first words.
  const key = text.trim();
  const asked = /^[23]$/.test(key) ? languageChoice(call.turns, key, '') : languageChoice(call.turns, '', key);
  if (asked && asked.lang !== call.lang) {
    call = await saveCall(say({ ...call, lang: asked.lang }, 'caller', text));
    if (!asked.rest) {
      const greeting = GREETING[asked.lang](line.name, personaFor(settings.persona, settings.voiceFr));
      call = await saveCall(say(call, 'agent', greeting));
      return { call, reply: { say: greeting, next: 'listen', lang: asked.lang } };
    }
    text = asked.rest;
  }
  const kitchen = callKitchen(line, call);
  const menu = kitchen ? await buildPhoneMenu(kitchen) : noKitchenMenu();
  const r = await runAgentTurn(call, text, { line: kitchen ?? line, configured: line, menu, settings, simulate: true });
  let saved = await saveCall(r.call);
  if (r.reply.next !== 'listen') saved = (await endCall(saved.id, r.reply.next === 'handoff' ? 'handoff' : undefined)) ?? saved;
  return { call: saved, reply: r.reply };
}
