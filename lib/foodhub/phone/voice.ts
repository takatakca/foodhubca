// The phone call, end to end, as Twilio drives it:
//   incoming → greeting (French, "press 2 / say English") → each caller sentence → AI turn → say + listen again
//   → order placed and goodbye, or hand-off to a person (<Dial> the line's hand-off number / the kitchen phone).
// A turn the AI has not finished within ~9 s says "one moment" and continues on /voice/wait (Twilio's 15 s limit).
// Nobody answers the hand-off → the caller hears that we will call back, and the team chat gets the number to call.
// The same turn runs in the console ("Try the agent"), where an order is never sent to the kitchen.
import { getCatalog } from '../catalog';
import { featureOn } from '../expansion/features';
import { postToChat } from '../notify';
import { runAgentTurn, phoneAgentConfigured } from './agent';
import { buildPhoneMenu } from './cart';
import { endCall, getCall, maskNumber, saveCall, say, type PhoneCall, type TurnReply } from './calls';
import { getPhoneSettings, lineForNumber, type PhoneLine, type PhoneSettings } from './settings';
import { dialXml, gatherXml, GREETING, NO_AGENT, NOBODY, sayXml, twiml, VOICE_PATH, WAIT } from './twilio';

const TURN_BUDGET_MS = 9_000;
const inflight = (): Map<string, Promise<TurnReply>> => {
  const g = globalThis as unknown as { __fhPhoneTurns?: Map<string, Promise<TurnReply>> };
  g.__fhPhoneTurns ??= new Map();
  return g.__fhPhoneTurns;
};

async function handoffNumber(line: PhoneLine): Promise<string | null> {
  if (line.handoffNumber) return line.handoffNumber;
  return (await getCatalog()).locations.find((l) => l.code === line.locationCode)?.phone ?? null;
}

async function lineOf(call: PhoneCall): Promise<{ line: PhoneLine; settings: PhoneSettings } | null> {
  const settings = await getPhoneSettings();
  const line = settings.lines.find((l) => l.id === call.lineId);
  return line ? { line, settings } : null;
}

function hints(line: PhoneLine): string {
  return ['English', 'anglais', ...line.brands].join(', ');
}

/** What Twilio must do with the agent's reply. */
async function render(call: PhoneCall, reply: TurnReply, line: PhoneLine, settings: PhoneSettings): Promise<Response> {
  if (reply.next === 'listen') return twiml(gatherXml(reply.say, settings, reply.lang, `${VOICE_PATH}/turn`, hints(line)));
  if (reply.next === 'hangup') {
    await endCall(call.id);
    return twiml(`${sayXml(reply.say, settings, reply.lang)}<Hangup/>`);
  }
  const to = await handoffNumber(line);
  if (!to) {
    await missedHandoff(call, line, 'no hand-off number');
    return twiml(`${sayXml(NOBODY[reply.lang], settings, reply.lang)}<Hangup/>`);
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

/** Twilio "A call comes in". */
export async function startCall(params: URLSearchParams): Promise<Response> {
  const sid = params.get('CallSid') || `call-${Date.now()}`;
  const from = params.get('From') || 'anonymous';
  const to = params.get('To') || '';
  const line = await lineForNumber(to);
  const settings = await getPhoneSettings();
  if (!line) return twiml(`${sayXml(NOBODY.fr, settings, 'fr')}<Hangup/>`);
  const call: PhoneCall = {
    id: sid, lineId: line.id, lineName: line.name, locationCode: line.locationCode, brands: line.brands, from, to, lang: 'fr', status: 'active',
    startedAt: new Date().toISOString(), turns: 0, transcript: [], messages: [], cart: [], customer: {}, updatedAt: new Date().toISOString(),
  };
  // Switch off, line off or no AI key: never lose the call — straight to a person.
  if (!line.enabled || !(await featureOn('phone')) || !phoneAgentConfigured()) {
    const why = !line.enabled ? 'line turned off' : !phoneAgentConfigured() ? 'ANTHROPIC_API_KEY not set' : 'phone ordering turned off';
    const saved = await saveCall({ ...say(call, 'system', `AI agent not used (${why})`), handoffReason: why });
    return render(saved, { say: NO_AGENT.fr, next: 'handoff', lang: 'fr' }, line, settings);
  }
  const greeting = GREETING.fr(line.name);
  await saveCall(say(call, 'agent', greeting));
  return twiml(gatherXml(greeting, settings, 'fr', `${VOICE_PATH}/turn`, hints(line)));
}

async function computeTurn(callId: string, text: string): Promise<TurnReply> {
  const call = await getCall(callId);
  if (!call) return { say: NOBODY.fr, next: 'hangup', lang: 'fr' };
  const ls = await lineOf(call);
  if (!ls) return { say: NO_AGENT[call.lang], next: 'handoff', lang: call.lang };
  const menu = await buildPhoneMenu(ls.line);
  const started = new Date().toISOString();
  const r = await runAgentTurn(call, text, { line: ls.line, menu, settings: ls.settings, simulate: Boolean(call.simulated) });
  await saveCall({ ...r.call, pending: { turn: r.call.turns, startedAt: started, reply: r.reply } });
  return r.reply;
}

/** Runs the AI turn, but answers Twilio within the budget: "one moment" + redirect when the AI is slower. */
async function turnWithBudget(call: PhoneCall, text: string, settings: PhoneSettings, line: PhoneLine): Promise<Response> {
  const job = computeTurn(call.id, text).finally(() => { if (inflight().get(call.id) === job) inflight().delete(call.id); });
  inflight().set(call.id, job);
  const reply = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), TURN_BUDGET_MS))]);
  if (!reply) return twiml(`${sayXml(WAIT[call.lang], settings, call.lang)}<Redirect method="POST">${VOICE_PATH}/wait?n=1</Redirect>`);
  // The reply is consumed here: the record saved (and used below) no longer carries it.
  const done = await saveCall({ ...((await getCall(call.id)) ?? call), pending: undefined });
  return render(done, reply, line, settings);
}

