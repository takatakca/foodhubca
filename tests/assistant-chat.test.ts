// Food Hub Assistant — the streaming chat route and the Claude loop, with the Anthropic API mocked at fetch level
// (real @anthropic-ai/sdk, server-sent events built here). Memory repo, no real network.
//   - 401 without a session; NDJSON stream with one;
//   - no ANTHROPIC_API_KEY → built-in answer + suggestions, no call to Claude;
//   - with a key: tool routing through the model's tool_use blocks, results sent back in one user message, thinking
//     blocks echoed unchanged, the card emitted but nothing executed;
//   - the page-summary prompt is built from the snapshot and parsed into tappable steps.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword, type AuthUser } from '../lib/foodhub/auth';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelStore, FoodHubUser } from '../lib/foodhub/types';
import type { PageSnapshot, StreamEvent } from '../lib/foodhub/assistant/types';

process.env.FOODHUB_FORCE_MEMORY = 'true';
process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
process.env.FOODHUB_TRUST_PROXY = 'true';
delete process.env.ANTHROPIC_MODEL;
delete process.env.ANTHROPIC_BASE_URL;
delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED;

const PASS = 'Assistant-chat-42';
const BRAND = 'Chat Burger';
const MGR: AuthUser = { username: 'ac_mgr', name: 'Mgr Chat', role: 'manager', locations: [], source: 'dashboard' };
const basic = (u: string) => ({ authorization: `Basic ${Buffer.from(`${u}:${PASS}`).toString('base64')}`, 'x-forwarded-for': `10.8.0.${u.length}` });

let store: ChannelStore;

beforeAll(async () => {
  const repo = getRepo();
  await repo.saveUser({ username: MGR.username, name: MGR.name, role: MGR.role, locations: [], active: true, lastLoginAt: null, passwordHash: hashPassword(PASS) } as unknown as FoodHubUser);
  await repo.saveMenu({ brandName: BRAND, updatedAt: new Date().toISOString(), categories: [{ ref: 'c', name: 'C', sortOrder: 0 }], modifierGroups: [], items: [{ ref: 'it-1', name: 'Smash', price: 11, categoryRef: 'c', available: true, modifierGroupRefs: [] }] });
  store = await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'uber-chat-1', brandName: BRAND, locationCode: 'HOCHELAGA', autoAccept: true, online: true, meta: {} });
});

afterEach(() => { vi.unstubAllGlobals(); delete process.env.ANTHROPIC_API_KEY; });

async function readEvents(res: Response): Promise<StreamEvent[]> {
  const text = await res.text();
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as StreamEvent);
}

