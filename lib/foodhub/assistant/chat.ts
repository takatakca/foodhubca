// One chat turn of the Food Hub Assistant, streamed to the panel.
//   - With ANTHROPIC_API_KEY: Claude (ANTHROPIC_MODEL, default claude-sonnet-5-5) with tool use — READ tools over every
//     channel, PROPOSE tools that only create approval cards. Manual streaming loop: text deltas go to the panel as they
//     come; each step's full content (thinking blocks included) is appended unchanged, so the turn stays append-only.
//     Earlier turns are replayed as the exact text that was sent / shown, so the history is append-only too.
//   - Without a key (or when Claude fails): the built-in answer and next steps (suggest.ts). Never an empty panel.
// Nothing in this file changes Food Hub data except the chat history and the pending cards.
import Anthropic from '@anthropic-ai/sdk';
import type { AuthUser } from '../auth';
import { assistantConfigured, assistantEffort, assistantModel, HISTORY_WINDOW, MAX_STEPS, supportsDefaultFallback, supportsEffort } from './config';
import { appendMessages, getChat, isChatId, newId } from './history';
import { ASSISTANT_SYSTEM, buildPageSummaryPrompt, buildTurnPrompt, parseBrief } from './prompt';
import { buildPageSnapshot } from './snapshot';
import { ruleAnswer, ruleBrief } from './suggest';
import { runTool, TOOL_LABELS, toolDefinitions, type ToolName } from './tools';
import type { ChatMessage, Lang, PageBrief, PageSnapshot, ProposalView, StreamEvent } from './types';

export function assistantClient(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
    timeout: 90_000,
    maxRetries: 1,
    // Through globalThis.fetch at call time (tests stub it; nothing else is patched).
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });
}

/** Request options shared by chat turns and page summaries (model-dependent extras only where the model takes them). */
export function requestExtras(model: string, effort: 'low' | 'medium' | 'high'): Pick<Anthropic.Beta.MessageCreateParams, 'output_config' | 'betas' | 'fallbacks'> {
  return {
    ...(supportsEffort(model) ? { output_config: { effort } } : {}),
    // A safety decline on the main model is retried server-side on Anthropic's recommended fallback model.
    ...(supportsDefaultFallback(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  };
}

/** The frozen system prompt, cached (it and the tool list are the stable prefix of every request). */
export const SYSTEM_BLOCKS: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: ASSISTANT_SYSTEM, cache_control: { type: 'ephemeral' } }];

