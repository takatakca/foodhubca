import { withPerm } from '@/lib/foodhub/auth';
import { runTurn } from '@/lib/foodhub/assistant/chat';
import type { StreamEvent } from '@/lib/foodhub/assistant/types';
import { fail, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST { question, chatId?, route, extra?, lang } → the answer, streamed as NDJSON (one StreamEvent per line):
// start → (tool | text | proposal)* → done. Signed-in people only (401 otherwise). Claude when ANTHROPIC_API_KEY is
// set, built-in answers otherwise. The assistant never changes anything here: changes are cards the person approves
// (POST /api/foodhub/assistant/proposals/[id]).
export const POST = withPerm('view', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (!question) return fail('Posez une question. / Ask a question.');
  if (question.length > 2000) return fail('Question trop longue (2000 caractères). / Question too long (2000 characters).');
  const lang = b.lang === 'en' ? 'en' : 'fr';
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: StreamEvent) => { if (open) { try { controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`)); } catch { open = false; } } };
      try {
        await runTurn({ actor, chatId: typeof b.chatId === 'string' ? b.chatId : null, question, route: typeof b.route === 'string' ? b.route : '/', extra: b.extra, lang, emit, signal: req.signal });
      } catch (err) {
        console.error('[foodhub] assistant chat failed:', err);
        emit({ type: 'error', message: 'Something went wrong — see the server log.', messageFr: 'Un problème est survenu — voir le journal du serveur.' });
        emit({ type: 'done', chatId: typeof b.chatId === 'string' ? b.chatId : '', messageId: null });
      } finally {
        open = false;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
});