// ---------- a tiny SSE server for the SDK ----------
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown } | { type: 'thinking'; thinking: string; signature: string };
function sse(blocks: Block[], stop: string): Response {
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  let out = ev('message_start', { type: 'message_start', message: { id: `msg_${Math.random().toString(36).slice(2, 8)}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      out += ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
    } else if (b.type === 'thinking') {
      out += ev('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      out += ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: b.signature } });
    } else {
      out += ev('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      out += ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    out += ev('content_block_stop', { type: 'content_block_stop', index });
  });
  out += ev('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 30 } });
  out += ev('message_stop', { type: 'message_stop' });
  return new Response(out, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('POST /api/foodhub/assistant/chat', () => {
  it('401 without a session', async () => {
    const { POST } = await import('../app/api/foodhub/assistant/chat/route');
    const res = await POST(new Request('http://hub.local/api/foodhub/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'hi', route: '/' }) }), {});
    expect(res.status).toBe(401);
  });

  it('without ANTHROPIC_API_KEY: built-in answer and suggestions, streamed, and Claude is never called', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 599 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('../app/api/foodhub/assistant/chat/route');
    const res = await POST(new Request('http://hub.local/api/foodhub/assistant/chat', { method: 'POST', headers: { ...basic('ac_mgr'), 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Combien on a vendu ?', route: '/', lang: 'fr' }) }), {});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const events = await readEvents(res);
    expect(events[0]).toMatchObject({ type: 'start', source: 'rules', aiConfigured: false });
    const text = events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('');
    expect(text).toMatch(/L’IA n’est pas configurée/);
    expect(text).toMatch(/Aujourd’hui/);
    const brief = events.find((e) => e.type === 'brief') as Extract<StreamEvent, { type: 'brief' }>;
    expect(brief.brief.steps.length).toBeGreaterThanOrEqual(3);
    expect(events.at(-1)?.type).toBe('done');
    expect(fetchSpy).not.toHaveBeenCalled();
    // The chat is kept for this person.
    const { GET } = await import('../app/api/foodhub/assistant/chats/route');
    const list = await (await GET(new Request('http://hub.local/api/foodhub/assistant/chats', { headers: basic('ac_mgr') }), {})).json();
    expect(list.chats[0].title).toBe('Combien on a vendu ?');
    const chat = await (await GET(new Request(`http://hub.local/api/foodhub/assistant/chats?id=${list.chats[0].id}`, { headers: basic('ac_mgr') }), {})).json();
    expect(chat.chat.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(chat.chat.messages[0]).not.toHaveProperty('prompt');
  });
});

describe('the Claude loop (SDK with fetch mocked)', () => {
  it('routes tool_use blocks to the tools, sends the results back, emits the card — and executes nothing', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
    const bodies: Array<Record<string, any>> = [];
    const headers: Array<Headers> = [];
    const replies = [
      () => sse([{ type: 'thinking', thinking: '', signature: 'sig-1' }, { type: 'tool_use', id: 'tu_status', name: 'get_store_status', input: { brand: BRAND } }], 'tool_use'),
      () => sse([{ type: 'tool_use', id: 'tu_pause', name: 'propose_store_pause', input: { store_ids: [store.id], online: false, minutes: 30, reason: 'rush' } }], 'tool_use'),
      () => sse([{ type: 'text', text: 'Voici la carte à approuver.' }], 'end_turn'),
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain('/v1/messages');
      bodies.push(JSON.parse(String(init?.body)));
      headers.push(new Headers(init?.headers));
      return replies[bodies.length - 1]();
    }));
    const { runTurn } = await import('../lib/foodhub/assistant/chat');
    const events: StreamEvent[] = [];
    const out = await runTurn({ actor: MGR, question: 'Mets Chat Burger en pause 30 min', route: '/stores', lang: 'fr', emit: (e) => events.push(e) });

    expect(bodies).toHaveLength(3);
    // Model, prompt caching, fallback, tools.
    expect(bodies[0].model).toBe('claude-sonnet-5-5');
    expect(bodies[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(bodies[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(bodies[0].fallbacks).toBe('default');
    expect(headers[0].get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(bodies[0].output_config).toEqual({ effort: 'medium' });
    expect(bodies[0].tools.map((t: { name: string }) => t.name)).toContain('propose_store_pause');
    expect(bodies[0].messages[0].content).toContain('<page_context>');
    expect(bodies[0].messages[0].content).toContain('"route":"/stores"');
    expect(bodies[0].messages[0].content).toContain('Answer in French (Québec).');
    // Step 2: the assistant turn (thinking block included, unchanged) then ONE user message with the tool result.
    const m = bodies[1].messages;
    expect(m.at(-2).role).toBe('assistant');
    expect(m.at(-2).content[0]).toMatchObject({ type: 'thinking', signature: 'sig-1' });
    expect(m.at(-1).role).toBe('user');
    expect(m.at(-1).content).toHaveLength(1);
    expect(m.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_status' });
    expect(JSON.parse(m.at(-1).content[0].content).stores[0].storeId).toBe(store.id);
    // Step 3: the proposal tool answered "waiting for approval".
    const r3 = bodies[2].messages.at(-1).content[0];
    expect(r3.tool_use_id).toBe('tu_pause');
    expect(JSON.parse(r3.content).status).toBe('waiting_for_approval');

    expect(events.filter((e) => e.type === 'tool').map((e) => (e as { name: string }).name)).toEqual(['get_store_status', 'propose_store_pause']);
    const card = events.find((e) => e.type === 'proposal') as Extract<StreamEvent, { type: 'proposal' }>;
    expect(card.proposal).toMatchObject({ kind: 'store_status', status: 'pending' });
    expect(out.text).toBe('Voici la carte à approuver.');
    // Never executed: the store is still online and no store action was logged.
    expect((await getRepo().listStores()).find((s) => s.id === store.id)?.online).toBe(true);
    expect((await getRepo().listActivity({ limit: 500 })).some((a) => a.kind === 'store_status' && a.storeId === store.id)).toBe(false);
    // The next turn replays this one as text (append-only), with the card noted.
    const { getChat } = await import('../lib/foodhub/assistant/history');
    const { historyParams } = await import('../lib/foodhub/assistant/chat');
    const chat = await getChat(MGR.username, out.chatId);
    const replay = historyParams(chat!.messages);
    expect(replay[0]).toEqual({ role: 'user', content: bodies[0].messages[0].content });
    expect(String(replay[1].content)).toContain(`approval card ${card.proposal.id}`);
  });

  it('a malformed tool input is an error result, never a call', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
    const bodies: Array<Record<string, any>> = [];
    const replies = [
      () => sse([{ type: 'tool_use', id: 'tu_bad', name: 'propose_store_pause', input: { online: 'yes please' } }], 'tool_use'),
      () => sse([{ type: 'text', text: 'Quel magasin ?' }], 'end_turn'),
    ];
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return replies[bodies.length - 1](); }));
    const { runTurn } = await import('../lib/foodhub/assistant/chat');
    const events: StreamEvent[] = [];
    await runTurn({ actor: MGR, question: 'pause', route: '/', lang: 'fr', emit: (e) => events.push(e) });
    const res = bodies[1].messages.at(-1).content[0];
    expect(res.is_error).toBe(true);
    expect(JSON.parse(res.content).error).toBe('INVALID_INPUT');
    expect(events.some((e) => e.type === 'proposal')).toBe(false);
  });

  it('Claude unreachable: the built-in answer still comes, with the reason', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } })));
    const { runTurn } = await import('../lib/foodhub/assistant/chat');
    const events: StreamEvent[] = [];
    const out = await runTurn({ actor: MGR, question: 'Combien de ventes ?', route: '/', lang: 'en', emit: (e) => events.push(e) });
    expect(out.source).toBe('rules');
    expect(events.find((e) => e.type === 'error')).toMatchObject({ message: expect.stringMatching(/API key/) });
    expect(events.at(-1)?.type).toBe('done');
  });
});