/** Earlier turns as the model saw them: user = the exact prompt sent, assistant = the text shown (+ its cards). */
export function historyParams(messages: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages.slice(-HISTORY_WINDOW)) {
    if (m.role === 'user') out.push({ role: 'user', content: m.prompt ?? m.text });
    else {
      const cards = (m.proposals ?? []).map((p) => `[approval card ${p.id}: ${p.titleEn} — ${p.status}]`).join('\n');
      const text = [m.text.trim(), cards].filter(Boolean).join('\n');
      if (text) out.push({ role: 'assistant', content: text });
    }
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export interface TurnInput {
  actor: AuthUser;
  chatId?: string | null;
  question: string;
  route: string;
  extra?: unknown;
  lang: Lang;
  emit: (e: StreamEvent) => void;
  client?: Anthropic;
  now?: number;
  signal?: AbortSignal;
}

class TruncatedToolInput extends Error {}

/** Runs one question end to end and emits NDJSON events; always ends with `done`. */
export async function runTurn(input: TurnInput): Promise<{ chatId: string; text: string; proposals: ProposalView[]; source: 'claude' | 'rules' }> {
  const { actor, emit, lang } = input;
  const now = input.now ?? Date.now();
  const question = input.question.trim().slice(0, 2000);
  const prior = isChatId(input.chatId) ? await getChat(actor.username, input.chatId) : null;
  const chatId = prior?.id ?? newId();
  const snapshot = await buildPageSnapshot(input.route, actor, { extra: input.extra, now });
  const ai = assistantConfigured();
  emit({ type: 'start', chatId, source: ai ? 'claude' : 'rules', aiConfigured: ai });
  const prompt = buildTurnPrompt(snapshot, question, lang, now);
  const userMsg: ChatMessage = { id: newId(), role: 'user', text: question, prompt, at: new Date(now).toISOString() };

  const fallback = async (why?: string) => {
    const text = ruleAnswer(question, snapshot, lang);
    if (why) emit({ type: 'error', message: why, messageFr: why });
    emit({ type: 'text', delta: text });
    emit({ type: 'brief', brief: ruleBrief(snapshot) });
    const reply: ChatMessage = { id: newId(), role: 'assistant', text, source: 'rules', at: new Date().toISOString() };
    await appendMessages(actor.username, chatId, [userMsg, reply]);
    emit({ type: 'done', chatId, messageId: reply.id });
    return { chatId, text, proposals: [], source: 'rules' as const };
  };
  if (!ai) return fallback();

  const client = input.client ?? assistantClient();
  const model = assistantModel();
  const tools = toolDefinitions();
  const messages: Anthropic.Beta.BetaMessageParam[] = [...historyParams(prior?.messages ?? []), { role: 'user', content: prompt }];
  const proposals: ProposalView[] = [];
  const parts: string[] = [];
  let jsonRetries = 0;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (input.signal?.aborted) break;
      let stepText = '';
      const stream = client.beta.messages.stream({
        model, max_tokens: 16_000, system: SYSTEM_BLOCKS, tools, messages,
        // Caches the conversation so far as well: each tool round trip re-reads it from cache.
        cache_control: { type: 'ephemeral' },
        ...requestExtras(model, assistantEffort()),
      }, { signal: input.signal });
      stream.on('text', (delta) => {
        if (!stepText && parts.length) emit({ type: 'text', delta: '\n\n' });
        stepText += delta;
        emit({ type: 'text', delta });
      });
      let msg: Anthropic.Beta.BetaMessage;
      try {
        msg = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // A streamed tool input that is not even JSON: re-issue the step (API errors are not retried here).
        if (err instanceof Anthropic.APIError || input.signal?.aborted || jsonRetries++ >= 2) throw err;
        continue;
      }
      if (stepText) parts.push(stepText);
      if (msg.stop_reason === 'refusal') {
        const t = lang === 'fr' ? 'Je ne peux pas aider avec cette demande.' : 'I can’t help with that request.';
        if (!stepText) { emit({ type: 'text', delta: t }); parts.push(t); }
        break;
      }
      if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] }); continue; }
      const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (!uses.length) break;
      // A tool input cut off by max_tokens can still look valid: never run it.
      if (msg.stop_reason === 'max_tokens') throw new TruncatedToolInput('tool input truncated');
      messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        const label = TOOL_LABELS[u.name as ToolName] ?? { fr: u.name, en: u.name };
        emit({ type: 'tool', name: u.name, fr: label.fr, en: label.en });
        const out = await runTool(u.name, u.input, { actor, chatId, now });
        if (out.proposal) { proposals.push(out.proposal); emit({ type: 'proposal', proposal: out.proposal }); }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
      }
      // All results of a step go back in ONE user message (keeps parallel tool calls working).
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    if (input.signal?.aborted && !parts.length && !proposals.length) return { chatId, text: '', proposals, source: 'claude' };
    console.error('[foodhub] assistant turn failed:', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    if (!parts.length && !proposals.length) {
      const why = err instanceof Anthropic.AuthenticationError ? 'Claude refused the API key (ANTHROPIC_API_KEY).'
        : err instanceof Anthropic.RateLimitError ? 'Claude is busy (rate limit). Built-in answer below.'
        : err instanceof TruncatedToolInput ? 'The answer was too long. Built-in answer below.'
        : 'Claude is not reachable right now. Built-in answer below.';
      return fallback(why);
    }
    emit({ type: 'error', message: 'The answer stopped early.', messageFr: 'La réponse s’est arrêtée avant la fin.' });
  }
  const text = parts.join('\n\n').trim() || (proposals.length ? (lang === 'fr' ? 'Voici la proposition à approuver.' : 'Here is the proposal to approve.') : '');
  const reply: ChatMessage = { id: newId(), role: 'assistant', text, proposals, source: 'claude', at: new Date().toISOString() };
  await appendMessages(actor.username, chatId, [userMsg, reply]);
  emit({ type: 'done', chatId, messageId: reply.id });
  return { chatId, text, proposals, source: 'claude' };
}

// ---------- page summaries ----------

const briefCache = new Map<string, { at: number; brief: PageBrief }>();
const BRIEF_TTL_MS = 3 * 60_000;

/** Summary + next steps for a page: Claude when set up (cached 3 min per person, page and numbers), rules otherwise. */
export async function pageBrief(snapshot: PageSnapshot, actor: Pick<AuthUser, 'username'>, lang: Lang, opts: { client?: Anthropic; useAi?: boolean; now?: number } = {}): Promise<PageBrief> {
  const rules = ruleBrief(snapshot);
  if (!opts.useAi || !assistantConfigured() || snapshot.page === 'kitchen') return rules;
  const { at: _at, ...stable } = snapshot;
  const key = `${actor.username}|${lang}|${JSON.stringify(stable)}`;
  const hit = briefCache.get(key);
  const now = opts.now ?? Date.now();
  if (hit && now - hit.at < BRIEF_TTL_MS) return hit.brief;
  try {
    const client = opts.client ?? assistantClient();
    const model = assistantModel();
    const res = await client.beta.messages.create({
      model, max_tokens: 1200, system: SYSTEM_BLOCKS,
      messages: [{ role: 'user', content: buildPageSummaryPrompt(snapshot, lang, now) }],
      ...requestExtras(model, 'low'),
    });
    if (res.stop_reason === 'refusal') return rules;
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n');
    const brief = parseBrief(text, lang, rules);
    if (briefCache.size > 500) briefCache.clear();
    briefCache.set(key, { at: now, brief });
    return brief;
  } catch (err) {
    console.error('[foodhub] assistant page brief failed:', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    return rules;
  }
}
