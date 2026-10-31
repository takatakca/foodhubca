import { withPerm } from '@/lib/foodhub/auth';
import { getChat, listChats } from '@/lib/foodhub/assistant/history';
import { fail, ok } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// GET → the person's chats (newest first). GET ?id=<chat> → that chat's messages. Only the person's own chats.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return ok({ chats: await listChats(actor.username) });
  const chat = await getChat(actor.username, id);
  if (!chat) return fail('Chat not found. / Conversation introuvable.', 404);
  // The prompt sent to the model (page context) stays server-side; the panel shows what was typed and answered.
  return ok({ chat: { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, messages: chat.messages.map(({ prompt: _p, ...m }) => m) } });
});