describe('page summary prompt', () => {
  const snap: PageSnapshot = {
    route: '/orders', page: 'orders', titleFr: 'Commandes', titleEn: 'Orders', at: '2026-10-31T15:00:00.000Z', scope: [],
    numbers: { salesToday: 812.5, ordersToday: 31, cancelledToday: 6, lateOrders: 2 }, lists: {},
    signals: [{ id: 'cancel_spike', severity: 'warning', fr: '6 commandes annulées aujourd’hui (16 %).', en: '6 orders cancelled today (16%).', questionFr: 'Pourquoi ?', questionEn: 'Why?' }],
  };

  it('is built from the snapshot: route, numbers, signals, language and the 3–4 numbered steps', async () => {
    const { buildPageSummaryPrompt, ASSISTANT_SYSTEM } = await import('../lib/foodhub/assistant/prompt');
    const p = buildPageSummaryPrompt(snap, 'fr', Date.parse('2026-10-31T15:00:00Z'));
    expect(p).toContain('<page_context>');
    expect(p).toContain('"route":"/orders"');
    expect(p).toContain('"salesToday":812.5');
    expect(p).toContain('cancel_spike');
    expect(p).not.toContain('2026-10-31T15:00:00.000Z'); // the raw timestamp stays out (stable cache key)
    expect(p).toContain('Answer in French (Québec).');
    expect(p).toContain('"Commandes" page');
    expect(p).toContain('Que voulez-vous faire ensuite ?');
    expect(p).toMatch(/3 to 4 numbered next steps/);
    expect(p).toMatch(/only the numbers and signals in page_context/);
    expect(buildPageSummaryPrompt(snap, 'en')).toContain('What do you want to do next?');
    // The system prompt is frozen: no date, no numbers, the locked rules inside.
    expect(ASSISTANT_SYSTEM).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(ASSISTANT_SYSTEM).toContain('27982486');
    expect(ASSISTANT_SYSTEM).toMatch(/Never say a change is done/);
  });

  it('parses the model text into a summary and tappable steps (falls back to the rules when unusable)', async () => {
    const { parseBrief } = await import('../lib/foodhub/assistant/prompt');
    const { ruleBrief } = await import('../lib/foodhub/assistant/suggest');
    const rules = ruleBrief(snap);
    const b = parseBrief('Ventes de 812,50 $ aujourd’hui ; 6 annulations, c’est beaucoup.\n\nQue voulez-vous faire ensuite ?\n1. **Comprendre** les annulations\n2. Voir les commandes en retard\n3. Ajuster le temps de préparation', 'fr', rules);
    expect(b.source).toBe('claude');
    expect(b.summaryFr).toBe('Ventes de 812,50 $ aujourd’hui ; 6 annulations, c’est beaucoup.');
    expect(b.steps.map((s) => s.askFr)).toEqual(['Comprendre les annulations', 'Voir les commandes en retard', 'Ajuster le temps de préparation']);
    expect(b.signals).toEqual(rules.signals);
    expect(parseBrief('rien', 'fr', rules)).toBe(rules);
  });

  it('pageBrief asks Claude with that prompt and caches it; without a key it is the rules', async () => {
    const { pageBrief } = await import('../lib/foodhub/assistant/chat');
    expect((await pageBrief(snap, MGR, 'fr', { useAi: true })).source).toBe('rules');
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
    const calls: Array<Record<string, any>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ id: 'msg_b', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Six annulations aujourd’hui.\nQue voulez-vous faire ensuite ?\n1. Comprendre les annulations\n2. Voir les retards' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
    }));
    const b1 = await pageBrief(snap, MGR, 'fr', { useAi: true });
    const b2 = await pageBrief(snap, MGR, 'fr', { useAi: true });
    expect(b1.source).toBe('claude');
    expect(b2).toBe(b1);
    expect(calls).toHaveLength(1);
    expect(calls[0].messages[0].content).toContain('3 to 4 numbered next steps');
    expect(calls[0].output_config).toEqual({ effort: 'low' });
    expect(calls[0].tools).toBeUndefined();
  });
});