/** Twilio <Gather> action: the caller said something (or pressed a key, or nothing). */
export async function callerTurn(params: URLSearchParams): Promise<Response> {
  const call = await getCall(params.get('CallSid') || '');
  const settings = await getPhoneSettings();
  if (!call) return twiml(`${sayXml(NOBODY.fr, settings, 'fr')}<Hangup/>`);
  const ls = await lineOf(call);
  if (!ls) return twiml(`${sayXml(NOBODY[call.lang], settings, call.lang)}<Hangup/>`);
  const digits = params.get('Digits') || '';
  const speech = (params.get('SpeechResult') || '').trim();
  // Language choice from the greeting: no AI needed.
  if (call.lang === 'fr' && (digits === '2' || /^\W*(english|anglais|in english|speak english)\b/i.test(speech))) {
    const greeting = GREETING.en(ls.line.name);
    await saveCall(say({ ...call, lang: 'en' }, 'agent', greeting));
    return twiml(gatherXml(greeting, settings, 'en', `${VOICE_PATH}/turn`, hints(ls.line)));
  }
  if (digits === '0') return render(await saveCall({ ...call, handoffReason: 'Caller pressed 0' }), { say: NO_AGENT[call.lang].replace(/^\S+\.\s*/, ''), next: 'handoff', lang: call.lang }, ls.line, settings);
  if (!speech && !digits) {
    const silent = call.transcript.slice(-2).every((t) => t.who === 'caller' && t.text === '(silence)');
    const updated = await saveCall(say(call, 'caller', '(silence)'));
    if (silent) return render(updated, { say: call.lang === 'fr' ? 'Je n’entends rien. Au revoir.' : 'I can’t hear you. Goodbye.', next: 'hangup', lang: call.lang }, ls.line, settings);
    return twiml(gatherXml(call.lang === 'fr' ? 'Je suis là. Que puis-je vous préparer ?' : 'I’m here. What can I get for you?', settings, call.lang, `${VOICE_PATH}/turn`, hints(ls.line)));
  }
  return turnWithBudget(call, speech || `(pressed ${digits})`, settings, ls.line);
}

/** Twilio <Redirect> after "one moment": the AI turn is still running (here, or already saved by another instance). */
export async function waitTurn(params: URLSearchParams, n: number): Promise<Response> {
  const settings = await getPhoneSettings();
  const call = await getCall(params.get('CallSid') || '');
  if (!call) return twiml(`${sayXml(NOBODY.fr, settings, 'fr')}<Hangup/>`);
  const ls = await lineOf(call);
  if (!ls) return twiml(`${sayXml(NOBODY[call.lang], settings, call.lang)}<Hangup/>`);
  const job = inflight().get(call.id);
  const reply = job ? await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), TURN_BUDGET_MS))]) : (await getCall(call.id))?.pending?.reply ?? null;
  if (reply) {
    const done = await saveCall({ ...((await getCall(call.id)) ?? call), pending: undefined });
    return render(done, reply, ls.line, settings);
  }
  if (n < 3 && job) return twiml(`<Pause length="1"/><Redirect method="POST">${VOICE_PATH}/wait?n=${n + 1}</Redirect>`);
  return render(call, { say: NO_AGENT[call.lang].replace(/^\S+\.\s*/, ''), next: 'handoff', lang: call.lang }, ls.line, settings);
}

/** Twilio <Dial> action: did a person take the call? */
export async function dialDone(params: URLSearchParams): Promise<Response> {
  const settings = await getPhoneSettings();
  const call = await getCall(params.get('CallSid') || '');
  const status = params.get('DialCallStatus') || '';
  if (!call) return twiml('<Hangup/>');
  if (status === 'completed' || status === 'answered') {
    await endCall(call.id, 'handoff');
    return twiml('<Hangup/>');
  }
  const ls = await lineOf(call);
  if (ls) await missedHandoff(call, ls.line, `hand-off ${status || 'not answered'}`);
  await endCall(call.id, 'handoff_missed');
  return twiml(`${sayXml(NOBODY[call.lang], settings, call.lang)}<Hangup/>`);
}

/** Twilio call status callback (the number's "Call status changes" URL). */
export async function callStatus(params: URLSearchParams): Promise<void> {
  const id = params.get('CallSid') || '';
  if (!id) return;
  const st = params.get('CallStatus') || '';
  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(st)) await endCall(id, undefined, Number(params.get('CallDuration')) || undefined);
}

/** Console "Try the agent": same agent, same menu and rules — orders are never sent anywhere. */
export async function simulateTurn(lineId: string, sessionId: string | null, text: string): Promise<{ call: PhoneCall; reply: TurnReply }> {
  const settings = await getPhoneSettings();
  const line = settings.lines.find((l) => l.id === lineId);
  if (!line) throw new Error('Unknown phone line.');
  let call = sessionId ? await getCall(sessionId) : null;
  if (call && !call.simulated) throw new Error('Not a test session.');
  if (!call) {
    const greeting = GREETING.fr(line.name);
    call = await saveCall(say({
      id: `sim-${Date.now().toString(36)}`, lineId: line.id, lineName: line.name, locationCode: line.locationCode, brands: line.brands, from: 'console', to: line.number, lang: 'fr',
      status: 'active', startedAt: new Date().toISOString(), turns: 0, transcript: [], messages: [], cart: [], customer: {}, simulated: true, updatedAt: new Date().toISOString(),
    }, 'agent', greeting));
    if (!text.trim()) return { call, reply: { say: greeting, next: 'listen', lang: 'fr' } };
  }
  if (call.status !== 'active') throw new Error('This test call has ended — start a new one.');
  if (call.lang === 'fr' && /^\W*(english|anglais)\b/i.test(text)) {
    const greeting = GREETING.en(line.name);
    call = await saveCall(say(say({ ...call, lang: 'en' }, 'caller', text), 'agent', greeting));
    return { call, reply: { say: greeting, next: 'listen', lang: 'en' } };
  }
  const menu = await buildPhoneMenu(line);
  const r = await runAgentTurn(call, text, { line, menu, settings, simulate: true });
  let saved = await saveCall(r.call);
  if (r.reply.next !== 'listen') saved = (await endCall(saved.id, r.reply.next === 'handoff' ? 'handoff' : undefined)) ?? saved;
  return { call: saved, reply: r.reply };
}
